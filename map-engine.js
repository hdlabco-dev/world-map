/**
 * map-engine.js
 * Leaflet-based boundless city map engine for the knowledge world map.
 * Uses L.CRS.Simple (pixel coordinate space) + custom canvas grid tile layer.
 */
(function () {
  'use strict';

  let _map = null;
  let _markers = {}; // regionId -> { marker, latlng, region, circle }
  let _districtClickCallback = null;
  let _regionIndex = 0;

  // ---------------------------------------------------------------------------
  // Seeded PRNG (LCG) — keeps tile dots stable across redraws
  // ---------------------------------------------------------------------------
  function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s = Math.imul(s, 1664525) + 1013904223 >>> 0;
      return s / 0x100000000;
    };
  }

  // ---------------------------------------------------------------------------
  // Coordinate conversion
  // Region JSON stores position as { x, y } pixels (origin top-left).
  // Leaflet CRS.Simple expects [lat, lng] == [y-axis, x-axis].
  // We negate y so that increasing pixel-y maps downward on screen.
  // ---------------------------------------------------------------------------
  function regionToLatLng(region, index) {
    const pos = region.position || {};
    const px = pos.x !== undefined ? pos.x : (region.x || 0);
    const py = pos.y !== undefined ? pos.y : (region.y || 0);

    // If no position data, fall back to automatic grid layout
    if (px === 0 && py === 0) {
      const col = index % 6;
      const row = Math.floor(index / 6);
      return [-(row * 3), col * 3];
    }
    return [-py / 100, px / 100];
  }

  // ---------------------------------------------------------------------------
  // Cyberpunk city grid tile layer
  // ---------------------------------------------------------------------------
  function createCityGridLayer() {
    const CityGrid = L.GridLayer.extend({
      createTile: function (coords) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;

        const ctx = tile.getContext('2d');
        const w = size.x;
        const h = size.y;

        // Background
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, w, h);

        // Fine grid lines every 64px
        ctx.strokeStyle = 'rgba(0,245,255,0.08)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let x = 0; x < w; x += 64) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, h);
        }
        for (let y = 0; y < h; y += 64) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(w, y + 0.5);
        }
        ctx.stroke();

        // Major grid lines every 320px — align globally via tile coords
        const tileSize = size.x;
        const offX = ((coords.x * tileSize) % 320 + 320) % 320;
        const offY = ((coords.y * tileSize) % 320 + 320) % 320;

        ctx.strokeStyle = 'rgba(0,245,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = (320 - offX) % 320; x < w; x += 320) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, h);
        }
        for (let y = (320 - offY) % 320; y < h; y += 320) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(w, y + 0.5);
        }
        ctx.stroke();

        // City lights — tiny glowing dots
        const colors = ['#00f5ff', '#bf00ff', '#ff6b35'];
        const rand = seededRandom(coords.x * 73856093 ^ coords.y * 19349663);
        const dotCount = 18;

        for (let i = 0; i < dotCount; i++) {
          const dx = rand() * w;
          const dy = rand() * h;
          const opacity = 0.3 + rand() * 0.4;
          const color = colors[Math.floor(rand() * colors.length)];
          const r = 0.8 + rand() * 1.2;

          // Core dot
          ctx.globalAlpha = opacity;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(dx, dy, r, 0, Math.PI * 2);
          ctx.fill();

          // Soft glow halo
          const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, r * 5);
          glow.addColorStop(0, color);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = opacity * 0.25;
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(dx, dy, r * 5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = 1;
        return tile;
      }
    });

    return new CityGrid({ zIndex: 1, keepBuffer: 4 });
  }

  // ---------------------------------------------------------------------------
  // District marker icon
  // ---------------------------------------------------------------------------
  function createDistrictMarker(region, latlng) {
    const themeColor =
      (region.colorScheme && region.colorScheme.primary) || '#00f5ff';
    const accentColor =
      (region.colorScheme && region.colorScheme.accent) || '#bf00ff';
    const typeLabel = (region.theme || 'DISTRICT').toUpperCase();

    const icon = L.divIcon({
      className: 'district-marker',
      html: `<div class="marker-inner" style="--theme-color:${themeColor};--accent-color:${accentColor}">
        <div class="marker-icon">${region.icon || '📍'}</div>
        <div class="marker-name">${region.name}</div>
        <div class="marker-type">${typeLabel}</div>
      </div>`,
      iconSize: [140, 60],
      iconAnchor: [70, 30]
    });

    return L.marker(latlng, { icon });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  window.CityMap = {
    /**
     * Initialise the Leaflet map inside #map-container.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    init() {
      if (_map) return _map;

      _map = L.map('map-container', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 4,
        zoomControl: true,
        attributionControl: false
      });

      _map.setView([0, 0], 0);
      createCityGridLayer().addTo(_map);

      return _map;
    },

    /**
     * Add a region as a district marker on the map.
     * @param {Object} region - Region data object from data/regions/*.json
     */
    addDistrict(region) {
      if (!_map) this.init();
      if (_markers[region.id]) return; // already added

      const idx = _regionIndex++;
      const latlng = regionToLatLng(region, idx);
      const marker = createDistrictMarker(region, latlng);

      marker.on('click', () => {
        if (_districtClickCallback) {
          _districtClickCallback(region);
        }
      });

      marker.addTo(_map);
      _markers[region.id] = { marker, latlng, region, circle: null };
    },

    /**
     * Mark a district as explored: updates marker CSS class and draws a
     * translucent green glow circle around it.
     * @param {string} regionId
     */
    setDistrictExplored(regionId) {
      const entry = _markers[regionId];
      if (!entry) return;

      const el = entry.marker.getElement();
      if (el) el.classList.add('explored');

      if (!entry.circle) {
        entry.circle = L.circle(entry.latlng, {
          radius: 0.3,
          color: '#00ff88',
          weight: 1,
          fillColor: '#00ff88',
          fillOpacity: 0.05,
          opacity: 0.6,
          interactive: false
        }).addTo(_map);
        entry.circle.bringToBack();
      }
    },

    /**
     * Smoothly fly the viewport to a district.
     * @param {string} regionId
     */
    flyToDistrict(regionId) {
      const entry = _markers[regionId];
      if (!entry || !_map) return;
      _map.flyTo(entry.latlng, 2, { duration: 1.2, easeLinearity: 0.35 });
    },

    /**
     * Register a click handler invoked with the region object when a district
     * marker is clicked.
     * @param {Function} callback - callback(region)
     */
    onDistrictClick(callback) {
      _districtClickCallback = callback;
    },

    /**
     * Return the underlying Leaflet map instance.
     * @returns {L.Map}
     */
    getMap() {
      return _map;
    }
  };
})();
