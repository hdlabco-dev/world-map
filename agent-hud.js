/**
 * agent-hud.js — Agent 即時狀態面板
 * 左側固定面板，顯示大史/小紅/小林的即時狀態
 */

// ── CityBus (簡易 pub/sub，若尚未由其他模組定義則在此初始化) ──────────
window.CityBus = window.CityBus || (() => {
  const listeners = {};
  return {
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    emit(event, data) {
      (listeners[event] || []).forEach(fn => fn(data));
    },
  };
})();

// ── Agent 定義 ─────────────────────────────────────────────────────────
const AGENTS = {
  dashi:    { name: '大史', role: 'CTO',      color: '#f59e0b', emoji: '👨‍💼' },
  xiaohong: { name: '小紅', role: 'Frontend', color: '#ec4899', emoji: '👩‍💻' },
  xiaolin:  { name: '小林', role: 'QA',       color: '#22c55e', emoji: '🧪' },
};

// ── Status 狀態對應 ────────────────────────────────────────────────────
const STATUS_LABELS = {
  idle:     '待命中',
  working:  '工作中',
  pr_open:  'PR 審核中',
  done:     '完成',
};

const STATUS_DOT_COLORS = {
  idle:    '#94a3b8',
  working: '#f59e0b',
  pr_open: '#60a5fa',
  done:    '#22c55e',
};

// ── 注入 CSS ───────────────────────────────────────────────────────────
function injectHUDStyles() {
  const style = document.createElement('style');
  style.id = 'agent-hud-styles';
  style.textContent = `
    #agent-hud {
      position: fixed;
      top: 56px;
      left: 12px;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 200px;
      font-family: 'Noto Sans TC', monospace, sans-serif;
    }

    #agent-hud .hud-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.2em;
      color: #00f5ff;
      text-shadow: 0 0 8px #00f5ff;
      padding: 0 4px 4px;
      border-bottom: 1px solid rgba(0, 245, 255, 0.3);
    }

    #agent-cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .agent-card {
      background: rgba(10, 10, 18, 0.85);
      border: 1px solid rgba(0, 245, 255, 0.15);
      border-left: 3px solid rgba(0, 245, 255, 0.15);
      border-radius: 4px;
      padding: 8px;
      display: flex;
      gap: 8px;
      align-items: flex-start;
      backdrop-filter: blur(4px);
      transition: border-color 0.3s, box-shadow 0.3s;
    }

    .agent-card.is-working {
      border-left-color: #f59e0b;
      box-shadow: -3px 0 10px rgba(245, 158, 11, 0.5), inset 0 0 12px rgba(245, 158, 11, 0.05);
      animation: agent-working-pulse 1.5s ease-in-out infinite;
    }

    .agent-card.is-pr-open {
      border-left-color: #60a5fa;
      box-shadow: -3px 0 10px rgba(96, 165, 250, 0.5), inset 0 0 12px rgba(96, 165, 250, 0.05);
    }

    @keyframes agent-working-pulse {
      0%, 100% { box-shadow: -3px 0 10px rgba(245, 158, 11, 0.4), inset 0 0 12px rgba(245, 158, 11, 0.05); }
      50%       { box-shadow: -3px 0 18px rgba(245, 158, 11, 0.8), inset 0 0 20px rgba(245, 158, 11, 0.1); }
    }

    @keyframes agent-done-flash {
      0%   { box-shadow: -3px 0 18px rgba(34, 197, 94, 0.9), inset 0 0 24px rgba(34, 197, 94, 0.15); }
      100% { box-shadow: none; }
    }

    .agent-card.is-done {
      animation: agent-done-flash 1.2s ease-out forwards;
    }

    .agent-card-avatar {
      font-size: 22px;
      line-height: 1;
      flex-shrink: 0;
    }

    .agent-card-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .agent-card-name {
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
    }

    .agent-card-role {
      font-size: 9px;
      color: #4a7a8a;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .agent-card-status {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 2px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94a3b8;
      flex-shrink: 0;
      transition: background 0.3s, box-shadow 0.3s;
    }

    .agent-card[data-status="working"] .status-dot {
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
      animation: dot-pulse 1.5s ease-in-out infinite;
    }

    .agent-card[data-status="pr_open"] .status-dot {
      background: #60a5fa;
      box-shadow: 0 0 6px #60a5fa;
    }

    .agent-card[data-status="done"] .status-dot {
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
    }

    @keyframes dot-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }

    .status-text {
      font-size: 9px;
      color: #e0f0ff;
      letter-spacing: 0.05em;
    }

    .agent-card-task {
      font-size: 9px;
      color: #4a7a8a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
      margin-top: 1px;
    }

    .agent-card-district {
      font-size: 9px;
      color: #4a7a8a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }

    #hud-ws-status {
      font-size: 9px;
      letter-spacing: 0.12em;
      color: #ef4444;
      padding: 4px 4px 0;
    }
  `;
  document.head.appendChild(style);
}

// ── 建立 HUD DOM ───────────────────────────────────────────────────────
function createAgentHUD() {
  injectHUDStyles();

  const hud = document.createElement('div');
  hud.id = 'agent-hud';

  const title = document.createElement('div');
  title.className = 'hud-title neon-text';
  title.textContent = 'AGENTS';
  hud.appendChild(title);

  const cards = document.createElement('div');
  cards.id = 'agent-cards';

  for (const [key, agent] of Object.entries(AGENTS)) {
    cards.appendChild(createAgentCard(key, agent));
  }
  hud.appendChild(cards);

  const wsStatus = document.createElement('div');
  wsStatus.id = 'hud-ws-status';
  wsStatus.textContent = '● OFFLINE';
  hud.appendChild(wsStatus);

  document.body.appendChild(hud);
}

function createAgentCard(key, agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.agent = key;
  card.dataset.status = 'idle';

  card.innerHTML = `
    <div class="agent-card-avatar">${agent.emoji}</div>
    <div class="agent-card-info">
      <div class="agent-card-name" style="color:${agent.color}">${agent.name}</div>
      <div class="agent-card-role">${agent.role}</div>
      <div class="agent-card-status">
        <span class="status-dot"></span>
        <span class="status-text">${STATUS_LABELS.idle}</span>
      </div>
      <div class="agent-card-task">待命中...</div>
      <div class="agent-card-district"></div>
    </div>
  `;
  return card;
}

// ── 更新 Card 狀態 ─────────────────────────────────────────────────────
function updateAgentCard(key, data) {
  const card = document.querySelector(`.agent-card[data-agent="${key}"]`);
  if (!card) return;

  const prevStatus = card.dataset.status;
  card.dataset.status = data.status || 'idle';
  card.querySelector('.status-text').textContent = STATUS_LABELS[data.status] || '待命中';
  card.querySelector('.agent-card-task').textContent = data.task || '待命中...';
  card.querySelector('.agent-card-district').textContent = data.district ? `📍 ${data.district}` : '';

  card.classList.toggle('is-working', data.status === 'working');
  card.classList.toggle('is-pr-open', data.status === 'pr_open');

  // 短暫綠色閃爍
  if (data.status === 'done' && prevStatus !== 'done') {
    card.classList.remove('is-done');
    void card.offsetWidth; // reflow to restart animation
    card.classList.add('is-done');
  } else if (data.status !== 'done') {
    card.classList.remove('is-done');
  }
}

// ── 初始化 ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  createAgentHUD();

  CityBus.on('city:state', (state) => {
    for (const [key, agent] of Object.entries(state.agents || {})) {
      updateAgentCard(key, agent);
    }
  });

  CityBus.on('agent:update', (data) => {
    updateAgentCard(data.agent, data);
  });

  CityBus.on('city:connected', () => {
    const el = document.getElementById('hud-ws-status');
    el.textContent = '● LIVE';
    el.style.color = '#22c55e';
  });

  CityBus.on('city:disconnected', () => {
    const el = document.getElementById('hud-ws-status');
    el.textContent = '● OFFLINE';
    el.style.color = '#ef4444';
  });
});
