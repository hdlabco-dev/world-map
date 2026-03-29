/**
 * client-socket.js — Socket.io 客戶端與城市事件 bus
 * 所有動態功能的基礎層，其他模組透過 window.CityBus 監聽事件。
 */

// 全域狀態
window.cityState = {
  agents: {},   // 從 server 同步
  events: [],   // 最近 50 筆
  connected: false
};

// 簡易 EventEmitter
window.CityBus = {
  _listeners: {},

  on(event, fn) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(fn);
  },

  emit(event, data) {
    const fns = this._listeners[event];
    if (fns) {
      fns.forEach(fn => fn(data));
    }
  },

  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  }
};

// city:reload 處理
CityBus.on('city:reload', (data) => {
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

// 連線狀態 HUD 更新
function updateConnectionStatus(connected) {
  const el = document.getElementById('hud-connection-status');
  if (!el) return;
  if (connected) {
    el.textContent = '● ONLINE';
    el.style.color = '#00ff88';
    el.style.animation = '';
  } else {
    el.textContent = '● OFFLINE';
    el.style.color = '#ff3333';
    el.style.animation = 'blink 1s step-start infinite';
  }
}

// Socket.io 連線（連接到同一個 origin，nginx proxy 已設定 /socket.io/ 路由）
(function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('[client-socket] Socket.io not loaded, skipping socket init');
    return;
  }

  const socket = io();

  socket.on('connect', async () => {
    window.cityState.connected = true;
    updateConnectionStatus(true);
    CityBus.emit('city:connected', {});

    // server 會自動發 city_state，但也準備 fallback
    setTimeout(async () => {
      if (Object.keys(window.cityState.agents).length === 0) {
        try {
          const res = await fetch('/api/city');
          const data = await res.json();
          window.cityState = { ...window.cityState, ...data };
          CityBus.emit('city:state', data);
        } catch (err) {
          console.warn('[client-socket] fallback fetch /api/city failed:', err);
        }
      }
    }, 2000);
  });

  socket.on('disconnect', () => {
    window.cityState.connected = false;
    updateConnectionStatus(false);
    CityBus.emit('city:disconnected', {});
  });

  socket.on('city_state', (data) => {
    window.cityState = { ...window.cityState, ...data };
    CityBus.emit('city:state', data);
  });

  socket.on('city_event', (data) => {
    window.cityState.events.unshift(data);
    if (window.cityState.events.length > 50) {
      window.cityState.events.length = 50;
    }
    CityBus.emit('city:event', data);
  });

  socket.on('agent_update', (data) => {
    if (data && data.id) {
      window.cityState.agents[data.id] = data;
    }
    CityBus.emit('agent:update', data);
  });

  socket.on('city_reload', (data) => {
    CityBus.emit('city:reload', data);
  });
})();
