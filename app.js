document.addEventListener("DOMContentLoaded", async () => {
    try {
        const worldRes = await fetch("data/world.json");
        if (!worldRes.ok) throw new Error("Failed to load world data");
        const worldData = await worldRes.json();

        initWorld(worldData);
        await renderRegions(worldData.regionIds);
        setupMapInteractions();
        setupSidebar();
    } catch (err) {
        console.error(err);
        document.getElementById("map-container").innerHTML = `<div style="color: red; padding: 2rem; background: rgba(0,0,0,0.8); position: absolute; top:50%; left:50%; transform:translate(-50%,-50%); border: 1px solid red; font-family: sans-serif;">Error: 無法載入世界資料。<br>請確認是否有使用 Local Server 啟動 (ex: python -m http.server)</div>`;
    }
});

let allRegionsData = [];

// --- Map Dragging & Zooming State ---
let isDragging = false;
let startX, startY;
// Center map initially
let currentX = -1000, currentY = -500;
let scale = 1;

// --- Progress System Constants ---
const PROGRESS_KEY = 'worldmap_progress';

const EXP_TABLE = { common: 10, uncommon: 20, rare: 40, legendary: 80 };

const RARITY_COLORS = {
    legendary: '#f59e0b',
    rare:      '#a855f7',
    uncommon:  '#3b82f6',
    common:    '#475569'
};

const RARITY_LABELS = {
    legendary: '傳說',
    rare:      '稀有',
    uncommon:  '非凡',
    common:    '普通'
};

const TYPE_ICONS = {
    scroll:    'fa-scroll',
    note:      'fa-note-sticky',
    blueprint: 'fa-drafting-compass'
};

let progress = {
    exploredNodes: new Set(),
    exp: 0,
    level: 1,
    expToNext: 1000
};

function setupMapInteractions() {
    const viewport = document.getElementById("viewport");

    // Apply init transforms
    updateMapTransform();

    // Drag events
    viewport.addEventListener('mousedown', (e) => {
        if (e.target.closest('.map-marker')) return;

        isDragging = true;
        startX = e.clientX - currentX;
        startY = e.clientY - currentY;
        viewport.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        viewport.style.cursor = 'grab';
    });

    viewport.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        currentX = e.clientX - startX;
        currentY = e.clientY - startY;
        clampMapBounds();
        updateMapTransform();
    });

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => {
        scale = Math.min(scale + 0.2, 2.5);
        clampMapBounds();
        updateMapTransform();
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
        scale = Math.max(scale - 0.2, 0.4);
        clampMapBounds();
        updateMapTransform();
    });

    document.getElementById('zoom-reset').addEventListener('click', () => {
        scale = 1;
        currentX = -1000;
        currentY = -500;
        clampMapBounds();
        updateMapTransform();
    });
}

function clampMapBounds() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const mapW = 3840 * scale;
    const mapH = 2160 * scale;

    // Allow panning so that the edge of the map can reach the center of the screen
    // This provides a much more comfortable viewing experience
    const paddingX = winW * 0.5;
    const paddingY = winH * 0.5;

    const minX = winW - mapW - paddingX;
    const maxX = paddingX;
    const minY = winH - mapH - paddingY;
    const maxY = paddingY;

    currentX = Math.max(minX, Math.min(maxX, currentX));
    currentY = Math.max(minY, Math.min(maxY, currentY));
}

function updateMapTransform() {
    const map = document.getElementById("map-container");
    map.style.transform = `translate(${currentX}px, ${currentY}px) scale(${scale})`;
}


// --- Sidebar Setup ---
function setupSidebar() {
    const sidebar = document.getElementById('side-panel');
    const toggleBtn = document.getElementById('toggle-sidebar');
    const closeBtn = document.getElementById('close-sidebar');

    toggleBtn.addEventListener('click', () => sidebar.classList.add('open'));
    closeBtn.addEventListener('click', () => sidebar.classList.remove('open'));

    // Setup Search
    const searchInput = document.getElementById('region-search');
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allRegionsData.filter(r =>
            r.name.toLowerCase().includes(term) ||
            (r.subtitle && r.subtitle.toLowerCase().includes(term))
        );
        displayRegions(filtered);
        renderSidebarList(filtered);
    });
}


// --- Data Loading ---
function initWorld(data) {
    document.getElementById("world-name").textContent = data.worldName;

    // Player HUD (now in sidebar)
    document.getElementById("player-name").textContent = data.player.name;
    document.getElementById("player-title").textContent = data.player.title;

    // Load saved progress (overrides world.json defaults)
    loadProgress(data);
    updateExpUI();

    // Stats
    const statsHtml = Object.entries(data.player.stats).map(([key, val]) => `
        <div class="stat-item">
            <span class="stat-label">${key.substring(0, 3)}</span>
            <span class="stat-val" style="color: ${getStatColor(key)}">${val}</span>
        </div>
    `).join('');
    document.getElementById("player-stats").innerHTML = statsHtml;
}

function getStatColor(stat) {
    const colors = { wisdom: '#3b82f6', creativity: '#f43f5e', charisma: '#f59e0b', endurance: '#10b981' };
    return colors[stat] || '#fff';
}

async function renderRegions(regionIds) {
    const map = document.getElementById("map-container");
    map.innerHTML = "";

    const fetchPromises = regionIds.map(id => fetch(`data/regions/${id}.json`).then(r => r.json()));

    try {
        allRegionsData = await Promise.all(fetchPromises);
        generateRandomPositions(allRegionsData);
        displayRegions(allRegionsData);
        setupFilters(allRegionsData);
        renderSidebarList(allRegionsData);
    } catch (err) {
        console.error("Failed to render regions", err);
    }
}

// Spread out positions so the newly generated buildings don't overlap
function generateRandomPositions(regions) {
    const themes = [...new Set(regions.map(r => r.theme))];
    const themeCenters = {};

    // Base theme centers on a much wider radius for 3840x2160 map
    themes.forEach((t, i) => {
        themeCenters[t] = {
            x: 1000 + (Math.sin(i) * 1400) + 900,
            y: 700 + (Math.cos(i) * 800) + 400
        };
    });

    // Count regions per theme to distribute them in an arc/circle
    const themeCounts = {};
    const totalParTheme = {};
    regions.forEach(r => totalParTheme[r.theme] = (totalParTheme[r.theme] || 0) + 1);

    regions.forEach((r) => {
        const center = themeCenters[r.theme];
        themeCounts[r.theme] = (themeCounts[r.theme] || 0) + 1;

        const indexInTheme = themeCounts[r.theme];
        const total = totalParTheme[r.theme];
        // distribute them in a circle around the theme center
        const angle = (indexInTheme / total) * Math.PI * 2;
        // The more items, the wider the circle must be to prevent overlap
        const radiusX = 350 + (indexInTheme * 35);
        const radiusY = 250 + (indexInTheme * 35);

        r.mapX = center.x + (Math.cos(angle) * radiusX);
        r.mapY = center.y + (Math.sin(angle) * radiusY);
    });
}

function displayRegions(regions) {
    const map = document.getElementById("map-container");
    document.querySelectorAll('.map-marker').forEach(el => el.remove());

    const fallbackTheme = {
        'creative-dream': 'social-hub' // map unsupported themes to a generated sprite
    };

    regions.forEach(r => {
        const marker = document.createElement('div');
        marker.className = `map-marker`;
        marker.style.left = `${r.mapX}px`;
        marker.style.top = `${r.mapY}px`;

        const color = r.colorScheme?.primary || '#3b82f6';
        marker.style.setProperty('--marker-color', color);
        const hex = color.replace('#', '');
        const rgb = hex.length === 6 ? `${parseInt(hex.substring(0, 2), 16)}, ${parseInt(hex.substring(2, 4), 16)}, ${parseInt(hex.substring(4, 6), 16)}` : '59,130,246';
        marker.style.setProperty('--marker-color-rgb', rgb);

        const spriteTheme = fallbackTheme[r.theme] || r.theme;

        // Render the newly drawn 2D building sprite
        marker.innerHTML = `
            <div class="building-asset">
                <img src="assets/buildings/${spriteTheme}.png" alt="building">
            </div>
            <div class="marker-label">${r.icon} ${r.name}</div>
        `;

        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            openQuestModal(r);
        });
        map.appendChild(marker);
    });
}

function renderSidebarList(regions) {
    const list = document.getElementById('region-list');
    list.innerHTML = "";

    regions.forEach(r => {
        const li = document.createElement('li');
        li.className = "list-item";
        li.innerHTML = `
            <div class="list-icon" style="color: ${r.colorScheme?.primary || '#fff'}">${r.icon}</div>
            <div class="list-details">
                <div class="list-name">${r.name}</div>
                <div class="list-sub">${r.totalNodes || 0} 個探索點</div>
            </div>
        `;

        // Clicking list item jumps to marker
        li.addEventListener('click', () => {
            scale = 1.5;
            // Center the clicked region
            const vw = window.innerWidth / 2;
            const vh = window.innerHeight / 2;
            currentX = vw - (r.mapX * scale);
            currentY = vh - (r.mapY * scale);
            updateMapTransform();

            // Auto open modal
            openQuestModal(r);

            // Auto close mobile sidebar
            if (window.innerWidth < 768) {
                document.getElementById('side-panel').classList.remove('open');
            }
        });

        list.appendChild(li);
    });
}

function setupFilters(regions) {
    const themes = [...new Set(regions.map(r => r.theme))];
    const filterContainer = document.querySelector('.filters');
    filterContainer.innerHTML = '<button class="filter-btn active" data-filter="all">全部</button>';

    themes.forEach(theme => {
        const btn = document.createElement('button');
        btn.className = "filter-btn";
        btn.dataset.filter = theme;
        btn.textContent = formatThemeName(theme);
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filtered = regions.filter(r => r.theme === theme);
            displayRegions(filtered);
            renderSidebarList(filtered);
        });
        filterContainer.appendChild(btn);
    });

    document.querySelector('[data-filter="all"]').addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-filter="all"]').classList.add('active');
        displayRegions(allRegionsData);
        renderSidebarList(allRegionsData);
    });
}

function formatThemeName(theme) {
    const map = {
        'cyberpunk-tech': '科技',
        'ancient-knowledge': '遺跡',
        'corporate-order': '財團',
        'creative-dream': '藝術',
        'mystical-nature': '自然',
        'social-hub': '營地',
        'classical-magic': '魔法'
    };
    return map[theme] || theme;
}

// --- Quest Modal ---
const modal = document.getElementById('region-modal');
const closeBtn = document.querySelector('.close-modal');

closeBtn.addEventListener('click', () => modal.classList.remove('active'));
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
});

async function openQuestModal(region) {
    const color = region.colorScheme?.primary || '#fff';
    document.documentElement.style.setProperty('--region-color', color);

    document.getElementById('modal-header').innerHTML = `
        <div class="modal-title">
            <h2>${region.name}</h2>
            <p>${region.subtitle}</p>
        </div>
    `;

    const subList = document.getElementById('modal-subfolders');
    if (region.subfolders && region.subfolders.length > 0) {
        subList.innerHTML = region.subfolders.map(sub => `
            <li>
                <span class="subfolder-name"><i class="fa-regular fa-folder" style="margin-right:8px; color:#64748b"></i> ${sub.name}</span>
                <span class="subfolder-count">${sub.fileCount || 0}</span>
            </li>
        `).join('');
    } else {
        subList.innerHTML = "<p style='color: #64748b; text-align:center;'>此區域目前尚未開拓。</p>";
    }

    const npcSection = document.getElementById('modal-npc');
    if (region.npcs && region.npcs.length > 0) {
        const npc = region.npcs[0];
        npcSection.style.display = 'flex';
        npcSection.innerHTML = `
            <div class="npc-avatar">🤖</div>
            <div class="npc-dialogue">
                <h4>${npc.name} (${npc.role})</h4>
                <p>"${npc.greeting}"</p>
            </div>
        `;
    } else {
        npcSection.style.display = 'none';
    }

    document.getElementById('enter-region-btn').onclick = () => {
        alert(`系統傳送中... 即將進入【${region.name}】副本`);
    };

    // Feature A: load & render knowledge nodes
    await renderKnowledgeSection(region);

    modal.classList.add('active');
}

// ============================================================
// Feature B: Progress System
// ============================================================

function loadProgress(worldData) {
    const saved = localStorage.getItem(PROGRESS_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            progress.exploredNodes = new Set(data.exploredNodes || []);
            progress.exp      = data.exp   || 0;
            progress.level    = data.level || 1;
            progress.expToNext = progress.level * 1000;
        } catch (e) {
            console.warn('Progress data corrupted, resetting.', e);
        }
    } else {
        progress.exp      = worldData.player.experience     || 0;
        progress.level    = worldData.player.level          || 1;
        progress.expToNext = worldData.player.experienceToNext || 1000;
    }
}

function saveProgress() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
        exploredNodes: [...progress.exploredNodes],
        exp:   progress.exp,
        level: progress.level
    }));
}

function gainExp(rarity) {
    const amount = EXP_TABLE[rarity] || 10;
    progress.exp += amount;

    let leveledUp = false;
    while (progress.exp >= progress.expToNext) {
        progress.exp -= progress.expToNext;
        progress.level++;
        progress.expToNext = progress.level * 1000;
        leveledUp = true;
    }

    updateExpUI();
    saveProgress();
    if (leveledUp) showLevelUpToast();
}

function updateExpUI() {
    document.getElementById('player-level').textContent = `Lv. ${progress.level}`;
    const pct = (progress.exp / progress.expToNext) * 100;
    document.getElementById('exp-fill').style.width = `${pct}%`;
    document.getElementById('exp-text').textContent = `${progress.exp} / ${progress.expToNext} EXP`;
}

function showLevelUpToast() {
    const toast = document.createElement('div');
    toast.className = 'levelup-toast';
    toast.textContent = `⬆ Level Up！Lv. ${progress.level}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
}

// ============================================================
// Feature A: Knowledge Node Browser
// ============================================================

async function renderKnowledgeSection(region) {
    const questBody = document.querySelector('.quest-body');

    // Remove stale section from previous modal open
    const existing = document.getElementById('modal-knowledge');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.className = 'knowledge-section';
    section.id = 'modal-knowledge';

    let nodes = [];
    try {
        const res = await fetch(`data/knowledge/${region.id}.json`);
        if (res.ok) nodes = await res.json();
    } catch (e) { /* region has no knowledge file */ }

    if (nodes.length === 0) {
        section.innerHTML = `
            <div class="knowledge-section-title"><span>【 探索節點 】</span></div>
            <p style="color:#64748b;text-align:center;font-size:0.8rem;padding:0.5rem 0;">此區域尚無知識節點。</p>
        `;
        questBody.appendChild(section);
        return;
    }

    const exploredCount = nodes.filter(n => progress.exploredNodes.has(n.id)).length;
    const progressPct   = Math.round((exploredCount / nodes.length) * 100);

    section.innerHTML = `
        <div class="knowledge-section-title">
            <span>【 探索節點 】</span>
            <span>${exploredCount} / ${nodes.length} 已探索</span>
        </div>
        <div class="region-progress-bar">
            <div class="region-progress-fill" style="width:${progressPct}%"></div>
        </div>
        <div class="region-progress-text">${progressPct}% 完成度</div>
        <div class="knowledge-nodes-list"></div>
    `;

    questBody.appendChild(section);

    const list = section.querySelector('.knowledge-nodes-list');
    nodes.forEach(node => list.appendChild(createNodeCard(node)));
}

function createNodeCard(node) {
    const color      = RARITY_COLORS[node.rarity] || '#475569';
    const label      = RARITY_LABELS[node.rarity] || node.rarity;
    const expVal     = EXP_TABLE[node.rarity] || 10;
    const icon       = TYPE_ICONS[node.type]   || 'fa-file';
    const isExplored = progress.exploredNodes.has(node.id);

    const card = document.createElement('div');
    card.className = `knowledge-node${isExplored ? ' explored' : ''}`;
    card.style.setProperty('--node-rarity-color', color);
    card.dataset.nodeId = node.id;

    const expBadgeHtml = isExplored
        ? `<span class="node-exp-badge" style="color:#10b981">✓</span>`
        : `<span class="node-exp-badge">+${expVal}</span>`;

    const actionBtnHtml = isExplored
        ? `<button class="node-explore-btn explored-btn" disabled>✓ 已探索</button>`
        : `<button class="node-explore-btn" data-rarity="${node.rarity}">⚡ 探索此節點</button>`;

    card.innerHTML = `
        <div class="knowledge-node-header">
            <i class="fa-solid ${icon} node-type-icon"></i>
            <span class="node-title">${node.title}</span>
            <span class="node-rarity-badge" style="background:${color}">${label}</span>
            ${expBadgeHtml}
        </div>
        <div class="node-summary">
            <p>${node.summary || '暫無摘要。'}</p>
            ${actionBtnHtml}
        </div>
    `;

    // Toggle summary on header click
    card.querySelector('.knowledge-node-header').addEventListener('click', () => {
        card.querySelector('.node-summary').classList.toggle('open');
    });

    // Explore button
    const exploreBtn = card.querySelector('.node-explore-btn:not(.explored-btn)');
    if (exploreBtn) {
        exploreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exploreNode(node.id, node.rarity, card);
        });
    }

    return card;
}

function exploreNode(nodeId, rarity, card) {
    if (progress.exploredNodes.has(nodeId)) return;

    progress.exploredNodes.add(nodeId);
    gainExp(rarity);

    // Update card appearance in-place
    card.classList.add('explored');
    const badge = card.querySelector('.node-exp-badge');
    if (badge) { badge.style.color = '#10b981'; badge.textContent = '✓'; }
    const btn = card.querySelector('.node-explore-btn');
    if (btn) { btn.className = 'node-explore-btn explored-btn'; btn.disabled = true; btn.textContent = '✓ 已探索'; }

    // Refresh region progress bar
    const section = document.getElementById('modal-knowledge');
    if (!section) return;
    const total    = section.querySelectorAll('.knowledge-node').length;
    const explored = section.querySelectorAll('.knowledge-node.explored').length;
    const pct      = total > 0 ? Math.round((explored / total) * 100) : 0;
    const fill  = section.querySelector('.region-progress-fill');
    const text  = section.querySelector('.region-progress-text');
    const label = section.querySelector('.knowledge-section-title span:last-child');
    if (fill)  fill.style.width       = `${pct}%`;
    if (text)  text.textContent       = `${pct}% 完成度`;
    if (label) label.textContent      = `${explored} / ${total} 已探索`;
}
