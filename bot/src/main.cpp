/*
 * ========================================
 *   ESP12E PHONE-CONTROLLED BOT
 *   Teekhi Nazaar firmware
 * ========================================
 */

// ==================== LIBRARIES ====================
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ESP8266WebServer.h>
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <Servo.h>
#include "bot_secrets.h"

static_assert(sizeof(BOT_SETUP_AP_PASSWORD) - 1 >= 8 &&
              sizeof(BOT_SETUP_AP_PASSWORD) - 1 <= 63,
              "Setup AP password must be 8 to 63 bytes.");
static_assert(sizeof(BOT_DEFAULT_CONTROL_PASSWORD) - 1 >= 4 &&
              sizeof(BOT_DEFAULT_CONTROL_PASSWORD) - 1 <= 49,
              "Initial control password must be 4 to 49 bytes.");

// ==================== HARDWARE PIN DEFINITIONS ====================
const int ENA_PIN = 2;      // Left motor speed (PWM)
const int ENB_PIN = 1;      // Right motor speed (PWM) - GPIO1/TX
const int IN1_PIN = 14;     // Left motor direction 1
const int IN2_PIN = 12;     // Left motor direction 2
const int IN3_PIN = 13;     // Right motor direction 1
const int IN4_PIN = 16;     // Right motor direction 2
const int SERVO_PIN = 15;   // Camera servo

// ==================== GLOBAL VARIABLES ====================
String ssid_stored = "";
String password_stored = "";
String control_password_stored = BOT_DEFAULT_CONTROL_PASSWORD;
bool configMode = false;
int wifiConnectionAttempts = 0;
const int MAX_WIFI_ATTEMPTS = 5;

const char* mqtt_server = "broker.emqx.io";
const int mqtt_port = 1883;
const char* mqtt_user = "";
const char* mqtt_password = "";
const char* command_topic = "carbot/command";
const char* status_topic = "carbot/status";

const int EEPROM_MAGIC = 0xAB12;
const unsigned long PHONE_CONTROL_TIMEOUT_MS = 500;
const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;
WiFiClient espClient;
PubSubClient mqttClient(espClient);
ESP8266WebServer server(80);
Servo servoMotor;

// ==================== MOTOR STATE ====================
int leftSpeed = 0;      // -100 to +100 (negative = reverse)
int rightSpeed = 0;     // -100 to +100 (negative = reverse)
int servoAngle = 90;

// ==================== CONTROL STATE ====================
bool autonomousMode = false;
bool phoneControlActive = false;
unsigned long lastPhoneControlAt = 0;
unsigned long lastMqttAttemptAt = 0;
float phonePitchDeg = 0.0f;
float phoneRollDeg = 0.0f;
float phoneYawDeg = 0.0f;
String phoneDirection = "S";
unsigned long lastStatusTime = 0;

bool serialEnabled = true;

// ==================== FUNCTION DECLARATIONS ====================
void clearEEPROM();
void loadCredentials();
void saveCredentials(String ssid, String password);
void saveControlPassword(String password);
bool validateControlPassword(String password);
bool connectToWiFi();
void startConfigMode();
void handleRoot();
void handleScan();
void handleConnect();
void handleSetPassword();
void setupWebServer();
void setupMQTT();
bool reconnectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void publishStatus();
void setMotorSpeeds(int left, int right);
void stopMotors();
void stopPhoneControl();
void updateServo(int angle);
void disableSerial();

// ==================== SERIAL HELPER ====================
void disableSerial() {
  if (serialEnabled) {
    Serial.flush();
    delay(100);
    Serial.end();
    serialEnabled = false;
  }
}

// ==================== MOTOR CONTROL ====================
void setMotorSpeeds(int left, int right) {
  leftSpeed = constrain(left, -100, 100);
  rightSpeed = constrain(right, -100, 100);

  // ========== LEFT MOTOR ==========
  int leftPWM;
  if (leftSpeed > 0) {
    // Forward - apply minimum threshold + scaling
    // Map 1-100 to 85-255 (minimum 85 PWM)
    leftPWM = map(leftSpeed, 1, 100, 85, 255);
    digitalWrite(IN1_PIN, LOW);
    digitalWrite(IN2_PIN, HIGH);
    analogWrite(ENA_PIN, leftPWM);

  } else if (leftSpeed < 0) {
    // Backward - apply minimum threshold + scaling
    // Map -1 to -100 to 85-255 (minimum 85 PWM)
    leftPWM = map(abs(leftSpeed), 1, 100, 85, 255);
    digitalWrite(IN1_PIN, HIGH);
    digitalWrite(IN2_PIN, LOW);
    analogWrite(ENA_PIN, leftPWM);

  } else {
    // Stop (speed = 0)
    digitalWrite(IN1_PIN, LOW);
    digitalWrite(IN2_PIN, LOW);
    analogWrite(ENA_PIN, 0);
  }

  // ========== RIGHT MOTOR ==========
  int rightPWM;
  if (rightSpeed > 0) {
    // Forward - apply minimum threshold + scaling
    rightPWM = map(rightSpeed, 1, 100, 85, 255);
    digitalWrite(IN3_PIN, HIGH);
    digitalWrite(IN4_PIN, LOW);
    analogWrite(ENB_PIN, rightPWM);

  } else if (rightSpeed < 0) {
    // Backward - apply minimum threshold + scaling
    rightPWM = map(abs(rightSpeed), 1, 100, 85, 255);
    digitalWrite(IN3_PIN, LOW);
    digitalWrite(IN4_PIN, HIGH);
    analogWrite(ENB_PIN, rightPWM);

  } else {
    // Stop (speed = 0)
    digitalWrite(IN3_PIN, LOW);
    digitalWrite(IN4_PIN, LOW);
    analogWrite(ENB_PIN, 0);
  }
}


void stopMotors() {
  setMotorSpeeds(0, 0);
}

void stopPhoneControl() {
  phoneControlActive = false;
  phoneDirection = "S";
  stopMotors();
}

void updateServo(int angle) {
  servoAngle = constrain(angle, 60, 180);  // ← Changed from (0, 180) to (60, 180)
  servoMotor.write(servoAngle);
}

// ==================== EEPROM FUNCTIONS ====================
// (Keep all existing EEPROM functions - clearEEPROM, loadCredentials, saveCredentials, etc.)
void clearEEPROM() {
  if (serialEnabled) Serial.println("Clearing EEPROM...");
  for (int i = 0; i < 512; i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  if (serialEnabled) Serial.println("✓ EEPROM cleared");
}

void loadCredentials() {
  if (serialEnabled) Serial.println("Loading credentials from EEPROM...");
  int magic = (EEPROM.read(200) << 8) | EEPROM.read(201);
  if (magic != EEPROM_MAGIC) {
    if (serialEnabled) Serial.println("No valid credentials found");
    return;
  }

  int ssidLength = EEPROM.read(0);
  if (ssidLength > 0 && ssidLength < 100) {
    ssid_stored = "";
    for (int i = 0; i < ssidLength; i++) {
      ssid_stored += char(EEPROM.read(1 + i));
    }
  }

  int passwordLength = EEPROM.read(100);
  if (passwordLength > 0 && passwordLength < 100) {
    password_stored = "";
    for (int i = 0; i < passwordLength; i++) {
      password_stored += char(EEPROM.read(101 + i));
    }
  }

  int controlPasswordLength = EEPROM.read(300);
  if (controlPasswordLength > 0 && controlPasswordLength < 50) {
    control_password_stored = "";
    for (int i = 0; i < controlPasswordLength; i++) {
      control_password_stored += char(EEPROM.read(301 + i));
    }
  }

  if (serialEnabled) {
    Serial.println("✓ Credentials loaded");
    if (ssid_stored.length() > 0) {
      Serial.println("  SSID: " + ssid_stored);
    }
  }
}

void saveCredentials(String ssid, String password) {
  if (serialEnabled) Serial.println("Saving WiFi credentials to EEPROM...");
  for (int i = 0; i < 200; i++) {
    EEPROM.write(i, 0);
  }

  EEPROM.write(0, ssid.length());
  for (unsigned int i = 0; i < ssid.length(); i++) {
    EEPROM.write(1 + i, ssid[i]);
  }

  EEPROM.write(100, password.length());
  for (unsigned int i = 0; i < password.length(); i++) {
    EEPROM.write(101 + i, password[i]);
  }

  EEPROM.write(200, (EEPROM_MAGIC >> 8) & 0xFF);
  EEPROM.write(201, EEPROM_MAGIC & 0xFF);
  EEPROM.commit();

  ssid_stored = ssid;
  password_stored = password;
  if (serialEnabled) Serial.println("✓ WiFi credentials saved");
}

void saveControlPassword(String password) {
  if (serialEnabled) Serial.println("Saving control password to EEPROM...");
  EEPROM.write(300, password.length());
  for (unsigned int i = 0; i < password.length(); i++) {
    EEPROM.write(301 + i, password[i]);
  }
  EEPROM.commit();
  control_password_stored = password;
  if (serialEnabled) Serial.println("✓ Control password saved");
}

bool validateControlPassword(String password) {
  return (password == control_password_stored);
}

// ==================== MQTT FUNCTIONS ====================
void setupMQTT() {
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(768);
  mqttClient.setSocketTimeout(2);
}

bool reconnectMQTT() {
  if (configMode || WiFi.status() != WL_CONNECTED || mqttClient.connected()) return mqttClient.connected();
  if (millis() - lastMqttAttemptAt < MQTT_RECONNECT_INTERVAL_MS) return false;
  lastMqttAttemptAt = millis();

  String clientId = "Bot_ESP12E_" + String(random(0xffff), HEX);
  if (!mqttClient.connect(clientId.c_str(), mqtt_user, mqtt_password)) return false;

  mqttClient.subscribe(command_topic, 1);
  mqttClient.publish(status_topic, "{\"device_id\":\"esp12e_carbot\",\"status\":\"online\"}");
  return true;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != command_topic) return;

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) return;

  String receivedPassword = doc["password"] | "";
  if (!validateControlPassword(receivedPassword)) return;

  String commandSource = doc["source"] | "";
  const bool isPhoneControl =
    commandSource == "lain-mobile" && (doc["phone_control"] | false);

  if (isPhoneControl) {
    String targetDevice = doc["device_id"] | "";
    if (targetDevice != "esp12e_carbot") return;
    if (!doc["left"].is<int>() || !doc["right"].is<int>()) return;

    const bool armed = doc["armed"] | true;
    if (!armed) {
      phoneControlActive = false;
      phoneDirection = "S";
      stopMotors();
      return;
    }

    if (doc["left"].as<int>() < -100 || doc["left"].as<int>() > 100 ||
        doc["right"].as<int>() < -100 || doc["right"].as<int>() > 100) return;

    autonomousMode = false;
    phoneControlActive = true;
    lastPhoneControlAt = millis();
    phonePitchDeg = constrain(doc["pitch_deg"] | 0.0f, -180.0f, 180.0f);
    phoneRollDeg = constrain(doc["roll_deg"] | 0.0f, -180.0f, 180.0f);
    phoneYawDeg = constrain(doc["yaw_deg"] | 0.0f, -180.0f, 180.0f);
    phoneDirection = doc["cmd"] | "S";
    if (phoneDirection != "F" && phoneDirection != "B" &&
        phoneDirection != "L" && phoneDirection != "R" && phoneDirection != "S") {
      phoneDirection = "S";
    }
    setMotorSpeeds(doc["left"], doc["right"]);
    return;
  }

  // ==================== PROCESS ALL ARGUMENTS (NO RETURN) ====================

  // 1. AUTONOMOUS MODE TOGGLE (Process but don't return)
  if (doc["autonomous"].is<bool>()) {
    autonomousMode = doc["autonomous"];
  }

  // 2. SERVO CONTROL (Process but don't return)
  if (doc["servo"].is<int>()) {
    int angle = doc["servo"];
    updateServo(angle);
  }

  // 3. DIRECT WHEEL SPEED CONTROL
  if (doc["left"].is<int>() && doc["right"].is<int>()) {
    int left = doc["left"];    // -100 to +100
    int right = doc["right"];  // -100 to +100

    setMotorSpeeds(left, right);
    return;  // Can return here since motors are set
  }

  // 4. SIMPLE DIRECTION COMMANDS (FALLBACK)
  String cmd = doc["cmd"] | "";
  int speed = doc["speed"] | 50;

  if (cmd == "F") {
    setMotorSpeeds(speed, speed);
  } else if (cmd == "B") {
    setMotorSpeeds(-speed, -speed);
  } else if (cmd == "L") {
    setMotorSpeeds(-speed, speed);  // Left backward, right forward
  } else if (cmd == "R") {
    setMotorSpeeds(speed, -speed);  // Left forward, right backward
  } else if (cmd == "S") {
    stopMotors();
  }
}


void publishStatus() {
  if (!mqttClient.connected() || configMode) return;

  JsonDocument doc;
  doc["device_id"] = "esp12e_carbot";
  doc["status"] = "online";
  doc["left_speed"] = leftSpeed;
  doc["right_speed"] = rightSpeed;
  doc["servo_angle"] = servoAngle;
  doc["autonomous_mode"] = autonomousMode;
  doc["phone_control_active"] = phoneControlActive;
  doc["phone_direction"] = phoneDirection;
  doc["phone_pitch_deg"] = phonePitchDeg;
  doc["phone_roll_deg"] = phoneRollDeg;
  doc["phone_yaw_deg"] = phoneYawDeg;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = millis() / 1000;

  String output;
  serializeJson(doc, output);
  mqttClient.publish(status_topic, output.c_str());
}
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>Bot · Device setup</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17212b;
      --muted: #5f6c77;
      --line: #dbe3e8;
      --surface: #ffffff;
      --page: #f3f6f7;
      --brand: #12685e;
      --brand-dark: #0b4e47;
      --good: #176b45;
      --good-bg: #e7f5ed;
      --bad: #a33c32;
      --bad-bg: #fff0ed;
      --info-bg: #e9f3f7;
    }
    body {
      margin: 0;
      padding: 20px 14px 36px;
      background: var(--page);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    main { max-width: 680px; margin: 0 auto; }
    header { padding: 8px 2px 20px; }
    .brand { color: var(--brand); font-size: 12px; font-weight: 800; letter-spacing: 1.8px; }
    h1 { margin: 5px 0; font-size: 27px; letter-spacing: -.5px; }
    h2 { margin: 0; font-size: 17px; }
    p { color: var(--muted); margin: 6px 0 0; font-size: 13px; }
    .card {
      margin: 12px 0;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--surface);
    }
    .card-heading { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 15px; }
    .step {
      width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center;
      border-radius: 50%; background: #e6f1ef; color: var(--brand-dark); font-weight: 800; font-size: 13px;
    }
    .field { margin-top: 14px; }
    label { display: block; margin: 0 0 6px; color: var(--ink); font-size: 13px; font-weight: 700; }
    input, select {
      display: block; width: 100%; min-height: 46px; padding: 10px 12px;
      border: 1px solid #b9c5cc; border-radius: 9px; background: #fff; color: var(--ink);
      font: inherit; font-size: 16px;
    }
    input:focus, select:focus, button:focus-visible { outline: 3px solid #91c9be; outline-offset: 2px; }
    button {
      min-height: 46px; width: 100%; margin-top: 12px; padding: 10px 14px;
      border: 0; border-radius: 9px; background: var(--brand); color: white;
      font: inherit; font-size: 14px; font-weight: 750; cursor: pointer;
    }
    button:hover { background: var(--brand-dark); }
    button:disabled { opacity: .55; cursor: wait; }
    button.secondary { background: #e9eff1; color: var(--ink); }
    button.secondary:hover { background: #dce7e9; }
    .check { display: flex; align-items: center; gap: 9px; margin-top: 10px; }
    .check input { width: 18px; min-height: 18px; margin: 0; }
    .check label { margin: 0; font-weight: 500; }
    .notice {
      margin: 14px 0 0; padding: 11px 12px; border-radius: 9px;
      background: var(--info-bg); color: #2b5964; font-size: 12px;
    }
    .status {
      position: sticky; bottom: 10px; margin: 14px 0; padding: 12px 14px;
      border-radius: 10px; background: #25343b; color: white; font-size: 13px;
      box-shadow: 0 6px 22px rgba(14, 34, 40, .14);
    }
    .status:empty { display: none; }
    .status[data-kind="success"] { background: var(--good-bg); color: var(--good); }
    .status[data-kind="error"] { background: var(--bad-bg); color: var(--bad); }
    .footer { padding: 4px 3px; color: var(--muted); font-size: 11px; text-align: center; }
    @media (max-width: 420px) {
      body { padding: 12px 10px 26px; }
      .card { padding: 15px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">BOT · DEVICE SETUP</div>
      <h1>Device setup</h1>
      <p>Connect the bot to Wi-Fi and set its control password.</p>
    </header>

    <section class="card" aria-labelledby="wifi-heading">
      <div class="card-heading"><span class="step">1</span><div><h2 id="wifi-heading">Connect to Wi-Fi</h2><p>Use a 2.4 GHz network. The bot restarts after saving.</p></div></div>
      <button id="scanButton" class="secondary" type="button" onclick="scanNetworks()">Scan for networks</button>
      <div class="field"><label for="ssid">Network name</label><select id="ssid"><option value="">Scan, then select a network</option></select></div>
      <div class="field"><label for="wifiPassword">Wi-Fi password</label><input id="wifiPassword" type="password" autocomplete="current-password" placeholder="Leave blank for an open network"></div>
      <div class="check"><input id="showWifiPassword" type="checkbox" onchange="togglePassword('wifiPassword', this)"><label for="showWifiPassword">Show password</label></div>
      <button id="connectButton" type="button" onclick="connectWiFi()" disabled>Save network and connect</button>
      <div class="notice">Stay connected to <strong>Lain_Setup</strong> until the bot restarts. Then reconnect your phone to the same internet network as the bot.</div>
    </section>

    <section class="card" aria-labelledby="password-heading">
      <div class="card-heading"><span class="step">2</span><div><h2 id="password-heading">Set the bot control password</h2><p>Enter the same password in the mobile app. Use 4–49 characters.</p></div></div>
      <div class="field"><label for="controlPassword">New control password</label><input id="controlPassword" type="password" autocomplete="new-password" minlength="4" maxlength="49" placeholder="4–49 characters"></div>
      <div class="check"><input id="showControlPassword" type="checkbox" onchange="togglePassword('controlPassword', this)"><label for="showControlPassword">Show password</label></div>
      <button id="passwordButton" class="secondary" type="button" onclick="setControlPassword()">Save control password</button>
    </section>

    <div id="status" class="status" role="status" aria-live="polite"></div>
    <div class="footer">The bot uses <code>carbot/command</code> and <code>carbot/status</code> over MQTT.</div>
  </main>
  <script>
    const byId = id => document.getElementById(id);
    let scanBusy = false;

    function togglePassword(inputId, checkbox) {
      byId(inputId).type = checkbox.checked ? 'text' : 'password';
    }
    function showStatus(message, kind = '') {
      const status = byId('status');
      status.textContent = message;
      status.dataset.kind = kind;
    }
    async function postForm(path, values) {
      const body = new URLSearchParams(values);
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Request failed.');
      return data;
    }
    async function scanNetworks() {
      if (scanBusy) return;
      scanBusy = true;
      const button = byId('scanButton');
      button.disabled = true;
      button.textContent = 'Scanning…';
      showStatus('Scanning nearby 2.4 GHz networks…');
      try {
        const response = await fetch('/scan');
        if (!response.ok) throw new Error('The network scan failed. Try again.');
        const data = await response.json();
        const select = byId('ssid');
        select.replaceChildren(new Option('Select a network', ''));
        data.networks.forEach(network => select.add(new Option(`${network.ssid} · ${network.rssi} dBm`, network.ssid)));
        if (!data.networks.length) throw new Error('No networks found. Check that your router is on 2.4 GHz.');
        showStatus(`Found ${data.networks.length} networks.`, 'success');
      } catch (error) {
        showStatus(error.message || 'The network scan failed.', 'error');
      } finally {
        scanBusy = false;
        button.disabled = false;
        button.textContent = 'Scan for networks';
        byId('connectButton').disabled = !byId('ssid').value;
      }
    }
    byId('ssid').addEventListener('change', () => { byId('connectButton').disabled = !byId('ssid').value; });
    async function connectWiFi() {
      const button = byId('connectButton');
      if (!byId('ssid').value) return showStatus('Select a network first.', 'error');
      button.disabled = true;
      button.textContent = 'Saving…';
      showStatus('Saving network details. The bot will restart shortly.');
      try {
        await postForm('/connect', { ssid: byId('ssid').value, password: byId('wifiPassword').value });
        showStatus('Network saved. Keep the phone on Lain_Setup while the bot restarts.', 'success');
      } catch (error) {
        showStatus(error.message || 'Could not save the network.', 'error');
        button.disabled = false;
      } finally {
        button.textContent = 'Save network and connect';
      }
    }
    async function setControlPassword() {
      const input = byId('controlPassword');
      const button = byId('passwordButton');
      const password = input.value;
      if (password.length < 4 || password.length > 49) return showStatus('Use a control password from 4 to 49 characters.', 'error');
      button.disabled = true;
      showStatus('Saving control password…');
      try {
        await postForm('/setpassword', { password });
        input.value = '';
        showStatus('Password saved. Enter this same password in the mobile app.', 'success');
      } catch (error) {
        showStatus(error.message || 'Could not save the password.', 'error');
      } finally {
        button.disabled = false;
      }
    }
  </script>
</body>
</html>
)rawliteral";
  server.send(200, "text/html", html);
}

// ==================== WIFI FUNCTIONS  ====================
bool connectToWiFi() {
  if (ssid_stored.length() == 0) {
    if (serialEnabled) Serial.println("No stored WiFi credentials");
    return false;
  }

  if (serialEnabled) {
    Serial.println("\n--- WiFi Connection Attempt ---");
    Serial.println("SSID: " + ssid_stored);
    Serial.println("Attempt: " + String(wifiConnectionAttempts + 1) + "/" + String(MAX_WIFI_ATTEMPTS));
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid_stored.c_str(), password_stored.c_str());

  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 20) {
    delay(500);
    if (serialEnabled) Serial.print(".");
    timeout++;
  }
  if (serialEnabled) Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    if (serialEnabled) {
      Serial.println("✓ WiFi Connected!");
      Serial.print("  IP Address: ");
      Serial.println(WiFi.localIP());
      Serial.print("  Signal: ");
      Serial.print(WiFi.RSSI());
      Serial.println(" dBm");
    }
    wifiConnectionAttempts = 0;
    configMode = false;
    return true;
  } else {
    if (serialEnabled) Serial.println("✗ Connection failed");
    wifiConnectionAttempts++;
    return false;
  }
}

void startConfigMode() {
  if (serialEnabled) {
    Serial.println("\n========================================");
    Serial.println("  STARTING AP CONFIGURATION MODE");
    Serial.println("========================================");
  }
  configMode = true;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("Lain_Setup", BOT_SETUP_AP_PASSWORD);
  IPAddress IP = WiFi.softAPIP();
  if (serialEnabled) {
    Serial.println("AP SSID: Lain_Setup");
    Serial.println("AP password is configured locally.");
    Serial.print("Configuration URL: http://");
    Serial.println(IP);
    Serial.println("========================================\n");
  }

  // Release UART so GPIO1 can control the right motor PWM in AP mode too.
  disableSerial();
  pinMode(ENB_PIN, OUTPUT);
  digitalWrite(ENB_PIN, LOW);
  analogWrite(ENB_PIN, 0);
}

void handleScan() {
  const int count = WiFi.scanNetworks();
  if (count < 0) {
    server.send(503, "application/json", "{\"success\":false,\"message\":\"Network scan failed\"}");
    return;
  }

  JsonDocument doc;
  JsonArray networks = doc["networks"].to<JsonArray>();
  for (int i = 0; i < count; i++) {
    JsonObject network = networks.add<JsonObject>();
    network["ssid"] = WiFi.SSID(i);
    network["rssi"] = WiFi.RSSI(i);
  }
  String output;
  serializeJson(doc, output);
  server.send(200, "application/json", output);
  WiFi.scanDelete();
}

void handleConnect() {
  if (server.hasArg("ssid") && server.hasArg("password")) {
    String ssid = server.arg("ssid");
    String password = server.arg("password");
    if (ssid.length() == 0 || ssid.length() > 32 || password.length() > 63) {
      server.send(400, "application/json", "{\"success\":false,\"message\":\"SSID must be 1–32 characters and Wi-Fi password up to 63 characters\"}");
      return;
    }
    saveCredentials(ssid, password);
    server.send(200, "application/json", "{\"success\":true,\"message\":\"Saved\"}");
    delay(1000);
    ESP.restart();
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"Missing parameters\"}");
  }
}

void handleSetPassword() {
  if (server.hasArg("password")) {
    String password = server.arg("password");
    if (password.length() >= 4 && password.length() < 50) {
      saveControlPassword(password);
      server.send(200, "application/json", "{\"success\":true}");
    } else {
      server.send(400, "application/json", "{\"success\":false,\"message\":\"Password must be 4 to 49 characters\"}");
    }
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"Missing\"}");
  }
}

void setupWebServer() {
  server.on("/", handleRoot);
  server.on("/scan", handleScan);
  server.on("/connect", HTTP_POST, handleConnect);
  server.on("/setpassword", HTTP_POST, handleSetPassword);
  server.begin();
}

// ==================== SETUP ====================
void setup() {
  // ========== STEP 1: SECURE ALL MOTOR PINS IMMEDIATELY ==========
  pinMode(ENA_PIN, OUTPUT);
  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  pinMode(IN3_PIN, OUTPUT);
  pinMode(IN4_PIN, OUTPUT);

  digitalWrite(ENA_PIN, LOW);
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, LOW);
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);

  delayMicroseconds(100);

  // ========== STEP 2: START SERIAL ==========
  Serial.begin(115200);
  delay(100);
  EEPROM.begin(512);

  Serial.println("\n\n========================================");
  Serial.println("  ESP12E PHONE-CONTROLLED BOT v3.0");
  Serial.println("  Direct Wheel Speed Control");
  Serial.println("========================================");
  Serial.println("✓ Motor pins secured");
  Serial.println("⏳ ENB (GPIO1) will init after WiFi...");

  // ========== STEP 3: INITIALIZE SERVO ==========
  servoMotor.attach(SERVO_PIN);
  servoMotor.write(servoAngle);
  Serial.println("✓ Servo initialized on GPIO15");

  // ========== STEP 4: LOAD CREDENTIALS ==========
  loadCredentials();

  // ========== STEP 5: WIFI CONNECTION ==========
  if (ssid_stored.length() > 0) {
    Serial.println("\n--- Attempting WiFi Connection ---");

    while (wifiConnectionAttempts < MAX_WIFI_ATTEMPTS) {
      if (connectToWiFi()) {
        Serial.println("\n✅ WiFi connected successfully!");

        // Setup MQTT
        setupMQTT();
        reconnectMQTT();

        if (mqttClient.connected()) {
          Serial.println("✅ MQTT connected to broker");
        } else {
          Serial.println("⚠ MQTT connection failed (will retry in loop)");
        }

        // ========== STEP 6: DISABLE SERIAL & INIT ENB ==========
        Serial.println("\n🔄 Disabling Serial to free GPIO1...");
        Serial.println("✅ GPIO1 (ENB) will control right motor");
        Serial.println("========================================");
        Serial.flush();
        delay(200);

        disableSerial();

        // NOW safe to initialize ENB on GPIO1
        pinMode(ENB_PIN, OUTPUT);
        digitalWrite(ENB_PIN, LOW);
        delay(50);

        break;
      }

      delay(1000);
    }

    // ========== WIFI FAILED - AP MODE ==========
    if (wifiConnectionAttempts >= MAX_WIFI_ATTEMPTS) {
      Serial.println("\n⚠ All WiFi attempts failed!");
      Serial.println("⚠ Starting AP mode...");
      startConfigMode();
      setupWebServer();
    }

  } else {
    // ========== NO CREDENTIALS - AP MODE ==========
    Serial.println("\n⚠ No WiFi credentials found");
    Serial.println("⚠ Starting AP mode...");
    startConfigMode();
    setupWebServer();
  }

  // ========== STEP 7: INITIALIZE TIMERS ==========
  lastStatusTime = millis();

  if (serialEnabled) {
    Serial.println("\n========================================");
    Serial.println("✅ SYSTEM READY!");
    Serial.println("========================================\n");
  }
}

// ==================== LOOP ====================
void loop() {
  const unsigned long now = millis();

  if (phoneControlActive &&
      (!mqttClient.connected() || WiFi.status() != WL_CONNECTED ||
       now - lastPhoneControlAt > PHONE_CONTROL_TIMEOUT_MS)) {
    stopPhoneControl();
  }

  if (configMode) {
    server.handleClient();
  } else {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    }
    if (mqttClient.connected()) mqttClient.loop();

    const unsigned long statusInterval = 2000;
    if (now - lastStatusTime >= statusInterval) {
      publishStatus();
      lastStatusTime = now;
    }
  }

  delay(5);
}
