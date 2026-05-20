// Editor screen: canvas, terrain painting, object placement, history
const SPRITE_SIZE = 18;
const CITY_SIZE = 26;
const CAPITAL_SIZE = 30;
const HIT_RADIUS = 12;
const EDITOR_DEFAULT_PLAINS_COLOR = '#A1C246';
const TERRAIN_COLORS = [
  { name: 'Plains', hex: '#A1C246' },
  { name: 'Forest', hex: '#388336' },
  { name: 'River', hex: '#279BFF' },
  { name: 'Mud', hex: '#784B23' },
  { name: 'Sand', hex: '#EEE3B0' },
  { name: 'Hill', hex: '#888A87' },
  { name: 'Mountain', hex: '#6D6B6F' },
];
const TERRAIN_PALETTE = TERRAIN_COLORS.map(color => color.hex);
const TOOLS = [
  { id: 'terrainBrush', label: 'Brush', kind: 'terrain', glyph: '✎' },
  { id: 'terrainLine', label: 'Line', kind: 'terrain', glyph: '／' },
  { id: 'terrainRect', label: 'Rect', kind: 'terrain', glyph: '▭' },
  { id: 'terrainFill', label: 'Fill', kind: 'terrain', icon: 'assets/fill_icon.svg' },
  { id: 'terrainPick', label: 'Pick', kind: 'terrain', glyph: '◎' },
  { id: 'infantry', label: 'Infantry', kind: 'team', sprite: color => `assets/${color}_inf1.png` },
  { id: 'tank', label: 'Tank', kind: 'team', sprite: color => `assets/${color}_tank1.png` },
  { id: 'city', label: 'City', kind: 'plain', icon: 'assets/city_icon.png' },
  { id: 'capital', label: 'Capital', kind: 'plain', icon: 'assets/capital.png' },
  { id: 'bridge', label: 'Bridge', kind: 'plain', glyph: '⎯' },
  { id: 'erase', label: 'Erase', kind: 'erase', glyph: '✕' },
];
const TOOL_BY_ID = Object.fromEntries(TOOLS.map(tool => [tool.id, tool]));

const sprites = {};
function loadSprite(src) {
  if (sprites[src]) return sprites[src];
  const image = new Image();
  image.src = src;
  sprites[src] = image;
  return image;
}
TEAM_COLORS.forEach(color => {
  loadSprite(`assets/${color}_inf1.png`);
  loadSprite(`assets/${color}_tank1.png`);
  loadSprite(`assets/${color}_flag.png`);
});
loadSprite('assets/city_icon.png');
loadSprite('assets/capital.png');
loadSprite('assets/fill_icon.svg');

async function showEditor(id) {
  const map = await Store.get(id);
  if (!map) {
    showMenu();
    return;
  }
  normalizeMapData(map.data);

  View.innerHTML = '';
  const view = el('tpl-editor');
  View.appendChild(view);

  const canvas = view.querySelector('#map');
  const ctx = canvas.getContext('2d');
  const nameEl = view.querySelector('#mapName');
  const modeEl = view.querySelector('#mapMode');
  const toolGrid = view.querySelector('#toolGrid');
  const teamPicker = view.querySelector('#teamPicker');
  const teamsEl = view.querySelector('#teams');
  const countsEl = view.querySelector('#counts');
  const terrainControls = view.querySelector('#terrainControls');
  const terrainSwatchesEl = view.querySelector('#terrainSwatches');
  const terrainSizeEl = view.querySelector('#terrainSize');
  const terrainSizeValueEl = view.querySelector('#terrainSizeValue');
  const undoBtn = view.querySelector('#undoBtn');
  const redoBtn = view.querySelector('#redoBtn');

  const state = {
    map,
    tool: 'terrainBrush',
    team: 0,
    terrainColor: EDITOR_DEFAULT_PLAINS_COLOR,
    terrainSize: Number(terrainSizeEl.value),
    bridgeStart: null,
    bridgeHover: null,
    bgCanvas: document.createElement('canvas'),
    bgCtx: null,
    painting: false,
    paintStart: null,
    paintLast: null,
    paintSnapshot: null,
    backgroundDirty: false,
    history: [],
    future: [],
    persistTimer: 0,
  };
  state.bgCanvas.width = 960;
  state.bgCanvas.height = 540;
  state.bgCtx = state.bgCanvas.getContext('2d', { willReadFrequently: true });

  nameEl.value = map.name;
  modeEl.value = map.data.mode;

  await loadBackground(map.data.map_surface);
  recordHistory(true, false);

  nameEl.addEventListener('input', () => {
    state.map.name = nameEl.value;
    schedulePersist();
  });
  nameEl.addEventListener('change', () => {
    state.map.name = nameEl.value;
    recordHistory();
  });
  modeEl.addEventListener('change', () => {
    const newMode = normalizeMode(modeEl.value);
    const teamCount = teamsForMode(newMode);
    state.map.data.mode = newMode;
    while (state.map.data.infantry.length < teamCount) state.map.data.infantry.push([]);
    while (state.map.data.tanks.length < teamCount) state.map.data.tanks.push([]);
    if (state.map.data.infantry.length > teamCount) state.map.data.infantry.length = teamCount;
    if (state.map.data.tanks.length > teamCount) state.map.data.tanks.length = teamCount;
    if (state.team >= teamCount) state.team = 0;
    renderTeams();
    renderCounts();
    draw();
    recordHistory();
  });

  view.querySelector('#bgFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const image = await fileToImage(file);
    state.bgCtx.fillStyle = EDITOR_DEFAULT_PLAINS_COLOR;
    state.bgCtx.fillRect(0, 0, 960, 540);
    state.bgCtx.drawImage(image, 0, 0, 960, 540);
    quantizeCanvasContext(state.bgCtx, 960, 540);
    draw();
    recordHistory();
    event.target.value = '';
  });

  TERRAIN_COLORS.forEach(({ name, hex }) => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.style.background = hex;
    button.title = `${name} ${hex}`;
    button.dataset.hex = hex;
    button.onclick = () => {
      state.terrainColor = hex;
      renderTerrainControls();
    };
    terrainSwatchesEl.appendChild(button);
  });
  terrainSizeEl.addEventListener('input', () => {
    state.terrainSize = Number(terrainSizeEl.value);
    renderTerrainControls();
  });

  TOOLS.forEach(tool => {
    const button = document.createElement('button');
    button.className = 'tool';
    button.dataset.tool = tool.id;
    let inner = '';
    if (tool.icon) inner = `<img src="${tool.icon}" alt="" />`;
    else if (tool.glyph) inner = `<span class="glyph">${tool.glyph}</span>`;
    else if (tool.kind === 'team') inner = `<img src="${tool.sprite(TEAM_COLORS[state.team])}" alt="" />`;
    button.innerHTML = `${inner}<span>${tool.label}</span>`;
    button.onclick = () => selectTool(tool.id);
    toolGrid.appendChild(button);
  });

  view.querySelector('#backBtn').onclick = async () => {
    clearTimeout(state.persistTimer);
    if (window.__wodEditorKeyHandler) {
      window.removeEventListener('keydown', window.__wodEditorKeyHandler);
      window.__wodEditorKeyHandler = null;
    }
    window.onbeforeunload = null;
    syncBackgroundToMap();
    await Store.put(state.map);
    showMenu();
  };
  view.querySelector('#downloadBtn').onclick = () => {
    syncBackgroundToMap();
    downloadMap(state.map.data, state.map.name);
  };
  undoBtn.onclick = () => undoHistory();
  redoBtn.onclick = () => redoHistory();

  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (isTerrainTool()) return;
    const point = canvasCoords(canvas, event);
    eraseAt(point.x, point.y);
  });
  canvas.addEventListener('click', event => {
    if (isTerrainTool()) return;
    const point = canvasCoords(canvas, event);
    applyTool(point.x, point.y);
  });
  canvas.addEventListener('pointerdown', event => {
    if (!isTerrainTool()) return;
    canvas.setPointerCapture(event.pointerId);
    handleTerrainPointerDown(canvasCoords(canvas, event));
  });
  canvas.addEventListener('pointermove', event => {
    const point = canvasCoords(canvas, event);
    if (isTerrainTool()) {
      handleTerrainPointerMove(point);
      return;
    }
    if (state.tool === 'bridge' && state.bridgeStart) {
      state.bridgeHover = point;
      draw();
    }
  });
  canvas.addEventListener('pointerup', event => {
    if (!isTerrainTool()) return;
    handleTerrainPointerUp(canvasCoords(canvas, event));
  });
  canvas.addEventListener('pointercancel', () => {
    if (!isTerrainTool()) return;
    cancelTerrainPreview();
  });
  canvas.addEventListener('mouseleave', () => {
    if (isTerrainTool()) return;
    if (state.bridgeStart) {
      state.bridgeHover = null;
      draw();
    }
  });

  const keyHandler = event => {
    const meta = event.ctrlKey || event.metaKey;
    if (!meta || isTextInput(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoHistory();
      return;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redoHistory();
    }
  };
  if (window.__wodEditorKeyHandler) {
    window.removeEventListener('keydown', window.__wodEditorKeyHandler);
  }
  window.__wodEditorKeyHandler = keyHandler;
  window.addEventListener('keydown', keyHandler);
  window.onbeforeunload = () => {
    syncBackgroundToMap();
    Store.put(state.map);
  };

  renderTeams();
  renderCounts();
  renderTerrainControls();
  selectTool('terrainBrush');

  Promise.all(
    Object.values(sprites).map(image => image.complete
      ? Promise.resolve()
      : new Promise(resolve => {
          image.onload = resolve;
          image.onerror = resolve;
        }))
  ).then(draw);
  draw();

  function isTerrainTool() {
    return TOOL_BY_ID[state.tool].kind === 'terrain';
  }

  function selectTool(toolId) {
    cancelTerrainPreview();
    state.tool = toolId;
    state.bridgeStart = null;
    state.bridgeHover = null;
    [...toolGrid.children].forEach(button => {
      button.classList.toggle('active', button.dataset.tool === toolId);
    });
    renderTeams();
    renderTerrainControls();
    refreshTeamToolIcons();
    draw();
  }

  function renderTeams() {
    const isTeamTool = TOOL_BY_ID[state.tool].kind === 'team';
    teamPicker.style.display = isTeamTool ? '' : 'none';
    if (!isTeamTool) return;
    teamsEl.innerHTML = '';
    const teamCount = teamsForMode(state.map.data.mode);
    for (let index = 0; index < teamCount; index += 1) {
      const color = TEAM_COLORS[index % TEAM_COLORS.length];
      const chip = document.createElement('button');
      chip.className = `team-chip${index === state.team ? ' active' : ''}`;
      chip.innerHTML = `<span class="dot" style="background:${cssColor(color)}"></span> Team ${index + 1}`;
      chip.onclick = () => {
        state.team = index;
        renderTeams();
        refreshTeamToolIcons();
      };
      teamsEl.appendChild(chip);
    }
  }

  function refreshTeamToolIcons() {
    TOOLS.forEach(tool => {
      if (tool.kind !== 'team') return;
      const image = toolGrid.querySelector(`[data-tool="${tool.id}"] img`);
      if (image) image.src = tool.sprite(TEAM_COLORS[state.team % TEAM_COLORS.length]);
    });
  }

  function renderTerrainControls() {
    terrainControls.style.display = isTerrainTool() ? '' : 'none';
    terrainSizeEl.value = String(state.terrainSize);
    terrainSizeValueEl.textContent = String(state.terrainSize);
    terrainSwatchesEl.querySelectorAll('.swatch').forEach(button => {
      button.classList.toggle('active', button.dataset.hex === state.terrainColor);
    });
  }

  function renderCounts() {
    const infantry = state.map.data.infantry.reduce((sum, team) => sum + team.length, 0);
    const tanks = state.map.data.tanks.reduce((sum, team) => sum + team.length, 0);
    countsEl.innerHTML =
      `<div><b>${infantry}</b> infantry total</div>
       <div><b>${tanks}</b> tanks total</div>
       <div><b>${state.map.data.cities.length}</b> cities (<b>${state.map.data.capitals.length}</b> capitals)</div>
       <div><b>${state.map.data.bridges.length}</b> bridges</div>`;
  }

  async function loadBackground(base64) {
    state.bgCtx.fillStyle = EDITOR_DEFAULT_PLAINS_COLOR;
    state.bgCtx.fillRect(0, 0, 960, 540);
    if (!base64) {
      draw();
      return;
    }
    const image = new Image();
    await new Promise(resolve => {
      image.onload = resolve;
      image.onerror = resolve;
      image.src = `data:image/png;base64,${base64}`;
    });
    state.bgCtx.clearRect(0, 0, 960, 540);
    state.bgCtx.fillStyle = EDITOR_DEFAULT_PLAINS_COLOR;
    state.bgCtx.fillRect(0, 0, 960, 540);
    if (image.naturalWidth) {
      state.bgCtx.drawImage(image, 0, 0, 960, 540);
      quantizeCanvasContext(state.bgCtx, 960, 540);
    }
    draw();
  }

  function syncBackgroundToMap() {
    quantizeCanvasContext(state.bgCtx, 960, 540);
    state.map.data.map_surface = state.bgCanvas.toDataURL('image/png').split(',')[1];
  }

  function snapshotState() {
    syncBackgroundToMap();
    return JSON.stringify({
      name: state.map.name,
      data: state.map.data,
    });
  }

  function recordHistory(force = false, persist = true) {
    const snapshot = snapshotState();
    if (force || state.history[state.history.length - 1] !== snapshot) {
      state.history.push(snapshot);
      state.future = [];
      updateHistoryButtons();
      if (persist) schedulePersist();
    }
  }

  function updateHistoryButtons() {
    undoBtn.disabled = state.history.length < 2;
    redoBtn.disabled = state.future.length === 0;
  }

  async function restoreSnapshot(snapshot) {
    const restored = JSON.parse(snapshot);
    state.map.name = restored.name;
    state.map.data = normalizeMapData(restored.data);
    nameEl.value = state.map.name;
    modeEl.value = state.map.data.mode;
    if (state.team >= teamsForMode(state.map.data.mode)) state.team = 0;
    await loadBackground(state.map.data.map_surface);
    renderTeams();
    renderCounts();
    renderTerrainControls();
    refreshTeamToolIcons();
    draw();
    schedulePersist();
    updateHistoryButtons();
  }

  function undoHistory() {
    if (state.history.length < 2) return;
    state.future.push(state.history.pop());
    restoreSnapshot(state.history[state.history.length - 1]);
  }

  function redoHistory() {
    if (!state.future.length) return;
    const snapshot = state.future.pop();
    state.history.push(snapshot);
    restoreSnapshot(snapshot);
  }

  function schedulePersist() {
    clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(() => {
      syncBackgroundToMap();
      Store.put(state.map);
    }, 180);
  }

  function handleTerrainPointerDown(point) {
    state.bridgeHover = null;
    state.backgroundDirty = false;
    if (state.tool === 'terrainFill') {
      if (floodFill(state.bgCtx, point.x, point.y, state.terrainColor)) {
        state.backgroundDirty = true;
        draw();
        recordHistory();
      }
      return;
    }
    if (state.tool === 'terrainPick') {
      const pixel = state.bgCtx.getImageData(point.x, point.y, 1, 1).data;
      state.terrainColor = nearestPaletteHex(rgbToHex(pixel[0], pixel[1], pixel[2]));
      renderTerrainControls();
      return;
    }
    state.painting = true;
    state.paintStart = point;
    state.paintLast = point;
    if (state.tool === 'terrainBrush') {
      drawDot(state.bgCtx, point, state.terrainSize, state.terrainColor);
      state.backgroundDirty = true;
      draw();
      return;
    }
    state.paintSnapshot = state.bgCtx.getImageData(0, 0, 960, 540);
  }

  function handleTerrainPointerMove(point) {
    if (!state.painting) return;
    if (state.tool === 'terrainBrush') {
      drawSegment(state.bgCtx, state.paintLast, point, state.terrainSize, state.terrainColor);
      state.paintLast = point;
      state.backgroundDirty = true;
      draw();
      return;
    }
    if (!state.paintSnapshot) return;
    state.bgCtx.putImageData(state.paintSnapshot, 0, 0);
    if (state.tool === 'terrainLine') {
      drawSegment(state.bgCtx, state.paintStart, point, state.terrainSize, state.terrainColor);
    } else if (state.tool === 'terrainRect') {
      drawRect(state.bgCtx, state.paintStart, point, state.terrainColor);
    }
    state.backgroundDirty = true;
    draw();
  }

  function handleTerrainPointerUp(point) {
    if (!state.painting) return;
    if (state.tool === 'terrainLine' || state.tool === 'terrainRect') {
      handleTerrainPointerMove(point);
    }
    state.painting = false;
    state.paintSnapshot = null;
    if (state.backgroundDirty) {
      recordHistory();
      state.backgroundDirty = false;
    }
  }

  function cancelTerrainPreview() {
    if (!state.painting) return;
    if (state.paintSnapshot) {
      state.bgCtx.putImageData(state.paintSnapshot, 0, 0);
    }
    state.painting = false;
    state.paintSnapshot = null;
    state.backgroundDirty = false;
    draw();
  }

  function applyTool(x, y) {
    let changed = false;
    if (state.tool === 'erase') {
      changed = eraseAt(x, y);
    } else if (state.tool === 'infantry') {
      state.map.data.infantry[state.team].push([x, y]);
      changed = true;
    } else if (state.tool === 'tank') {
      state.map.data.tanks[state.team].push([x, y]);
      changed = true;
    } else if (state.tool === 'city') {
      state.map.data.cities.push([x, y]);
      changed = true;
    } else if (state.tool === 'capital') {
      const index = nearestCityIndex(x, y);
      if (index >= 0) {
        const at = state.map.data.capitals.indexOf(index);
        if (at >= 0) state.map.data.capitals.splice(at, 1);
        else state.map.data.capitals.push(index);
      } else {
        state.map.data.cities.push([x, y]);
        state.map.data.capitals.push(state.map.data.cities.length - 1);
      }
      changed = true;
    } else if (state.tool === 'bridge') {
      if (!state.bridgeStart) {
        state.bridgeStart = [x, y];
        state.bridgeHover = null;
        draw();
        return;
      }
      state.map.data.bridges.push([[state.bridgeStart[0], state.bridgeStart[1]], [x, y]]);
      state.bridgeStart = null;
      state.bridgeHover = null;
      changed = true;
    }
    if (!changed) return;
    renderCounts();
    draw();
    recordHistory();
  }

  function nearestCityIndex(x, y) {
    let best = -1;
    let bestDistance = HIT_RADIUS * HIT_RADIUS;
    state.map.data.cities.forEach(([cityX, cityY], index) => {
      const distance = ((cityX - x) ** 2) + ((cityY - y) ** 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function eraseAt(x, y) {
    const hits = [];
    const radiusSquared = HIT_RADIUS * HIT_RADIUS;
    state.map.data.infantry.forEach((team, teamIndex) => team.forEach((point, index) => {
      const distance = ((point[0] - x) ** 2) + ((point[1] - y) ** 2);
      if (distance < radiusSquared) hits.push({ distance, kind: 'infantry', teamIndex, index });
    }));
    state.map.data.tanks.forEach((team, teamIndex) => team.forEach((point, index) => {
      const distance = ((point[0] - x) ** 2) + ((point[1] - y) ** 2);
      if (distance < radiusSquared) hits.push({ distance, kind: 'tank', teamIndex, index });
    }));
    state.map.data.cities.forEach((point, index) => {
      const distance = ((point[0] - x) ** 2) + ((point[1] - y) ** 2);
      if (distance < radiusSquared) hits.push({ distance, kind: 'city', index });
    });
    state.map.data.bridges.forEach((bridge, index) => {
      const [[x1, y1], [x2, y2]] = bridgeEndpoints(bridge);
      const distance = pointToSegmentDist(x, y, x1, y1, x2, y2);
      if ((distance * distance) < radiusSquared) hits.push({ distance: distance * distance, kind: 'bridge', index });
    });
    if (!hits.length) return false;
    hits.sort((left, right) => left.distance - right.distance);
    const hit = hits[0];
    if (hit.kind === 'infantry') state.map.data.infantry[hit.teamIndex].splice(hit.index, 1);
    if (hit.kind === 'tank') state.map.data.tanks[hit.teamIndex].splice(hit.index, 1);
    if (hit.kind === 'bridge') state.map.data.bridges.splice(hit.index, 1);
    if (hit.kind === 'city') {
      state.map.data.cities.splice(hit.index, 1);
      state.map.data.capitals = state.map.data.capitals
        .filter(index => index !== hit.index)
        .map(index => (index > hit.index ? index - 1 : index));
    }
    renderCounts();
    draw();
    recordHistory();
    return true;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.bgCanvas, 0, 0, canvas.width, canvas.height);
    drawBridges();
    drawCities();
    drawUnits();
  }

  function drawBridges() {
    ctx.strokeStyle = '#d1b06b';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    state.map.data.bridges.forEach(bridge => {
      const [[x1, y1], [x2, y2]] = bridgeEndpoints(bridge);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    if (state.bridgeStart && state.tool === 'bridge') {
      ctx.fillStyle = '#d1b06b';
      ctx.beginPath();
      ctx.arc(state.bridgeStart[0], state.bridgeStart[1], 4, 0, Math.PI * 2);
      ctx.fill();
      if (state.bridgeHover) {
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(state.bridgeStart[0], state.bridgeStart[1]);
        ctx.lineTo(state.bridgeHover.x, state.bridgeHover.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawCities() {
    const cityImage = sprites['assets/city_icon.png'];
    const capitalImage = sprites['assets/capital.png'];
    state.map.data.cities.forEach((point, index) => {
      const isCapital = state.map.data.capitals.includes(index);
      const image = isCapital ? capitalImage : cityImage;
      const size = isCapital ? CAPITAL_SIZE : CITY_SIZE;
      if (image.complete && image.naturalWidth) {
        ctx.drawImage(image, point[0] - size / 2, point[1] - size / 2, size, size);
      } else {
        ctx.fillStyle = isCapital ? '#f1c14b' : '#cfd6e0';
        ctx.beginPath();
        ctx.arc(point[0], point[1], size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawUnits() {
    state.map.data.infantry.forEach((team, teamIndex) => {
      const color = TEAM_COLORS[teamIndex % TEAM_COLORS.length];
      const image = sprites[`assets/${color}_inf1.png`];
      team.forEach(point => drawSprite(image, point[0], point[1], SPRITE_SIZE, color));
    });
    state.map.data.tanks.forEach((team, teamIndex) => {
      const color = TEAM_COLORS[teamIndex % TEAM_COLORS.length];
      const image = sprites[`assets/${color}_tank1.png`];
      team.forEach(point => drawSprite(image, point[0], point[1], SPRITE_SIZE + 4, color));
    });
  }

  function drawSprite(image, x, y, size, color) {
    if (image.complete && image.naturalWidth) {
      ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
      return;
    }
    ctx.fillStyle = cssColor(color);
    ctx.beginPath();
    ctx.arc(x, y, size / 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cssColor(name) {
  return { blue: '#4f8cff', orange: '#ff9b3d', red: '#e5484d', purple: '#a974ff' }[name] || '#999';
}
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = error => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}
function canvasCoords(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
  };
}
function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function bridgeEndpoints(bridge) {
  if (Array.isArray(bridge) && bridge.length === 2 && Array.isArray(bridge[0]) && Array.isArray(bridge[1])) return bridge;
  if (Array.isArray(bridge) && bridge.length === 4) return [[bridge[0], bridge[1]], [bridge[2], bridge[3]]];
  return [[0, 0], [0, 0]];
}
function drawDot(ctx, point, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
}
function drawSegment(ctx, start, end, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}
function drawRect(ctx, start, end, color) {
  ctx.fillStyle = color;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  ctx.fillRect(x, y, width, height);
}
function floodFill(ctx, sx, sy, hex) {
  const image = ctx.getImageData(0, 0, 960, 540);
  const data = image.data;
  const index = (sy * 960 + sx) * 4;
  const target = [data[index], data[index + 1], data[index + 2], data[index + 3]];
  const fill = hexToRgb(nearestPaletteHex(hex));
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === 255) return false;
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= 960 || y >= 540) continue;
    const offset = (y * 960 + x) * 4;
    if (
      data[offset] !== target[0] ||
      data[offset + 1] !== target[1] ||
      data[offset + 2] !== target[2] ||
      data[offset + 3] !== target[3]
    ) continue;
    data[offset] = fill[0];
    data[offset + 1] = fill[1];
    data[offset + 2] = fill[2];
    data[offset + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(image, 0, 0);
  return true;
}
function quantizeCanvasContext(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const snapped = hexToRgb(nearestPaletteHex(rgbToHex(data[index], data[index + 1], data[index + 2])));
    data[index] = snapped[0];
    data[index + 1] = snapped[1];
    data[index + 2] = snapped[2];
    data[index + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
function nearestPaletteHex(hex) {
  const [red, green, blue] = hexToRgb(hex);
  let best = TERRAIN_PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const terrain of TERRAIN_PALETTE) {
    const [terrainRed, terrainGreen, terrainBlue] = hexToRgb(terrain);
    const distance = ((red - terrainRed) ** 2) + ((green - terrainGreen) ** 2) + ((blue - terrainBlue) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = terrain;
    }
  }
  return best;
}
function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}
function rgbToHex(red, green, blue) {
  return '#' + [red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('');
}
function isTextInput(element) {
  if (!element) return false;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable;
}

window.showEditor = showEditor;
