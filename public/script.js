// --------- CONFIG ---------
const CONFIG = {
  HTTP_ORIGIN: `${location.protocol}//${location.host}`,
  WS_URL: (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws',
  POLLING_INTERVAL: 5000,
  CONNECTION_TIMEOUT: 10000
};

// --------- DEVICE STORE ---------
let devices = {};   // dynamic map
let dataLogs = [];
let logId = 1;
let websocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// --------- WS ---------
function initWebSocket() {
  try {
    websocket = new WebSocket(CONFIG.WS_URL);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttempts = 0;
      updateConnectionStatus(true);
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        processWebSocketData(data);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
      updateConnectionStatus(false);

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(() => {
          console.log(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
          initWebSocket();
        }, 5000);
      }
    };

    websocket.onerror = (err) => {
      console.error('WebSocket error:', err);
      updateConnectionStatus(false);
    };

  } catch (err) {
    console.error('initWebSocket failed:', err);
    updateConnectionStatus(false);
  }
}

function processWebSocketData(data) {
  if (!data.deviceId) return;

  if (!devices[data.deviceId]) {
    devices[data.deviceId] = {
      id: data.deviceId,
      name: `Device ${data.deviceId}`,
      location: "Unknown",
      isActive: false,
      lastSeen: null,
      sensors: { temperature: 0, humidity: 0, soilMoisture: 0, lightLevel: 0 }
    };
  }

  const device = devices[data.deviceId];
  device.isActive = true;
  device.lastSeen = new Date();

  if (data.sensors) {
    device.sensors = {
      temperature: parseFloat(data.sensors.temperature) || 0,
      humidity: parseFloat(data.sensors.humidity) || 0,
      soilMoisture: parseFloat(data.sensors.soilMoisture) || 0,
      lightLevel: parseFloat(data.sensors.lightLevel) || 0
    };
  }

  const logData = `T:${device.sensors.temperature.toFixed(1)}°C, H:${device.sensors.humidity.toFixed(1)}%, S:${device.sensors.soilMoisture.toFixed(1)}%, L:${device.sensors.lightLevel.toFixed(0)}lux`;
  addLog(device, logData);

  updateDeviceDisplay();
  updateStats();
  checkAlerts();
}

// --------- HTTP fallback ---------
async function fetchDeviceData() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.CONNECTION_TIMEOUT);

    const res = await fetch(`${CONFIG.HTTP_ORIGIN}/api/devices`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    processHttpData(data);
    updateConnectionStatus(true);

  } catch (err) {
    console.error('fetchDeviceData error:', err);
    updateConnectionStatus(false);
  }
}

function processHttpData(data) {
  if (data.devices && Array.isArray(data.devices)) {
    data.devices.forEach((dev) => {
      if (!devices[dev.id]) {
        devices[dev.id] = dev;
      } else {
        devices[dev.id] = { ...devices[dev.id], ...dev };
      }
      addLog(dev, `T:${dev.sensors.temperature}°C, H:${dev.sensors.humidity}%, S:${dev.sensors.soilMoisture}%, L:${dev.sensors.lightLevel}lux`);
    });

    updateDeviceDisplay();
    updateStats();
    checkAlerts();
  }
}

// --------- STATUS UI ---------
function updateConnectionStatus(isConnected) {
  const statusBar = document.querySelector('.status-bar');
  const indicator = statusBar.querySelector('.status-indicator');
  const text = document.getElementById('serverStatus');
  if (isConnected) {
    indicator.className = 'status-indicator status-online';
    text.textContent = 'Online';
  } else {
    indicator.className = 'status-indicator status-offline';
    text.textContent = 'Offline';
  }
}

// --------- COMMAND ---------
async function sendCommand(deviceId, command) {
  try {
    const res = await fetch(`${CONFIG.HTTP_ORIGIN}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, command })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    console.log('Command OK:', result);
  } catch (err) {
    console.error('sendCommand error:', err);
  }
}

// --------- RENDERING ---------
function updateDeviceDisplay() {
  const grid = document.getElementById('devicesGrid');
  grid.innerHTML = '';

  Object.values(devices).forEach(device => {
    const card = document.createElement('div');
    card.className = 'device-card';

    const last = device.lastSeen ? new Date(device.lastSeen) : null;
    const ageSec = last ? Math.floor((new Date() - last) / 1000) : 9999;
    const isRecent = ageSec < 60;

    card.innerHTML = `
      <div class="device-header">
        <h3 class="device-title">${device.name}</h3>
        <span class="device-status ${device.isActive ? 'status-active' : 'status-inactive'}">
          ${device.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div class="connection-indicator ${device.isActive ? '' : 'offline'}">
        <div class="connection-dot"></div>
        <span>ID: ${device.id} | ${device.location}</span>
      </div>

      <div class="sensor-grid">
        <div class="sensor-item">
          <div class="sensor-label">🌡️ Temperature</div>
          <div class="sensor-value">${device.sensors.temperature}<span class="sensor-unit">°C</span></div>
        </div>
        <div class="sensor-item">
          <div class="sensor-label">💧 Humidity</div>
          <div class="sensor-value">${device.sensors.humidity}<span class="sensor-unit">%</span></div>
        </div>
        <div class="sensor-item">
          <div class="sensor-label">🌱 Soil Moisture</div>
          <div class="sensor-value">${device.sensors.soilMoisture}<span class="sensor-unit">%</span></div>
        </div>
        <div class="sensor-item">
          <div class="sensor-label">☀️ Light Level</div>
          <div class="sensor-value">${device.sensors.lightLevel}<span class="sensor-unit">lux</span></div>
        </div>
      </div>

      <div class="last-update">
        Last Update: ${device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString('th-TH') : '--:--:--'}
        ${!isRecent && device.lastSeen ? `(${ageSec}s ago)` : ''}
      </div>
    `;

    grid.appendChild(card);
  });
}

function updateStats() {
  const actives = Object.values(devices).filter(d => d.isActive);

  document.getElementById('activeDevices').textContent = actives.length;
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('th-TH');
  document.getElementById('totalLogs').textContent = dataLogs.length;

  const setOrDash = (id, val) => document.getElementById(id).textContent = val ?? '--';

  if (actives.length > 0) {
    const avg = (arr) => (arr.reduce((a, b) => a + b, 0) / arr.length);
    setOrDash('avgTemp', avg(actives.map(d => d.sensors.temperature)).toFixed(1));
    setOrDash('avgHumidity', avg(actives.map(d => d.sensors.humidity)).toFixed(1));
    setOrDash('avgSoil', avg(actives.map(d => d.sensors.soilMoisture)).toFixed(1));
    setOrDash('avgLight', Math.round(avg(actives.map(d => d.sensors.lightLevel))));
  } else {
    setOrDash('avgTemp', '--');
    setOrDash('avgHumidity', '--');
    setOrDash('avgSoil', '--');
    setOrDash('avgLight', '--');
  }
}

function addLog(device, data) {
  const entry = {
    id: logId++,
    timestamp: new Date(),
    deviceId: device.id,
    deviceName: device.name,
    data
  };
  dataLogs.unshift(entry);
  if (dataLogs.length > 100) dataLogs = dataLogs.slice(0, 100);
  updateLogDisplay();
}

function updateLogDisplay() {
  const logContainer = document.getElementById('logContainer');
  logContainer.innerHTML = '';
  dataLogs.forEach(log => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `
      <div class="log-time">${log.timestamp.toLocaleString('th-TH')}</div>
      <div class="log-device">${log.deviceName}</div>
      <div class="log-data">${log.data}</div>
    `;
    logContainer.appendChild(row);
  });
}

function checkAlerts() {
  const alertContainer = document.getElementById('alertContainer');
  alertContainer.innerHTML = '';

  Object.values(devices).forEach(d => {
    if (d.lastSeen) {
      const secs = (new Date() - new Date(d.lastSeen)) / 1000;
      if (secs > 300) {
        const el = document.createElement('div');
        el.className = 'alert alert-error';
        el.textContent = `⚠️ ${d.name} ไม่ได้ส่งข้อมูลมาเป็นเวลา ${Math.floor(secs/60)} นาที`;
        alertContainer.appendChild(el);
      }
    }
    if (d.isActive) {
      if (d.sensors.soilMoisture < 20) {
        const el = document.createElement('div');
        el.className = 'alert alert-warning';
        el.textContent = `🌱 ${d.name} ความชื้นในดินต่ำ (${d.sensors.soilMoisture}%)`;
        alertContainer.appendChild(el);
      }
      if (d.sensors.temperature > 35) {
        const el = document.createElement('div');
        el.className = 'alert alert-warning';
        el.textContent = `🌡️ ${d.name} อุณหภูมิสูง (${d.sensors.temperature}°C)`;
        alertContainer.appendChild(el);
      }
    }
  });
}

function clearLogs() {
  if (confirm('คุณแน่ใจหรือไม่ที่จะลบ log ทั้งหมด?')) {
    dataLogs = [];
    updateLogDisplay();
    updateStats();
  }
}

function exportLogs() {
  if (dataLogs.length === 0) {
    alert('ไม่มีข้อมูล log ให้ export');
    return;
  }
  let csv = 'Timestamp,Device ID,Device Name,Data\n';
  dataLogs.forEach(log => {
    csv += `"${log.timestamp.toISOString()}","${log.deviceId}","${log.deviceName}","${log.data}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flora_logs_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// --------- INIT ---------
function refreshData() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    try {
      websocket.send(JSON.stringify({ type: 'refresh_request' }));
    } catch {}
  } else {
    fetchDeviceData();
  }
}

function init() {
  console.log('Initializing Flora Care Dashboard...');
  initWebSocket();

  setTimeout(() => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.log('WS not open -> fallback to HTTP polling');
      setInterval(fetchDeviceData, CONFIG.POLLING_INTERVAL);
    }
  }, 3000);

  updateDeviceDisplay();
  updateStats();
  checkAlerts();

  setInterval(() => {
    updateDeviceDisplay();
    updateStats();
    checkAlerts();
  }, 5000);

  document.getElementById('btnRefresh').onclick = refreshData;
  document.getElementById('btnClear').onclick = clearLogs;
  document.getElementById('btnExport').onclick = exportLogs;
}

window.addEventListener('load', init);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshData();
});
