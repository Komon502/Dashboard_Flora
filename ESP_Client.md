/*
  ESP32_Client (BLE Peripheral) -> Notify JSON ให้กับ ESP32 Gateway (Central)
  - Service: 12345678-1234-5678-1234-56789abcdef0
  - Char(Notify): 12345678-1234-5678-1234-56789abcdea0
  - Optional Char(Write): 12345678-1234-5678-1234-56789abcdea9 (รับคำสั่ง)

  ใช้ Arduino IDE + ไลบรารี:
  - NimBLE-Arduino (h2zero)
  - (ออปชัน) DHT sensor library (ถ้าใช้ DHT11/22)
*/

// ====== ตั้งค่าตัวตนแต่ละเครื่อง ======
#define DEVICE_ID   "ESP32_001"       // เปลี่ยนเป็น ESP32_002, ESP32_003 สำหรับตัวที่ 2/3
#define BLE_NAME    "ESP32_001"       // ชื่อที่โฆษณา (ควรตรงกับ DEVICE_ID เพื่อให้ Gateway จับคู่ได้ง่าย)

// ====== UUID ======
#include <NimBLEDevice.h>
static BLEUUID SERVICE_UUID("12345678-1234-5678-1234-56789abcdef0");
static BLEUUID CHAR_NOTIFY_UUID("12345678-1234-5678-1234-56789abcdea0");
static BLEUUID CHAR_CMD_UUID   ("12345678-1234-5678-1234-56789abcdea9"); // optional write

// ====== ใช้เซนเซอร์จริงหรือจำลอง ======
// ตั้งค่าเซนเซอร์จริง (ตัวอย่าง DHT22 + soil analog + LDR analog)
// #define USE_REAL_SENSORS

#ifdef USE_REAL_SENSORS
  #include <DHT.h>
  #define DHTPIN  14      // ขา D14 (เปลี่ยนได้)
  #define DHTTYPE DHT22   // หรือ DHT11
  DHT dht(DHTPIN, DHTTYPE);

  #define SOIL_PIN  34    // ADC1_CH6 (เปลี่ยนได้)
  #define LDR_PIN   35    // ADC1_CH7 (เปลี่ยนได้)
#endif

// ====== ตัวแปร BLE ======
NimBLEServer* pServer = nullptr;
NimBLECharacteristic* pCharNotify = nullptr;
NimBLECharacteristic* pCharCmd = nullptr;

bool deviceConnected = false;

// ====== Callback Server ======
class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pS) override {
    deviceConnected = true;
    Serial.println("Central connected");
  }
  void onDisconnect(NimBLEServer* pS) override {
    deviceConnected = false;
    Serial.println("Central disconnected");
    // ให้โฆษณาต่อ
    NimBLEDevice::startAdvertising();
  }
};

// ====== รับคำสั่งจาก Gateway (ถ้าใช้งาน) ======
class CmdCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    std::string v = c->getValue();
    Serial.print("[CMD] "); Serial.println(v.c_str());
    // TODO: parse คำสั่ง เช่น "WATER_ON", "CALIBRATE" แล้วทำงานตามต้องการ
  }
};

// ====== อ่านค่าเซนเซอร์ ======
float readTemperatureC() {
#ifdef USE_REAL_SENSORS
  float t = dht.readTemperature();
  if (isnan(t)) return 0.0;
  return t;
#else
  // จำลองค่า 24.0 - 33.0
  return 24.0 + (float)(esp_random() % 90) / 10.0;
#endif
}

float readHumidity() {
#ifdef USE_REAL_SENSORS
  float h = dht.readHumidity();
  if (isnan(h)) return 0.0;
  return h;
#else
  // จำลองค่า 40.0 - 80.0
  return 40.0 + (float)(esp_random() % 400) / 10.0;
#endif
}

// soil moisture (%) แปลงค่า ADC → 0-100 (ต้องคาลิเบรตจริงหน้างาน)
float readSoilMoisturePercent() {
#ifdef USE_REAL_SENSORS
  int adc = analogRead(SOIL_PIN); // 0..4095
  // สมมติ: เปียกมาก = ค่า ADC ต่ำ, แห้ง = ค่า ADC สูง (ขึ้นกับเซนเซอร์จริง)
  // ควรคาลิเบรตสองจุด: เปียกสุด + แห้งสุด
  const int WET_ADC  = 1200; // ปรับตามจริง
  const int DRY_ADC  = 3200; // ปรับตามจริง
  int clamped = constrain(adc, WET_ADC, DRY_ADC);
  float pct = 100.0f * (float)(DRY_ADC - clamped) / (float)(DRY_ADC - WET_ADC);
  return constrain(pct, 0.0f, 100.0f);
#else
  // จำลอง 20.0 - 70.0
  return 20.0 + (float)(esp_random() % 500) / 10.0;
#endif
}

// light level (lux) — ถ้าใช้ LDR บน ADC ให้แปลงแบบง่าย ๆ (ค่าใกล้เคียง)
uint32_t readLightLevelLux() {
#ifdef USE_REAL_SENSORS
  int adc = analogRead(LDR_PIN); // 0..4095
  // map แบบคร่าว ๆ: ยิ่งสว่าง ADC ยิ่งต่ำ/สูง ขึ้นกับวงจรต่อ
  // สมมติ: ADC สูง = สว่างมาก
  long lux = map(adc, 0, 4095, 50, 2000);
  return (uint32_t)lux;
#else
  // จำลอง 200..1500
  return 200 + (esp_random() % 1300);
#endif
}

// ====== สร้าง JSON แล้ว Notify ======
void notifySensors() {
  float t = readTemperatureC();
  float h = readHumidity();
  float s = readSoilMoisturePercent();
  uint32_t l = readLightLevelLux();

  // JSON สั้น ๆ (ไม่มี ArduinoJson เพื่อลดโหลดฝั่ง Sensor)
  // {"deviceId":"ESP32_001","t":28.7,"h":62.1,"s":31.5,"l":455}
  char buf[128];
  snprintf(buf, sizeof(buf),
           "{\"deviceId\":\"%s\",\"t\":%.1f,\"h\":%.1f,\"s\":%.1f,\"l\":%u}",
           DEVICE_ID, t, h, s, (unsigned)l);

  pCharNotify->setValue((uint8_t*)buf, strlen(buf));
  pCharNotify->notify(); // ส่ง Notify
  Serial.print("[Notify] "); Serial.println(buf);
}

void setup() {
  Serial.begin(115200);
  delay(500);

#ifdef USE_REAL_SENSORS
  dht.begin();
  analogReadResolution(12); // 0..4095
  // ถ้าใช้ขา ADC2 อาจใช้ Wi-Fi ไม่ได้ แนะนำ ADC1 (GPIO32-39)
#endif

  // ---- BLE init ----
  NimBLEDevice::init(BLE_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P6); // ปรับระดับสัญญาณตามต้องการ
  NimBLEDevice::setSecurityAuth(false, false, true); // ไม่บังคับ pair

  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCB());

  NimBLEService* svc = pServer->createService(SERVICE_UUID);

  // Notify characteristic
  pCharNotify = svc->createCharacteristic(
      CHAR_NOTIFY_UUID,
      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );

  // Optional: Command characteristic (Write)
  pCharCmd = svc->createCharacteristic(
      CHAR_CMD_UUID,
      NIMBLE_PROPERTY::WRITE
  );
  pCharCmd->setCallbacks(new CmdCB());

  svc->start();

  // โฆษณา Service UUID + ชื่อ
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();

  Serial.println("BLE advertising started");
}

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 2000; // ส่งทุก 2s

void loop() {
  // ส่งเมื่อมี Central ต่ออยู่เท่านั้น (ลดภาระงาน)
  if (deviceConnected && (millis() - lastSend >= SEND_INTERVAL_MS)) {
    lastSend = millis();
    notifySensors();
  }
  delay(10);
}

----------------------------

ใช้งาน “หลายตัว” ทำยังไง?
ให้คัดลอกสเก็ตช์นี้ไปอีก 2 ไฟล์ หรืออัปโหลดซ้ำและ แก้ 2 บรรทัดนี้ให้ไม่ซ้ำกัน ในแต่ละบอร์ด:
#define DEVICE_ID   "ESP32_001"   // → ตัวถัดไปใช้ "ESP32_002", "ESP32_003"
#define BLE_NAME    "ESP32_001"   // → ตั้งให้ตรงกับ DEVICE_ID จะดีมาก

**หมายเหตุ: Gateway ของคุณคัดกรองจากชื่อที่ขึ้นต้น ESP32_ + Service UUID ตรงกัน เมื่อ Central subscribe แล้วข้อมูลจากแต่ละตัวจะแยกกันด้วย deviceId (เช่น ESP32_001/2/3) ทำให้ /api/ingest รู้ว่าเป็นอุปกรณ์ตัวไหน

------------------------------

Wiring (ถ้าใช้เซนเซอร์จริง)
DHT22: VCC(3.3V), GND, DATA → GPIO14 (ในตัวอย่าง) + ตัวต้านทานดึงขึ้น 10k ที่ DATA
Soil Moisture (Analog): AO → GPIO34 (ADC1), VCC(3.3V), GND
LDR (Analog + Divider): ต่อแบ่งแรงดันให้เข้า GPIO35 (ADC1)
อย่าใช้ ADC2 ถ้าจะต่อ Wi-Fi (แม้ใน client ไม่ใช้ Wi-Fi ก็จริง แต่เลี่ยงไว้ปลอดภัย)

------------------------------

เช็คการทำงาน
อัปโหลดโค้ดลง ESP32 Sensor ทีละตัว (แก้ DEVICE_ID/BLE_NAME ให้ต่างกัน)
เปิด Serial Monitor (115200) → จะเห็นบรรทัด [Notify] {...} เมื่อมี Central ต่อ
ฝั่ง ESP32 Server (Gateway) จะ log [POST] ESP32_00X -> 200 และ Dashboard จะอัปเดตค่าแบบเรียลไทม์