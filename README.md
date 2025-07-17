🔧 ฟีเจอร์ใหม่สำหรับการใช้งานจริง:
1. WebSocket Connection

เชื่อมต่อแบบ Real-time กับ ESP32 Server
Auto-reconnect เมื่อหลุดการเชื่อมต่อ
Connection status indicator

2. HTTP API Fallback

ใช้ HTTP polling เมื่อ WebSocket ล้มเหลว
GET /api/devices - ดึงข้อมูลทุกอุปกรณ์
POST /api/command - ส่งคำสั่งไปยัง ESP32

3. Configuration
javascriptconst CONFIG = {
    ESP32_SERVER_IP: '192.168.1.100',  // แก้ไข IP ของ ESP32 Server
    HTTP_PORT: 80,
    WEBSOCKET_PORT: 81,
    POLLING_INTERVAL: 5000,
    CONNECTION_TIMEOUT: 10000
};
📡 การตั้งค่า ESP32 Server:
คุณต้องเขียนโค้ด ESP32 Server ที่รองรับ:
WebSocket Format:
json{
    "deviceId": "ESP32_001",
    "sensors": {
        "temperature": 25.5,
        "humidity": 65.2,
        "soilMoisture": 45.8,
        "lightLevel": 850
    }
}
HTTP API Format:
json{
    "devices": [
        {
            "id": "ESP32_001",
            "active": true,
            "lastSeen": "2024-07-17T10:30:00Z",
            "sensors": {
                "temperature": 25.5,
                "humidity": 65.2,
                "soilMoisture": 45.8,
                "lightLevel": 850
            }
        }
    ]
}


🚀 วิธีใช้งาน:

แก้ไข IP Address ใน CONFIG.ESP32_SERVER_IP
ตั้งค่า ESP32 Server ให้รองรับ WebSocket และ HTTP API
เปิด Dashboard ในเบราว์เซอร์
ตรวจสอบการเชื่อมต่อ ที่ Status Bar

📋 ESP32 Server Requirements:
WebSocket Endpoint:

ws://[IP]:81/ws - รับ/ส่งข้อมูล real-time

HTTP Endpoints:

GET /api/devices - ดึงข้อมูลทุกอุปกรณ์
POST /api/command - ส่งคำสั่งไปยัง client

🛠️ คุณสมบัติเพิ่มเติม:

Auto-reconnect: พยายามเชื่อมต่อใหม่อัตโนมัติ
Health Check: ตรวจสอบสถานะอุปกรณ์
Manual Refresh: ปุ่ม Refresh Data
Error Handling: จัดการข้อผิดพลาดการเชื่อมต่อ