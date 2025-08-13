// server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// เก็บสถานะอุปกรณ์ในหน่วยความจำ
const devices = {
  'ESP32_001': {
    id: 'ESP32_001',
    name: 'Plant Monitor A',
    location: 'Living Room',
    isActive: false,
    lastSeen: null,
    sensors: { temperature: 0, humidity: 0, soilMoisture: 0, lightLevel: 0 }
  },
  'ESP32_002': {
    id: 'ESP32_002',
    name: 'Plant Monitor B',
    location: 'Balcony',
    isActive: false,
    lastSeen: null,
    sensors: { temperature: 0, humidity: 0, soilMoisture: 0, lightLevel: 0 }
  },
  'ESP32_003': {
    id: 'ESP32_003',
    name: 'Plant Monitor C',
    location: 'Garden',
    isActive: false,
    lastSeen: null,
    sensors: { temperature: 0, humidity: 0, soilMoisture: 0, lightLevel: 0 }
  }
};

// HTTP API: หน้าเว็บจะเรียกเพื่อดึงสnapshot ล่าสุด
app.get('/api/devices', (req, res) => {
  res.json({ devices: Object.values(devices) });
});

// HTTP API: Gateway/Script ภายนอกจะโพสต์ค่ามาใส่ที่นี่
app.post('/api/ingest', (req, res) => {
  const { deviceId, sensors, active, lastSeen, name, location } = req.body;
  if (!deviceId || !devices[deviceId]) {
    return res.status(400).json({ ok: false, error: 'Invalid deviceId' });
  }

  devices[deviceId].isActive = active !== false;
  devices[deviceId].lastSeen = lastSeen ? new Date(lastSeen) : new Date();
  devices[deviceId].sensors = {
    temperature: Number(sensors?.temperature || 0),
    humidity: Number(sensors?.humidity || 0),
    soilMoisture: Number(sensors?.soilMoisture || 0),
    lightLevel: Number(sensors?.lightLevel || 0)
  };
  if (name) devices[deviceId].name = name;
  if (location) devices[deviceId].location = location;

  // broadcast ให้หน้าเว็บผ่าน WS (ตามรูปแบบที่ script.js รออยู่)
  broadcast({
    deviceId,
    sensors: devices[deviceId].sensors
  });

  res.json({ ok: true });
});

// HTTP API: หน้าเว็บกดส่งคำสั่ง -> คุณจะส่งต่อไป Gateway จริง (ที่นี่ mock ไว้)
app.post('/api/command', async (req, res) => {
  const { deviceId, command } = req.body || {};
  if (!deviceId || !devices[deviceId]) {
    return res.status(400).json({ ok: false, error: 'Invalid deviceId' });
  }
  console.log('[COMMAND]', deviceId, command);
  // TODO: ที่จริงคุณจะไปเรียก Gateway ต่อ (BLE write) ที่นี่เป็น mock
  res.json({ ok: true });
});

const server = http.createServer(app);

// WebSocket server ใช้พอร์ตเดียวกับ HTTP (path /ws)
const wss = new WebSocket.Server({ server, path: '/ws' });
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// (ตัวเลือก) Mock data generator สำหรับทดสอบแบบไม่ต้องมี ESP32
function randomize() {
  for (const id of Object.keys(devices)) {
    const d = devices[id];
    d.isActive = true;
    d.lastSeen = new Date();
    d.sensors = {
      temperature: +(20 + Math.random() * 12).toFixed(1),
      humidity: +(40 + Math.random() * 40).toFixed(1),
      soilMoisture: +(15 + Math.random() * 60).toFixed(1),
      lightLevel: Math.floor(200 + Math.random() * 1200)
    };
    broadcast({ deviceId: id, sensors: d.sensors });
  }
}
// เปิด mock ไหม? เปิดไว้ก่อนสำหรับเดโม
setInterval(randomize, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP & WS listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/ in your browser`);
});
