/**
 * agent-overlay.js
 * Displays agent avatars on the Leaflet map and animates movement on agent:update events.
 *
 * Prerequisites:
 *   - window.CityMap  (map-engine.js)  must be loaded before this script
 *   - window.CityBus  (client-socket.js) must be available at runtime
 *   - window.cityState may provide initial agent positions
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Inject agent-marker CSS
  // ---------------------------------------------------------------------------
  (function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .agent-marker {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        cursor: default;
        pointer-events: none;
        filter: drop-shadow(0 0 6px rgba(0,0,0,0.8));
      }
      .agent-avatar {
        font-size: 22px;
        line-height: 1;
        background: rgba(8, 8, 20, 0.85);
        border: 1px solid rgba(0, 245, 255, 0.3);
        border-radius: 50%;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 8px rgba(0, 245, 255, 0.2);
      }
      .agent-name {
        font-family: 'Share Tech Mono', 'Courier New', monospace;
        font-size: 10px;
        color: #e0f0ff;
        background: rgba(8, 8, 20, 0.8);
        padding: 1px 4px;
        border-radius: 2px;
        white-space: nowrap;
        letter-spacing: 0.05em;
      }
      .agent-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #555;
        border: 1px solid rgba(255,255,255,0.2);
        margin-top: 1px;
      }
      .agent-status-dot.status-working {
        background: #f59e0b;
        border-color: #fbbf24;
        animation: agent-pulse 1s ease-in-out infinite;
        box-shadow: 0 0 6px #f59e0b;
      }
      .agent-status-dot.status-pr-open {
        background: #3b82f6;
        border-color: #60a5fa;
        box-shadow: 0 0 6px #3b82f6;
      }
      @keyframes agent-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: 0.6; transform: scale(1.4); }
      }
    `;
    document.head.appendChild(style);
  })();

  // ---------------------------------------------------------------------------
  // Agent definitions
  // ---------------------------------------------------------------------------
  const AGENTS = {
    dashi:    { name: '大史', role: 'CTO',      color: '#f59e0b', emoji: '👨‍💼' },
    xiaohong: { name: '小紅', role: 'Frontend', color: '#ec4899', emoji: '👩‍💻' },
    xiaolin:  { name: '小林', role: 'QA',       color: '#22c55e', emoji: '🧪' },
  };

  // Default spawn offsets from map center [lat, lng] for each agent
  const AGENT_OFFSETS = {
    dashi:    [ 0.5,  0.5],
    xiaohong: [ 0.5, -0.5],
    xiaolin:  [-0.5,  0.0],
  };

  let agentMarkers = {}; // agentKey -> L.Marker

  // ---------------------------------------------------------------------------
  // Patch CityMap.addDistrict to track district latlngs
  // (map-engine.js keeps _markers private; we mirror the latlng computation)
  // ---------------------------------------------------------------------------
  const _districtLatLngs = {};
  let _patchIndex = 0;

  function _regionToLatLng(region, index) {
    const pos = region.position || {};
    const px = pos.x !== undefined ? pos.x : (region.x || 0);
    const py = pos.y !== undefined ? pos.y : (region.y || 0);
    if (px === 0 && py === 0) {
      const col = index % 6;
      const row = Math.floor(index / 6);
      return [-(row * 3), col * 3];
    }
    return [-py / 100, px / 100];
  }

  const _origAddDistrict = window.CityMap.addDistrict.bind(window.CityMap);
  window.CityMap.addDistrict = function (region) {
    const isNew = !_districtLatLngs[region.id];
    _origAddDistrict(region);
    if (isNew) {
      _districtLatLngs[region.id] = _regionToLatLng(region, _patchIndex++);
    }
  };

  /**
   * Returns the [lat, lng] of a district marker, or null if unknown.
   * @param {string} districtId
   * @returns {Array|null}
   */
  window.CityMap.getDistrictLatLng = function (districtId) {
    return _districtLatLngs[districtId] || null;
  };

  // ---------------------------------------------------------------------------
  // Patch CityMap.init to dispatch 'citymap:ready' after the map is created
  // ---------------------------------------------------------------------------
  const _origInit = window.CityMap.init.bind(window.CityMap);
  window.CityMap.init = function () {
    const map = _origInit();
    window.dispatchEvent(new CustomEvent('citymap:ready'));
    return map;
  };

  // ---------------------------------------------------------------------------
  // Agent marker creation
  // ---------------------------------------------------------------------------
  function _createAgentIcon(key) {
    const agent = AGENTS[key];
    return L.divIcon({
      className: '',
      html: `<div class="agent-marker" data-agent="${key}">
        <div class="agent-avatar">${agent.emoji}</div>
        <div class="agent-name">${agent.name}</div>
        <div class="agent-status-dot"></div>
      </div>`,
      iconSize:   [60, 70],
      iconAnchor: [30, 35],
    });
  }

  function initAgentMarkers() {
    const map = window.CityMap.getMap();
    if (!map) return;

    for (const key of Object.keys(AGENTS)) {
      if (agentMarkers[key]) continue;

      const offset = AGENT_OFFSETS[key] || [0, 0];
      const marker = L.marker(offset, {
        icon: _createAgentIcon(key),
        zIndexOffset: 1000,
      }).addTo(map);

      agentMarkers[key] = marker;
    }
  }

  // ---------------------------------------------------------------------------
  // Status dot update
  // ---------------------------------------------------------------------------
  function updateAgentStatus(agentKey, status) {
    const marker = agentMarkers[agentKey];
    if (!marker) return;

    const el = marker.getElement();
    if (!el) return;

    const dot = el.querySelector('.agent-status-dot');
    if (!dot) return;

    dot.className = 'agent-status-dot';
    if (status === 'working')  dot.classList.add('status-working');
    if (status === 'pr_open')  dot.classList.add('status-pr-open');
    // idle: default grey (no extra class)
  }

  // ---------------------------------------------------------------------------
  // Move agent to district with dashed trail animation
  // ---------------------------------------------------------------------------
  function moveAgentToDistrict(agentKey, districtId) {
    const targetLatLng = window.CityMap.getDistrictLatLng(districtId);
    if (!targetLatLng) return;

    const marker = agentMarkers[agentKey];
    if (!marker) return;

    const from = marker.getLatLng();

    // Draw movement trail
    const trail = L.polyline([from, targetLatLng], {
      color:     AGENTS[agentKey].color,
      weight:    2,
      dashArray: '5,5',
      opacity:   0.8,
    }).addTo(window.CityMap.getMap());

    // Move the marker
    marker.setLatLng(targetLatLng);

    // Remove trail after 0.8 s
    setTimeout(() => trail.remove(), 800);
  }

  // ---------------------------------------------------------------------------
  // Initialisation — wire up CityBus events
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.CityBus === 'undefined') return;

    window.CityBus.on('city:state', (state) => {
      initAgentMarkers();
      if (!state || !state.agents) return;
      for (const [key, agent] of Object.entries(state.agents)) {
        if (agent.district) moveAgentToDistrict(key, agent.district);
        updateAgentStatus(key, agent.status);
      }
    });

    window.CityBus.on('agent:update', ({ agent, status, district }) => {
      updateAgentStatus(agent, status);
      if (district) moveAgentToDistrict(agent, district);
    });
  });
})();
