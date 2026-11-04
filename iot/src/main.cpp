#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>

#include "command.h"

namespace {

constexpr uint8_t outputPins[] = {D1, D2, D5};
static_assert(sizeof(outputPins) / sizeof(outputPins[0]) == appliances::channelCount);
constexpr uint8_t setupPin = D6;
constexpr char controlTopic[] = "gazeconnect/appliances/control";
constexpr char stateTopic[] = "gazeconnect/appliances/state";
constexpr uint32_t settingsVersion = 0x49525301;

struct Settings {
    uint32_t version;
    char ssid[33];
    char wifiKey[64];
    char controlKey[64];
    char brokerHost[128];
    uint16_t brokerPort;
};

Settings settings{};
ESP8266WebServer portal(80);
WiFiClient transport;
PubSubClient mqtt(transport);
bool provisioning = false;

bool settingsValid(const Settings& s) {
    return s.version == settingsVersion && s.ssid[0] && s.ssid[sizeof(s.ssid) - 1] == 0 &&
           s.wifiKey[sizeof(s.wifiKey) - 1] == 0 && s.controlKey[sizeof(s.controlKey) - 1] == 0 &&
           strlen(s.controlKey) >= 8 && s.brokerHost[0] && s.brokerHost[sizeof(s.brokerHost) - 1] == 0 &&
           s.brokerPort > 0;
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

void saveSettings() {
    Settings next{};
    next.version = settingsVersion;
    const String port = portal.arg("port");
    char* end;
    const long number = strtol(port.c_str(), &end, 10);
    if (!readField("ssid", next.ssid, 1) || !readField("wifi", next.wifiKey) ||
        (next.wifiKey[0] && strlen(next.wifiKey) < 8) || !readField("control", next.controlKey, 8) ||
        !readField("host", next.brokerHost, 1) || strspn(next.brokerHost,
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-") != strlen(next.brokerHost) ||
        number < 1 || number > 65535 || *end != '\0') {
        portal.send(400, "text/plain", "Check the field lengths, broker hostname and TCP port.");
        return;
    }
    next.brokerPort = static_cast<uint16_t>(number);
    EEPROM.put(0, next);
    if (!EEPROM.commit()) {
        portal.send(500, "text/plain", "Could not save settings. Retry.");
        return;
    }
    portal.send(200, "text/plain", "Saved. Release the setup button. Restarting in two seconds.");
    delay(2000);
    ESP.restart();
}

const char setupPage[] PROGMEM = R"HTML(<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>IRIS appliance setup</title>
<h1>IRIS appliance board</h1><form method="post" action="/settings" autocomplete="off">
<p><label>2.4 GHz Wi-Fi network <input name="ssid" required maxlength="32"></label>
<p><label>Wi-Fi password (blank for an open network) <input type="password" name="wifi" maxlength="63"></label>
<p><label>MQTT broker hostname or IPv4 address <input name="host" required maxlength="127"></label>
<p><label>MQTT TCP port <input type="number" name="port" required min="1" max="65535" value="1883"></label>
<p><label>Appliance control password <input type="password" name="control" required minlength="8" maxlength="63"></label>
<p>Use a dedicated appliance password. Broker subscribers can read control messages.</p>
<button>Save and restart</button></form></html>)HTML";

void startSetup() {
    provisioning = true;
    WiFi.mode(WIFI_AP);
    const String name = "IRIS-Appliances-" + String(ESP.getChipId(), HEX);
    // Only this short-lived setup key is disclosed locally over USB.
    char key[17]{};
    for (size_t i = 0; i < sizeof(key) - 1; ++i) key[i] = "0123456789abcdef"[secureRandom(16)];
    if (!WiFi.softAP(name.c_str(), key)) {
        Serial.println(F("Setup Wi-Fi failed. Reset the board to retry."));
        return;
    }
    Serial.printf("Setup Wi-Fi: %s\nTemporary setup key: %s\n", name.c_str(), key);
    Serial.print(F("Open http://"));
    Serial.println(WiFi.softAPIP());
    portal.on("/", HTTP_GET, [] { portal.send_P(200, PSTR("text/html"), setupPage); });
    portal.on("/settings", HTTP_POST, saveSettings);
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
        !appliances::parseCommand(payload, length, settings.controlKey, command)) return;

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
    mqtt.setServer(settings.brokerHost, settings.brokerPort);
    mqtt.setCallback(handleCommand);
}

void loop() {
    if (provisioning) portal.handleClient();
    else serviceBroker();
    delay(1);
}
