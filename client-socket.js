// 全域狀態
window.cityState = {
  agents: {},   // 從 server 同步
  events: [],   // 最近 50 筆
  connected: false
};

// 簡易 EventEmitter（不用 npm，手寫）
window.CityBus = {
  _listeners: {},
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },
  emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  },
  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  }
};

// city:reload 處理
CityBus.on('city:reload', (data) => {
  // 顯示 SYSTEM UPDATE overlay 3 秒後 reload
  const overlay = document.createElement('div');
  overlay.id = 'system-update-overlay';
  overlay.innerHTML = `
    <div class="update-content">
      <div class="update-icon">⚡</div>
      <div class="update-title neon-text">SYSTEM UPDATE</div>
      <div class="update-msg">New build deploying...</div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => location.reload(), 3000);
});

// 連接到同一個 origin（nginx proxy 已設定 /socket.io/ 路由）
const socket = io();

socket.on('connect', async () => {
  window.cityState.connected = true;
  CityBus.emit('city:connected', {});

  // 連線狀態顯示
  const statusEl = document.getElementById('hud-connection-status');
  if (statusEl) {
    statusEl.textContent = '● ONLINE';
    statusEl.style.color = '#00ff88';
    statusEl.style.animation = '';
  }

  // server 會自動發 city_state，但也準備 fallback
  setTimeout(async () => {
    if (Object.keys(window.cityState.agents).length === 0) {
      const res = await fetch('/api/city');
      const data = await res.json();
      window.cityState = { ...window.cityState, ...data };
      CityBus.emit('city:state', data);
    }
  }, 2000);
});

socket.on('disconnect', () => {
  window.cityState.connected = false;
  CityBus.emit('city:disconnected', {});

  // 連線狀態顯示
  const statusEl = document.getElementById('hud-connection-status');
  if (statusEl) {
    statusEl.textContent = '● OFFLINE';
    statusEl.style.color = '#ff3333';
    statusEl.style.animation = 'blink 1s step-start infinite';
  }
});

socket.on('city_state', (data) => {
  window.cityState = { ...window.cityState, ...data };
  CityBus.emit('city:state', data);
});

socket.on('city_event', (data) => {
  window.cityState.events.unshift(data);
  if (window.cityState.events.length > 50) window.cityState.events.length = 50;
  CityBus.emit('city:event', data);
});

socket.on('agent_update', (data) => {
  if (data && data.id) window.cityState.agents[data.id] = data;
  CityBus.emit('agent:update', data);
});

socket.on('city_reload', (data) => {
  CityBus.emit('city:reload', data);
});
