// App shell: routing, menu screen, import/export
const TEAM_COLORS = ['blue', 'orange', 'red', 'purple'];
const DEFAULT_PLAINS_COLOR = '#A1C246';
const MODE_TEAMS = { '1v1': 2, 'v3': 3, 'v4': 4 };
function normalizeMode(mode) {
  return ({
    '1v1': '1v1',
    '1v1 duel': '1v1',
    'duel': '1v1',
    '3pffa': 'v3',
    '3p ffa': 'v3',
    'v3': 'v3',
    '4pffa': 'v4',
    '4p ffa': 'v4',
    'ffa': 'v4',
    'v4': 'v4',
  })[String(mode || '1v1').toLowerCase()] || '1v1';
}
function teamsForMode(mode) { return MODE_TEAMS[normalizeMode(mode)] || 2; }
function modeLabel(mode) {
  return ({ '1v1': '1v1 Duel', 'v3': '3P FFA', 'v4': '4P FFA' })[normalizeMode(mode)] || String(mode || '').toUpperCase();
}

function normalizeBridge(bridge) {
  if (!bridge) return null;
  if (Array.isArray(bridge) && bridge.length === 4) {
    return [[bridge[0], bridge[1]], [bridge[2], bridge[3]]];
  }
  if (Array.isArray(bridge) && bridge.length === 2 && Array.isArray(bridge[0]) && Array.isArray(bridge[1])) {
    return [[Number(bridge[0][0]), Number(bridge[0][1])], [Number(bridge[1][0]), Number(bridge[1][1])]];
  }
  if (bridge && typeof bridge === 'object' && 'value' in bridge) {
    return normalizeBridge(bridge.value);
  }
  return null;
}

function normalizeMapData(data) {
  if (!data || typeof data !== 'object') return emptyMapData('1v1');
  data.mode = normalizeMode(data.mode);
  const n = teamsForMode(data.mode);
  const normalizeTeams = (teams) => Array.from({ length: n }, (_, index) =>
    Array.isArray(teams && teams[index])
      ? teams[index].map(point => [Number(point[0]), Number(point[1])])
      : []
  );
  data.map_surface = data.map_surface || '';
  data.infantry = normalizeTeams(data.infantry);
  data.tanks = normalizeTeams(data.tanks);
  data.cities = Array.isArray(data.cities)
    ? data.cities.map(point => [Number(point[0]), Number(point[1])])
    : [];
  data.capitals = Array.isArray(data.capitals)
    ? data.capitals.map(value => Number(value)).filter(Number.isInteger)
    : [];
  data.bridges = Array.isArray(data.bridges)
    ? data.bridges.map(normalizeBridge).filter(Boolean)
    : [];
  return data;
}

const View = document.getElementById('view');

function el(tplId) {
  const tpl = document.getElementById(tplId);
  return tpl.content.firstElementChild.cloneNode(true);
}

function createSolidMapSurface(hex = DEFAULT_PLAINS_COLOR) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}

function genId() {
  return 'map_' + Date.now().toString() + Math.floor(Math.random() * 1000);
}

function emptyMapData(mode = '1v1') {
  mode = normalizeMode(mode);
  const n = teamsForMode(mode);
  return {
    map_surface: createSolidMapSurface(DEFAULT_PLAINS_COLOR),
    mode,
    infantry: Array.from({ length: n }, () => []),
    tanks:    Array.from({ length: n }, () => []),
    cities:   [],
    capitals: [],
    bridges:  [],
  };
}

// ---------- Gzip helpers (compatible with the game's .txt format) ----------
function gzipMap(map) {
  normalizeMapData(map);
  const json = JSON.stringify(map);
  // pako returns Uint8Array of gzip stream
  return pako.gzip(json);
}
async function ungzipFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // The game prepends gzip magic 0x1f 0x8b; pako handles raw gzip.
  const text = pako.ungzip(buf, { to: 'string' });
  return JSON.parse(text);
}
function downloadMap(map, name) {
  const data = gzipMap(map);
  const blob = new Blob([data], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (name || 'map') + '.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Modal ----------
function modal(title, contentEl, { okText = 'Save', cancelText = 'Cancel' } = {}) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h3></h3><div class="body"></div>
      <div class="row">
        <button class="btn ghost" data-act="cancel">${cancelText}</button>
        <button class="btn primary" data-act="ok">${okText}</button>
      </div>`;
    m.querySelector('h3').textContent = title;
    m.querySelector('.body').appendChild(contentEl);
    bg.appendChild(m);
    document.body.appendChild(bg);

    function close(val) { bg.remove(); resolve(val); }
    bg.addEventListener('click', e => { if (e.target === bg) close(null); });
    m.querySelector('[data-act=cancel]').onclick = () => close(null);
    m.querySelector('[data-act=ok]').onclick = () => close(true);
    setTimeout(() => {
      const f = m.querySelector('input,textarea,select');
      if (f) f.focus();
    }, 0);
  });
}

async function promptText(title, label, defaultValue = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="field"><label></label><input type="text" /></div>`;
  wrap.querySelector('label').textContent = label;
  const input = wrap.querySelector('input');
  input.value = defaultValue;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.querySelector('.modal [data-act=ok]').click();
  });
  const ok = await modal(title, wrap, { okText: 'OK' });
  return ok ? input.value.trim() : null;
}

async function confirmAction(title, message) {
  const wrap = document.createElement('div');
  wrap.textContent = message;
  wrap.style.color = 'var(--muted)';
  wrap.style.fontSize = '14px';
  return !!(await modal(title, wrap, { okText: 'Confirm' }));
}

// ---------- Thumbnail generation ----------
function thumbnailFor(map) {
  // Just use the background; fallback to placeholder.
  if (map.data && map.data.map_surface) {
    return 'data:image/png;base64,' + map.data.map_surface;
  }
  return 'assets/logo.png';
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- Routing ----------
async function showMenu() {
  View.innerHTML = '';
  const view = el('tpl-menu');
  View.appendChild(view);

  const grid = view.querySelector('#mapsGrid');
  const empty = view.querySelector('#emptyState');
  const count = view.querySelector('#mapCount');

  const maps = await Store.list();
  count.textContent = maps.length;
  if (!maps.length) empty.classList.remove('hidden');

  for (const map of maps) {
    normalizeMapData(map.data);
    const card = el('tpl-card');
    card.querySelector('.thumb img').src = thumbnailFor(map);
    card.querySelector('.name').textContent = map.name;
    const n = teamsForMode(map.data.mode);
    const inf = map.data.infantry.reduce((a, t) => a + t.length, 0);
    const tnk = map.data.tanks.reduce((a, t) => a + t.length, 0);
    card.querySelector('.meta').textContent =
      `${modeLabel(map.data.mode)} • ${map.data.cities.length} cities • ${inf} inf • ${tnk} tanks • ${fmtDate(map.updatedAt)}`;

    card.querySelector('[data-act=edit]').onclick = () => showEditor(map.id);
    card.querySelector('[data-act=download]').onclick = () => downloadMap(map.data, map.name);
    card.querySelector('[data-act=rename]').onclick = async () => {
      const name = await promptText('Rename map', 'New name', map.name);
      if (name) { map.name = name; await Store.put(map); showMenu(); }
    };
    card.querySelector('[data-act=delete]').onclick = async () => {
      if (await confirmAction('Delete map', `Delete "${map.name}"? This can't be undone.`)) {
        await Store.remove(map.id);
        showMenu();
      }
    };
    grid.appendChild(card);
  }

  view.querySelector('#newMapBtn').onclick = async () => {
    const name = await promptText('New map', 'Map name', 'Untitled map');
    if (!name) return;
    const map = {
      id: genId(),
      name,
      data: emptyMapData('1v1'),
    };
    await Store.put(map);
    showEditor(map.id);
  };

  view.querySelector('#importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = normalizeMapData(await ungzipFile(file));
      const base = file.name.replace(/\.(txt|gz)$/i, '');
      const map = { id: genId(), name: base || 'Imported map', data };
      await Store.put(map);
      showMenu();
    } catch (err) {
      alert('Could not read that file: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };
}

// initial route
window.addEventListener('DOMContentLoaded', showMenu);
