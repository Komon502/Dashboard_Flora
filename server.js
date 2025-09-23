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

// เก็บสถานะอุปกรณ์แบบ dynamic
const devices = {};

// HTTP API: snapshot ล่าสุด
app.get('/api/devices', (req, res) => {
  res.json({ devices: Object.values(devices) });
});

// HTTP API: ingest จาก ESP32 Server/Client
app.post('/api/ingest', (req, res) => {
  const { deviceId, sensors, active, lastSeen, name, location } = req.body;
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'Missing deviceId' });
  }

  if (!devices[deviceId]) {
    // ถ้าเจอ device ใหม่ -> เพิ่มเข้ามา
    devices[deviceId] = {
      id: deviceId,
      name: name || `Device ${deviceId}`,
      location: location || "Unknown",
      isActive: true,
      lastSeen: new Date(),
      sensors: { temperature: 0, humidity: 0, soilMoisture: 0, lightLevel: 0 }
    };
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

  // broadcast ให้หน้าเว็บ
  broadcast({
    deviceId,
    sensors: devices[deviceId].sensors
  });

  res.json({ ok: true });
});

// HTTP API: command (mock)
app.post('/api/command', async (req, res) => {
  const { deviceId, command } = req.body || {};
  if (!deviceId || !devices[deviceId]) {
    return res.status(400).json({ ok: false, error: 'Invalid deviceId' });
  }
  console.log('[COMMAND]', deviceId, command);
  res.json({ ok: true });
});

const server = http.createServer(app);

// WebSocket
const wss = new WebSocket.Server({ server, path: '/ws' });
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// ❌ mock data ลบทิ้ง เพื่อให้รับแต่ข้อมูลจริงจาก ESP32
// setInterval(randomize, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP & WS listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/ in your browser`);
});
