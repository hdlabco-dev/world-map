/**
 * event-feed.js
 * 即時城市事件 ticker — 右下角滑入式事件通知
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Minimal CityBus — simple pub/sub event bus
  // If another module defines window.CityBus first, this is a no-op.
  // ---------------------------------------------------------------------------
  if (!window.CityBus) {
    window.CityBus = (function () {
      const _listeners = {};
      return {
        on(event, fn) {
          if (!_listeners[event]) _listeners[event] = [];
          _listeners[event].push(fn);
        },
        off(event, fn) {
          if (!_listeners[event]) return;
          _listeners[event] = _listeners[event].filter(f => f !== fn);
        },
        emit(event, data) {
          (_listeners[event] || []).forEach(fn => fn(data));
        }
      };
    })();
  }

  // ---------------------------------------------------------------------------
  // Agent metadata
  // ---------------------------------------------------------------------------
  const AGENT_COLORS = {
    dashi: '#f59e0b',
    xiaohong: '#ec4899',
    xiaolin: '#22c55e',
    system: '#00f5ff',
    unknown: '#94a3b8'
  };

  const AGENT_NAMES = {
    dashi: '大史',
    xiaohong: '小紅',
    xiaolin: '小林',
    system: 'SYSTEM',
    unknown: '???'
  };

  // Event type → icon mapping
  const EVENT_ICONS = {
    push: '⬆',
    pr_created: '🔀',
    merge: '✅',
    deploy: '⚡',
    error: '⚠',
    agent_update: '📍'
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const MAX_VISIBLE = 8;
  const AUTO_DISMISS_MS = 10000;
  let _feedList = null;
  let _countEl = null;
  let _visibleItems = []; // { el, timerId, pinned }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('zh-TW', { hour12: false });
  }

  function resolveAgent(event) {
    const key = (event.agent || 'unknown').toLowerCase();
    return {
      color: AGENT_COLORS[key] || AGENT_COLORS.unknown,
      name: AGENT_NAMES[key] || event.agent || '???'
    };
  }

  function updateCount() {
    if (_countEl) {
      const n = _visibleItems.length;
      _countEl.textContent = `${n} event${n !== 1 ? 's' : ''}`;
    }
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  function createFeedContainer() {
    if (document.getElementById('event-feed')) return;

    const feed = document.createElement('div');
    feed.id = 'event-feed';
    feed.innerHTML = `
      <div class="feed-header">
        <span class="neon-text">CITY LOG</span>
        <span id="feed-count">0 events</span>
      </div>
      <div id="feed-list"></div>
    `;
    document.body.appendChild(feed);

    _feedList = document.getElementById('feed-list');
    _countEl = document.getElementById('feed-count');
  }

  // ---------------------------------------------------------------------------
  // Add / remove feed items
  // ---------------------------------------------------------------------------
  function removeFeedItem(entry) {
    if (!entry) return;
    clearTimeout(entry.timerId);
    const el = entry.el;
    el.classList.add('feed-item--exit');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    _visibleItems = _visibleItems.filter(e => e !== entry);
    updateCount();
  }

  function addFeedItem(event) {
    if (!_feedList) return;

    const agent = resolveAgent(event);
    const type = event.type || 'agent_update';
    const icon = EVENT_ICONS[type] || '📍';
    const time = event.timestamp ? formatTime(event.timestamp) : formatTime(new Date().toISOString());
    const id = event.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Prune oldest item when at capacity
    if (_visibleItems.length >= MAX_VISIBLE) {
      const oldest = _visibleItems[0];
      if (!oldest.pinned) removeFeedItem(oldest);
    }

    // Build card
    const el = document.createElement('div');
    el.className = `feed-item feed-item--${type}`;
    el.dataset.id = id;
    el.innerHTML = `
      <span class="feed-icon">${icon}</span>
      <div class="feed-body">
        <span class="feed-agent" style="color:${agent.color}">${agent.name}</span>
        <span class="feed-msg">${event.message || ''}</span>
      </div>
      <span class="feed-time">${time}</span>
    `;

    // Insert at top of list so newest appears first
    _feedList.prepend(el);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('feed-item--visible'));
    });

    const entry = { el, timerId: null, pinned: false };
    _visibleItems.push(entry);
    updateCount();

    // Auto-dismiss after 10 s unless pinned
    entry.timerId = setTimeout(() => {
      if (!entry.pinned) removeFeedItem(entry);
    }, AUTO_DISMISS_MS);

    // Click to pin / unpin
    el.addEventListener('click', () => {
      entry.pinned = !entry.pinned;
      el.classList.toggle('feed-item--pinned', entry.pinned);
      if (entry.pinned) {
        clearTimeout(entry.timerId);
      } else {
        // Resume auto-dismiss
        entry.timerId = setTimeout(() => removeFeedItem(entry), AUTO_DISMISS_MS);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    createFeedContainer();

    // Show up to 5 historical events from city state
    CityBus.on('city:state', (state) => {
      (state.events || []).slice(0, 5).reverse().forEach(addFeedItem);
    });

    // Live incoming events
    CityBus.on('city:event', (event) => {
      addFeedItem(event);
    });
  });

  // Expose for external use / testing
  window.EventFeed = { addFeedItem };

})();
