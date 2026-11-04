#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>

#include "command.h"
#include "setup_page.h"
#include "local_credentials.h"

namespace {

constexpr uint8_t outputPins[] = {D0, D2, D5};
static_assert(sizeof(outputPins) / sizeof(outputPins[0]) == appliances::channelCount);
constexpr uint8_t setupPin = D6;
constexpr char controlTopic[] = "gazeconnect/appliances/control";
constexpr char stateTopic[] = "gazeconnect/appliances/state";
constexpr char brokerHost[] = "broker.emqx.io";
constexpr uint16_t brokerPort = 1883;
static_assert(sizeof(appliancePassword) > 1, "Set the appliance control password in local_credentials.h");
static_assert(sizeof(setupPassword) >= 9 && sizeof(setupPassword) <= 64, "Set an 8-63 byte setup Wi-Fi password");
constexpr uint32_t settingsVersion = 0x49525301;

struct Settings {
    uint32_t version;
    char ssid[33];
    char wifiKey[64];
};

Settings settings{};
ESP8266WebServer portal(80);
WiFiClient transport;
PubSubClient mqtt(transport);
bool provisioning = false;

bool settingsValid(const Settings& s) {
    return s.version == settingsVersion && s.ssid[0] && s.ssid[sizeof(s.ssid) - 1] == 0 &&
           s.wifiKey[sizeof(s.wifiKey) - 1] == 0;
}

template<size_t N>
bool readField(const char* key, char (&out)[N], size_t minLength = 0) {
    const String value = portal.arg(key);
    if (value.length() < minLength || value.length() >= N || strlen(value.c_str()) != value.length()) {
        return false;
    }
    value.toCharArray(out, N);
    return true;
}

void scanNetworks() {
    const int count = WiFi.scanNetworks();
    if (count < 0) {
        portal.send(503, "application/json", "{\"message\":\"Scan failed. Try again.\"}");
        return;
    }
    JsonDocument result;
    JsonArray networks = result.to<JsonArray>();
    for (int i = 0; i < count; ++i) {
        JsonObject network = networks.add<JsonObject>();
        network["ssid"] = WiFi.SSID(i);
        network["rssi"] = WiFi.RSSI(i);
    }
    WiFi.scanDelete();
    String body;
    serializeJson(result, body);
    portal.send(200, "application/json", body);
}

void saveSettings() {
    Settings next{};
    next.version = settingsVersion;
    if (!readField("ssid", next.ssid, 1) || !readField("wifi", next.wifiKey) ||
        (next.wifiKey[0] && strlen(next.wifiKey) < 8)) {
        portal.send(400, "application/json", R"({"message":"Enter a network name and its Wi-Fi password (8–63 bytes), or leave it blank for open Wi-Fi."})");
        return;
    }
    WiFi.begin(next.ssid, next.wifiKey);
    if (WiFi.waitForConnectResult(15000) != WL_CONNECTED || WiFi.SSID() != next.ssid) {
        WiFi.disconnect(false);
        portal.send(422, "application/json", R"({"message":"Could not join that network. Check the Wi-Fi password and that 2.4 GHz is enabled, then retry."})");
        return;
    }
    EEPROM.put(0, next);
    if (!EEPROM.commit()) {
        portal.send(500, "application/json", R"({"message":"Could not save the network. Try again."})");
        return;
    }
    portal.send(200, "application/json", R"({"success":true})");
    delay(1000);
    ESP.restart();
}

void startSetup() {
    provisioning = true;
    WiFi.mode(WIFI_AP_STA);
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false);
    const String name = "IRIS-Appliances-" + String(ESP.getChipId(), HEX);
    if (!WiFi.softAP(name.c_str(), setupPassword)) {
        Serial.println(F("Setup Wi-Fi failed. Reset the board to retry."));
        return;
    }
    Serial.printf("Setup Wi-Fi: %s\n", name.c_str());
    Serial.print(F("Open http://"));
    Serial.println(WiFi.softAPIP());
    portal.on("/", HTTP_GET, [] { portal.send_P(200, PSTR("text/html"), setupPage); });
    portal.on("/scan", HTTP_GET, scanNetworks);
    portal.on("/connect", HTTP_POST, saveSettings);
    portal.begin();
}

bool publishState() {
    JsonDocument state;
    for (size_t i = 0; i < appliances::channelCount; ++i) {
        state[appliances::channels[i]] = digitalRead(outputPins[i]) == HIGH ? "on" : "off";
    }
    char payload[64];
    serializeJson(state, payload, sizeof(payload));
    return mqtt.publish(stateTopic, payload, true);
}

void handleCommand(char* topic, uint8_t* payload, unsigned int length) {
    appliances::Command command{};
    if (strcmp(topic, controlTopic) != 0 ||
        !appliances::parseCommand(payload, length, appliancePassword, command)) return;

    for (size_t i = 0; i < appliances::channelCount; ++i) {
        if (command[i] != appliances::Switch::unchanged) {
            digitalWrite(outputPins[i], command[i] == appliances::Switch::on ? HIGH : LOW);
        }
    }
    if (!publishState()) mqtt.disconnect(); // Refresh the retained report on reconnect.
}

void serviceBroker() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (mqtt.connected()) {
        mqtt.loop();
        return;
    }

    constexpr uint32_t retryMs = 5000;
    static uint32_t lastAttempt = millis() - retryMs;
    if (millis() - lastAttempt < retryMs) return;
    lastAttempt = millis();
    const String clientId = "iris-appliance-" + String(ESP.getChipId(), HEX);
    if (mqtt.connect(clientId.c_str())) {
        if (!mqtt.subscribe(controlTopic, 1) || !publishState()) mqtt.disconnect();
    }
}

} // namespace

void setup() {
    for (uint8_t pin : outputPins) {
        digitalWrite(pin, LOW);
        pinMode(pin, OUTPUT);
    }
    pinMode(setupPin, INPUT_PULLUP);
    Serial.begin(115200);
    WiFi.persistent(false);
    EEPROM.begin(sizeof(settings));
    EEPROM.get(0, settings);
    if (digitalRead(setupPin) == LOW || !settingsValid(settings)) {
        startSetup();
        return;
    }

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(settings.ssid, settings.wifiKey);
    if (WiFi.waitForConnectResult(20000) != WL_CONNECTED) {
        startSetup();
        return;
    }
    mqtt.setServer(brokerHost, brokerPort);
    mqtt.setCallback(handleCommand);
}

void loop() {
    if (provisioning) portal.handleClient();
    else serviceBroker();
    delay(1);
}
