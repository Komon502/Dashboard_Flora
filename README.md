Flora Care System Dashboard
แดชบอร์ดดูค่าจาก ESP32 BLE ผ่าน Gateway → Server → เว็บ
รันได้ทันที พร้อมข้อมูลทดสอบ (Mock Data)

วิธีรัน

# ติดตั้ง
npm install
# รันเซิร์ฟเวอร์
npm start
# เปิดเว็บ
http://localhost:3000


โครงสร้าง

flora-care-dashboard/
├─ server.js          # Backend + Mock Data + API + WebSocket
├─ package.json
└─ public/
   ├─ index.html      # หน้าเว็บ
   ├─ style.css       # สไตล์
   └─ script.js       # ลอจิก UI


   การทำงาน

ESP32 (BLE Peripheral) → ส่งค่าผ่าน BLE
Gateway (BLE Central + Wi-Fi) → แปลงเป็น JSON → ส่ง POST /api/ingest
Server อัปเดต + ส่งสดผ่าน WebSocket ให้หน้าเว็บ
หน้าเว็บ รับสดผ่าน WS หรือ fallback ด้วย HTTP
ในโหมดทดสอบ server.js สร้างข้อมูลสุ่มทุก 5 วิ


API หลัก

GET /api/devices → ข้อมูลปัจจุบันทุกอุปกรณ์
POST /api/ingest → ส่งข้อมูลจาก Gateway → Server
POST /api/command → ส่งคำสั่งจากหน้าเว็บ → Gateway
WebSocket /ws → ข้อมูลสด


ตัวอย่าง ingest

{
  "deviceId":"ESP32_001",
  "sensors":{"temperature":28.7,"humidity":62.1,"soilMoisture":31.5,"lightLevel":455},
  "active":true
}


ปิด Mock Data

ไปที่ server.js → คอมเมนต์บรรทัด:
setInterval(randomize, 5000);



ต่อกับ BLE จริง

- ESP32 ส่งค่า BLE (Notification)
- Gateway อ่านค่า → ส่ง POST /api/ingest
- หน้าเว็บจะแสดงผลทันที