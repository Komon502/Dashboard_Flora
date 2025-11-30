#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <NimBLEServer.h>
#include <time.h> // ✅ สำหรับ NTP

// --- WiFi & Server Configuration ---
const char* ssid      = "KimiwaKa";                 // ชื่อ Wi-Fi
const char* password  = "nueng010";                 // รหัส Wi-Fi
const char* serverUrl = "http://172.20.10.2:3000/api/ingest";  // URL สำหรับส่งข้อมูล

// --- BLE Service UUID ---
#define SERVICE_UUID        "580be265-87e1-4ab8-b78f-a5b5003b7dbd"
#define CHARACTERISTIC_UUID "580be265-87e1-4ab8-b78f-a5b5003b7dbd"

// ตัวแปรเก็บ Advertising object
NimBLEAdvertising* adv;

// --- ฟังก์ชันเชื่อมต่อ WiFi ---
bool wifiConnect() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

// --- ฟังก์ชันส่งข้อมูลไป Server ---
bool postToServer(const char* deviceId, float t, float h, uint32_t lastSeen) {
  if (!wifiConnect()) return false;

  StaticJsonDocument<200> doc;
  doc["deviceId"] = deviceId ? deviceId : "unknown";
  JsonObject s = doc.createNestedObject("sensors");
  s["temperature"] = t;
  s["humidity"]    = h;
  doc["active"] = true;
  doc["lastSeen"] = lastSeen;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();

  Serial.printf("[HTTP] POST %d: %s\n", code, body.c_str());
  return (code > 0 && code < 400);
}

// --- Callback เมื่อมี Client เขียนค่า BLE เข้ามา ---
class MyCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) {
    std::string v = c->getValue();
    if (v.empty()) return;

    StaticJsonDocument<200> in;
    auto err = deserializeJson(in, v);
    if (err) { Serial.println("[JSON] parse error"); return; }

    const char* id = in["deviceId"] | "unknown";
    float t = in["temperature"] | NAN;
    float h = in["humidity"]    | NAN;
    uint32_t ts = in["lastSeen"] | (uint32_t)millis();

    if (isnan(t) || isnan(h)) {
      Serial.println("[JSON] missing fields");
      return;
    }

    Serial.printf("[BLE] %s T=%.2f H=%.2f\n", id, t, h);
    Serial.println(postToServer(id, t, h, ts) ? "[HTTP] OK" : "[HTTP] FAIL");
  }
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override { onWrite(c); }
};

// --- Setup เริ่มต้นระบบ ---
void setup() {
  Serial.begin(9600);
  wifiConnect();

  // ✅ ตั้งค่าเวลา NTP (โซนไทย +7 ชั่วโมง)
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  // ✅ ตั้งค่า BLE Server
  NimBLEDevice::init("ESP32_Server");
  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* svc = server->createService(SERVICE_UUID);

  NimBLECharacteristic* chr = svc->createCharacteristic(
    CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE
  );
  chr->setCallbacks(new MyCallbacks());

  svc->start();
  adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();
  Serial.println("[BLE] advertising...");
}

// --- Loop ทำงานต่อเนื่อง ---
void loop() {
  // ✅ เชื่อม WiFi ถ้าหลุด
  if (WiFi.status() != WL_CONNECTED) wifiConnect();

  // ✅ ตรวจเวลาปัจจุบันจาก NTP
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("[TIME] Failed to get time");
    delay(2000);
    return;
  }

  int hourNow = timeinfo.tm_hour;
  static bool bleActive = true;

  // ✅ เปิด BLE ช่วง 07:00 - 21:00 เท่านั้น
  if (hourNow >= 7 && hourNow < 21) {
    if (!bleActive) {
      adv->start();
      bleActive = true;
      Serial.println("[BLE] Started (07:00–21:00)");
    }
  } else {
    if (bleActive) {
      adv->stop();
      bleActive = false;
      Serial.println("[BLE] Stopped (Night time)");
    }
  }

  delay(5000);
}