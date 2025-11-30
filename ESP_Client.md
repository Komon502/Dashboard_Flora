// ==== ESP32 CLIENT: DHT11 + SOIL MOISTURE -> BLE JSON WRITE ====
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEClient.h>
#include <BLEScan.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ====== SENSOR CONFIG ======
#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

#define SOIL_PIN 34 // Analog pin สำหรับ soil sensor

// ====== BLE CONFIG ======
#define SERVICE_UUID        "580be265-87e1-4ab8-b78f-a5b5003b7dbd"
#define CHARACTERISTIC_UUID "580be265-87e1-4ab8-b78f-a5b5003b7dbd"
static const uint16_t TARGET_MTU = 185;

BLEClient* g_client = nullptr;
BLERemoteCharacteristic* g_char = nullptr;

// ====== CONNECT TO GATEWAY ======
bool connectToGateway(BLEAdvertisedDevice* dev) {
  if (!dev) return false;
  g_client = BLEDevice::createClient();
  if (!g_client->connect(dev)) {
    Serial.println("[BLE] connect failed");
    return false;
  }
  Serial.println("[BLE] connected");

  g_client->setMTU(TARGET_MTU);

  BLERemoteService* svc = g_client->getService(SERVICE_UUID);
  if (!svc) { Serial.println("[BLE] service not found"); return false; }

  g_char = svc->getCharacteristic(CHARACTERISTIC_UUID);
  if (!g_char) { Serial.println("[BLE] char not found"); return false; }

  if (!g_char->canWrite() && !g_char->canWriteNoResponse()) {
    Serial.println("[BLE] char is not writable");
    return false;
  }
  return true;
}

// ====== BLE SCAN ======
BLEAdvertisedDevice* findGateway() {
  BLEScan* scan = BLEDevice::getScan();
  scan->setActiveScan(true);
  Serial.println("[BLE] scanning...");

  BLEScanResults* results = scan->start(5, false);

  for (int i = 0; i < results->getCount(); i++) {
    BLEAdvertisedDevice* dev = new BLEAdvertisedDevice(results->getDevice(i));

    if (dev->haveServiceUUID() && dev->isAdvertisingService(BLEUUID(SERVICE_UUID))) {
      Serial.print("[BLE] found: ");
      Serial.println(dev->toString().c_str());
      scan->clearResults();
      return dev;
    }

    delete dev;
  }

  scan->clearResults();
  return nullptr;
}

bool ensureConnected() {
  if (g_client && g_client->isConnected() && g_char) return true;
  if (g_client) {
    g_client->disconnect();
    delete g_client;
    g_client = nullptr;
    g_char = nullptr;
  }
  BLEAdvertisedDevice* dev = findGateway();
  if (!dev) return false;
  bool ok = connectToGateway(dev);
  delete dev;
  return ok;
}

// ====== SETUP ======
void setup() {
  Serial.begin(9600);
  dht.begin();
  pinMode(SOIL_PIN, INPUT);

  BLEDevice::init("BLE_DHT_Soil_Client");
  BLEDevice::setMTU(TARGET_MTU);
}

// ====== MAIN LOOP ======
void loop() {
  if (!ensureConnected()) {
    Serial.println("[BLE] gateway not found. retry in 2s");
    delay(2000);
    return;
  }

  // --- อ่าน DHT11 ---
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("[DHT] read fail");
    delay(2000);
    return;
  }

  // --- อ่าน Soil Moisture (FIXED) ---
  int soilRaw = analogRead(SOIL_PIN);

  // ปกติ soil analog: 0 = แห้ง, 4095 = ชื้น
  float soilPercent = map(soilRaw, 0, 4095, 0, 100);
  soilPercent = constrain(soilPercent, 0, 100);

  Serial.printf("[SOIL] raw=%d  percent=%.1f%%\n", soilRaw, soilPercent);

  // --- สร้าง JSON ---
  StaticJsonDocument<256> doc;
  doc["deviceId"]    = "ESP32_DHT_Soil_02";
  doc["temperature"] = temperature;
  doc["humidity"]    = humidity;
  doc["soilRaw"]     = soilRaw;
  doc["soilPercent"] = soilPercent;
  doc["lastSeen"]    = (uint32_t)millis();

  char payload[180];
  size_t n = serializeJson(doc, payload, sizeof(payload));

  Serial.printf("[BLE] write %uB: %s\n", (unsigned)n, payload);

  bool withRsp = g_char->canWrite();
  g_char->writeValue((uint8_t*)payload, n, withRsp);

  delay(5000);
}