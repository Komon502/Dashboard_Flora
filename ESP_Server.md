/*
  ESP32_Server -> HTTP /api/ingest
  - สแกน BLE Peripheral ที่ชื่อขึ้นต้น "ESP32_"
  - ต่อเป็น Central หลายอุปกรณ์ (NimBLE รองรับ multi-connection)
  - Subscribe Notification ของ Char UUID
  - เมื่อได้ payload (JSON) -> แปลงเป็นรูปแบบที่ server.js รอ -> POST http://<server>/api/ingest

  ไลบรารีที่ต้องติดตั้ง:
  - NimBLE-Arduino (h2zero)
  - ArduinoJson (Benoit Blanchon)

  ปรับค่า CONFIG ด้านล่างให้ตรงกับระบบคุณ
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <ArduinoJson.h>

// ---- CONFIG ----
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";

// ตัวอย่าง: ถ้า server.js รันบนคอมเดียวกันกับบอร์ด (ผ่านเครือข่ายเดียวกัน)
// ใส่ IP เครื่อง server เช่น "http://192.168.1.50:3000/api/ingest"
// หรือถ้าเปิดในเครื่องเดียวกันกับ Serial Monitor ไม่ได้ ต้องระบุ IP จริงของคอมพ์
String SERVER_INGEST_URL = "http://192.168.1.50:3000/api/ingest";

static BLEUUID SERVICE_UUID("12345678-1234-5678-1234-56789abcdef0");
static BLEUUID CHAR_UUID   ("12345678-1234-5678-1234-56789abcdea0");

// คัดกรองโฆษณาจากชื่ออุปกรณ์
const char* DEVICE_NAME_PREFIX = "ESP32_";

// จำกัดจำนวนการเชื่อมต่อพร้อมกัน (ขึ้นกับ RAM/งาน) 
const uint8_t MAX_CONNECTIONS = 3;

// ---- เก็บสถานะการเชื่อมต่อ ----
struct Conn {
  NimBLEClient* client = nullptr;
  BLEAddress address = BLEAddress((uint8_t*)"\0\0\0\0\0\0");
  String name = "";
  bool inUse = false;
} connections[MAX_CONNECTIONS];

// ช่วยเช็คว่า address นี้เชื่อมต่อไปแล้วหรือยัง
int findConnectionSlotByAddr(const BLEAddress& addr) {
  for (int i=0; i<MAX_CONNECTIONS; ++i) {
    if (connections[i].inUse && connections[i].address.equals(addr)) return i;
  }
  return -1;
}

int findFreeConnectionSlot() {
  for (int i=0; i<MAX_CONNECTIONS; ++i) {
    if (!connections[i].inUse) return i;
  }
  return -1;
}

// ---- โพสต์ไป /api/ingest ----
bool postIngest(const String& deviceId, float t, float h, float s, uint32_t l) {
  if (WiFi.status() != WL_CONNECTED) return false;

  // สร้าง JSON ตามฟอร์แมตของ server.js
  // { "deviceId": "...", "sensors": { "temperature":..., "humidity":..., "soilMoisture":..., "lightLevel":... }, "active": true }
  StaticJsonDocument<256> doc;
  doc["deviceId"] = deviceId;
  JsonObject sensors = doc.createNestedObject("sensors");
  sensors["temperature"]  = t;
  sensors["humidity"]     = h;
  sensors["soilMoisture"] = s;
  sensors["lightLevel"]   = l;
  doc["active"] = true;

  String payload;
  serializeJson(doc, payload);

  HTTPClient http;
  http.begin(SERVER_INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  http.end();

  Serial.printf("[POST] %s -> %d\n", deviceId.c_str(), code);
  return (code >= 200 && code < 300);
}

// ---- Callback เมื่อได้รับ Notify จาก Char ----
class NotifyCB : public NimBLERemoteCharacteristicCallbacks {
  void onNotify(NimBLERemoteCharacteristic* pRC, uint8_t* pData, size_t length, bool isNotify) override {
    // คาดว่า payload เป็น JSON: {"deviceId":"ESP32_001","t":28.7,"h":62.1,"s":31.5,"l":455}
    String json = String((const char*)pData).substring(0, length);
    Serial.print("[Notify] Raw: "); Serial.println(json);

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
      Serial.printf("JSON parse fail: %s\n", err.c_str());
      return;
    }

    String deviceId = doc["deviceId"] | "UNKNOWN";
    float t = doc["t"] | doc["temperature"] | 0.0;
    float h = doc["h"] | doc["humidity"]    | 0.0;
    float s = doc["s"] | doc["soilMoisture"]| 0.0;
    uint32_t l = doc["l"] | doc["lightLevel"] | 0;

    postIngest(deviceId, t, h, s, l);
  }
} notifyCB;

// ---- เชื่อมต่อ และ subscribe characteristic ----
bool connectAndSubscribe(int slot, NimBLEAdvertisedDevice* adv) {
  connections[slot].client = NimBLEDevice::createClient();
  connections[slot].client->setConnectionParams(12, 12, 0, 51); // ค่ามาตรฐาน OK
  connections[slot].client->setClientCallbacks(nullptr, false);

  Serial.printf("Connecting to %s (%s)\n", connections[slot].name.c_str(), adv->getAddress().toString().c_str());
  if(!connections[slot].client->connect(adv)) {
    Serial.println("Connect failed");
    NimBLEDevice::deleteClient(connections[slot].client);
    connections[slot].client = nullptr;
    connections[slot].inUse = false;
    return false;
  }

  auto* svc = connections[slot].client->getService(SERVICE_UUID);
  if (!svc) { Serial.println("Service not found"); goto fail; }

  auto* chr = svc->getCharacteristic(CHAR_UUID);
  if (!chr) { Serial.println("Char not found"); goto fail; }

  if (!chr->canNotify()) { Serial.println("Char not notifiable"); goto fail; }

  if (!chr->subscribe(true, &notifyCB)) { Serial.println("Subscribe failed"); goto fail; }

  Serial.println("Subscribed OK");
  return true;

fail:
  connections[slot].client->disconnect();
  NimBLEDevice::deleteClient(connections[slot].client);
  connections[slot].client = nullptr;
  connections[slot].inUse = false;
  return false;
}

// ---- สแกนหาอุปกรณ์ ----
class ScanCB : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* adv) override {
    std::string name = adv->getName();
    if (name.empty()) return;
    // คัดเฉพาะชื่อที่ขึ้นต้นด้วย DEVICE_NAME_PREFIX
    if (name.rfind(DEVICE_NAME_PREFIX, 0) != 0) return;

    // รับเฉพาะที่โฆษณา service นี้
    if (!adv->isAdvertisingService(SERVICE_UUID)) return;

    BLEAddress addr = adv->getAddress();
    if (findConnectionSlotByAddr(addr) != -1) return; // ต่อแล้ว

    int slot = findFreeConnectionSlot();
    if (slot == -1) return; // เต็ม

    connections[slot].inUse = true;
    connections[slot].address = addr;
    connections[slot].name = String(name.c_str());

    NimBLEDevice::getScan()->stop(); // หยุดชั่วคราวเพื่อเชื่อมต่อ
    connectAndSubscribe(slot, adv);
    NimBLEDevice::getScan()->start(0, nullptr, false); // เริ่มสแกนต่อ
  }
} scanCB;

// ---- ตั้งค่า WiFi ----
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting WiFi %s", WIFI_SSID);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK, IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi FAIL");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  connectWiFi();

  NimBLEDevice::init("ESP32_Gateway");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9); // เพิ่มกำลังส่ง/รับ (ปรับตามเหมาะสม)

  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(&scanCB);
  scan->setInterval(45);
  scan->setWindow(15);
  scan->setActiveScan(true);
  scan->start(0, nullptr, false); // 0 = สแกนไม่จำกัดเวลา
  Serial.println("Scanning BLE...");
}

void loop() {
  // ไม่มีอะไรเป็นพิเศษ ปล่อยให้ callback ทำงาน
  delay(1000);

  // (ออปชัน) ลอง reconnect WiFi ถ้าหลุด
  static unsigned long lastWiFiChk = 0;
  if (millis() - lastWiFiChk > 10000) {
    lastWiFiChk = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi reconnecting...");
      connectWiFi();
    }
  }
}




------------------------------------------------------------------------

วิธีใช้ (สั้นมาก)
- แก้ค่าในส่วน CONFIG:
- WIFI_SSID, WIFI_PASS
- SERVER_INGEST_URL (เช่น http://<IP server>:3000/api/ingest)
- SERVICE_UUID, CHAR_UUID, DEVICE_NAME_PREFIX ให้ตรงกับเซ็นเซอร์
- อัปโหลดลง ESP32 (ตัวที่ทำหน้าที่ Gateway)
- เปิด Serial Monitor ดู log
ถ้าเจออุปกรณ์ที่ชื่อขึ้นต้น ESP32_ และ Service UUID ตรง → จะ Subscribed OK
ทันทีที่ Peripheral ส่ง JSON → จะ POST เข้าหา /api/ingest ของ server.js คุณ

-------------------------

TIP
- ถ้าอยากส่ง name/location เพิ่ม ให้แก้ postIngest() ใส่ฟิลด์เพิ่มได้เลย (server.js รองรับ)
- ถ้าจะต่อหลายตัวพร้อมกัน ให้ Peripheral ใช้ deviceId คนละค่า (ESP32_001, ESP32_002, …)
- ถ้าค่าเป็นไบนารี ไม่ใช่ JSON: แก้ใน onNotify() ให้แปลง buffer → ค่า t/h/s/l เอง ก่อนเรียก postIngest()