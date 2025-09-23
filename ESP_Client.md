#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

#define DHTPIN 4       // ขาที่ต่อ DHT11
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

const char* ssid = "YOUR_WIFI";      // ใส่ชื่อ WiFi
const char* password = "YOUR_PASS";  // ใส่รหัส WiFi

// เปลี่ยน IP ให้เป็น IP ของ PC ที่รัน Node.js (คุณคือ 10.10.1.2)
const char* serverUrl = "http://10.10.1.2:3000/api/ingest";

void setup() {
  Serial.begin(115200);
  dht.begin();

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT11 sensor!");
    delay(2000);
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    // JSON body
    String body = "{\"deviceId\":\"ESP32_DHT11\",\"sensors\":{\"temperature\":";
    body += t;
    body += ",\"humidity\":";
    body += h;
    body += "},\"active\":true}";

    int httpResponseCode = http.POST(body);

    Serial.print("Sent -> ");
    Serial.println(body);
    Serial.printf("HTTP Response: %d\n", httpResponseCode);

    http.end();
  } else {
    Serial.println("WiFi Disconnected!");
  }

  delay(5000); // ส่งทุก 5 วินาที
}
