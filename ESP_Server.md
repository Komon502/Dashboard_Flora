// ESP32 Server (รับ BLE JSON แล้วส่ง HTTP ไป Node.js Dashboard)

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>   // ต้องติดตั้งเพิ่ม

const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASS";
const char* serverUrl = "http://10.10.1.2:3000/api/ingest";

// UUID ต้องตรงกับ Client
#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID "abcdefab-1234-1234-1234-abcdefabcdef"

class MyCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    std::string value = pCharacteristic->getValue();
    if (value.length() > 0) {
      Serial.print("Received via BLE: ");
      Serial.println(value.c_str());

      // Parse JSON ที่ Client ส่งมา
      StaticJsonDocument<200> doc;
      DeserializationError error = deserializeJson(doc, value);
      if (error) {
        Serial.print("JSON parse failed: ");
        Serial.println(error.c_str());
        return;
      }

      const char* deviceId = doc["deviceId"];
      float temp = doc["temperature"];
      float hum  = doc["humidity"];

      Serial.printf("Parsed -> ID:%s T:%.1f H:%.1f\n", deviceId, temp, hum);

      // ส่งไป Node.js
      if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        http.begin(serverUrl);
        http.addHeader("Content-Type", "application/json");

        // Build JSON body สำหรับ API /api/ingest
        String body;
        StaticJsonDocument<200> outDoc;
        outDoc["deviceId"] = deviceId;
        JsonObject sensors = outDoc.createNestedObject("sensors");
        sensors["temperature"] = temp;
        sensors["humidity"] = hum;
        outDoc["active"] = true;

        serializeJson(outDoc, body);

        int httpResponseCode = http.POST(body);
        Serial.printf("HTTP Response: %d\n", httpResponseCode);
        http.end();
      }
    }
  }
};

void setup() {
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi Connected");

  BLEDevice::init("ESP32_Server");
  BLEServer *pServer = BLEDevice::createServer();
  BLEService *pService = pServer->createService(SERVICE_UUID);
  BLECharacteristic *pCharacteristic = pService->createCharacteristic(
                                         CHARACTERISTIC_UUID,
                                         BLECharacteristic::PROPERTY_WRITE
                                       );
  pCharacteristic->setCallbacks(new MyCallbacks());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->start();
}

void loop() {
  delay(1000);
}
