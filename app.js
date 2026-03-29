let allRegions = [];

// --- Progress System ---
const PROGRESS_KEY = 'neolife_progress';

function loadProgress() {
    try {
        const saved = localStorage.getItem(PROGRESS_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) { /* corrupted data, return default */ }
    return { exploredDistricts: [] };
}

function saveProgress(p) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

function getAllRegionCount() {
    return allRegions.length;
}

function updateHUD() {
    const p = loadProgress();
    const total = getAllRegionCount();
    document.querySelector('#hud-explored').textContent =
        `EXPLORED: ${p.exploredDistricts.length} / ${total}`;
}

function startClock() {
    setInterval(() => {
        document.querySelector('#hud-time').textContent =
            new Date().toLocaleTimeString('zh-TW', { hour12: false });
    }, 1000);
}

// --- Position Assignment ---
function assignMapPositions(regions) {
    const themes = [...new Set(regions.map(r => r.theme))];
    const themeCenters = {};
    themes.forEach((t, i) => {
        themeCenters[t] = {
            x: 1000 + (Math.sin(i) * 1400) + 900,
            y: 700 + (Math.cos(i) * 800) + 400
        };
    });

    const themeCounts = {};
    const totalPerTheme = {};
    regions.forEach(r => totalPerTheme[r.theme] = (totalPerTheme[r.theme] || 0) + 1);

    regions.forEach(r => {
        const center = themeCenters[r.theme];
        themeCounts[r.theme] = (themeCounts[r.theme] || 0) + 1;
        const indexInTheme = themeCounts[r.theme];
        const total = totalPerTheme[r.theme];
        const angle = (indexInTheme / total) * Math.PI * 2;
        const radiusX = 350 + (indexInTheme * 35);
        const radiusY = 250 + (indexInTheme * 35);
        r.mapX = center.x + (Math.cos(angle) * radiusX);
        r.mapY = center.y + (Math.sin(angle) * radiusY);
    });
}

// --- Load All Districts ---
async function loadAllDistricts() {
    try {
        const worldRes = await fetch('data/world.json');
        if (!worldRes.ok) throw new Error('Failed to load world.json');
        const world = await worldRes.json();

        const fetchedRegions = [];
        for (const id of world.regionIds) {
            try {
                const regionRes = await fetch(`data/regions/${id}.json`);
                if (!regionRes.ok) continue;
                const region = await regionRes.json();
                fetchedRegions.push(region);
            } catch (e) { /* skip failed region */ }
        }

        assignMapPositions(fetchedRegions);

        const progress = loadProgress();
        fetchedRegions.forEach(region => {
            allRegions.push(region);
            CityMap.addDistrict(region);
            if (progress.exploredDistricts.includes(region.id)) {
                CityMap.setDistrictExplored(region.id);
            }
        });
    } catch (e) { /* world.json failed, map stays empty */ }
}

// --- District Click Handler ---
async function onDistrictSelected(region) {
    const panel = document.getElementById('district-panel');
    panel.classList.add('visible');

    const nameEl = document.getElementById('district-name');
    if (nameEl) nameEl.textContent = region.name;

    const descEl = document.getElementById('district-desc');
    if (descEl) descEl.textContent = region.subtitle || '';

    const tagsEl = document.getElementById('district-tags');
    if (tagsEl) {
        const tags = region.tags || (region.theme ? [region.theme] : []);
        tagsEl.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');
    }

    const nodesEl = document.getElementById('knowledge-nodes');
    if (nodesEl) {
        nodesEl.innerHTML = '';
        try {
            const res = await fetch(`data/knowledge/${region.id}.json`);
            if (res.ok) {
                const nodes = await res.json();
                nodes.forEach(node => {
                    const el = document.createElement('div');
                    el.className = 'knowledge-node';
                    el.dataset.rarity = node.rarity || 'common';
                    el.innerHTML = `
                        <div class="node-header">
                            <span class="node-name">${node.title || ''}</span>
                            <span class="node-rarity">${node.rarity || 'common'}</span>
                        </div>
                        <div class="node-content" style="display:none">${node.summary || ''}</div>
                    `;
                    el.querySelector('.node-header').addEventListener('click', () => {
                        const content = el.querySelector('.node-content');
                        content.style.display = content.style.display === 'none' ? '' : 'none';
                    });
                    nodesEl.appendChild(el);
                });
            }
        } catch (e) { /* no knowledge file, skip */ }
    }

    const exploreBtn = document.getElementById('explore-btn');
    if (exploreBtn) {
        const p = loadProgress();
        if (p.exploredDistricts.includes(region.id)) {
            exploreBtn.textContent = '✓ 已探索';
            exploreBtn.disabled = true;
        } else {
            exploreBtn.textContent = '探索此地區';
            exploreBtn.disabled = false;
            exploreBtn.onclick = () => markExplored(region.id);
        }
    }
}

// --- Mark as Explored ---
function markExplored(regionId) {
    const p = loadProgress();
    if (!p.exploredDistricts.includes(regionId)) {
        p.exploredDistricts.push(regionId);
        saveProgress(p);
        CityMap.setDistrictExplored(regionId);
        updateHUD();
        const exploreBtn = document.getElementById('explore-btn');
        if (exploreBtn) {
            exploreBtn.textContent = '✓ 已探索';
            exploreBtn.disabled = true;
        }
    }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    CityMap.init();
    await loadAllDistricts();
    loadProgress();
    updateHUD();
    startClock();
    CityMap.onDistrictClick(onDistrictSelected);

    const closeBtn = document.querySelector('.panel-header .close-panel-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('district-panel').classList.remove('visible');
        });
    }
});
