import { useEffect, useMemo, useRef, useState } from 'react';
import { getCachedImage, preloadImages, spriteAssets, uiAssets } from '../lib/assets';
import {
  AUTOSAVE_DELAY_MS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CAPITAL_SIZE,
  CITY_SIZE,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_TERRAIN_HEX,
  HISTORY_LIMIT,
  HIT_RADIUS,
  MODE_LABELS,
  SPRITE_SIZE,
  TEAM_ACCENTS,
  TEAM_COLORS,
  TERRAIN_COLORS,
  TOOLS,
  TOOL_LOOKUP,
} from '../lib/constants';
import {
  base64PngFromCanvas,
  cloneMapRecord,
  downloadMapFile,
  modeLabel,
  normalizeMapData,
  parseSnapshot,
  serializeSnapshot,
  snapshotForHistory,
  teamsForMode,
} from '../lib/mapCodec';
import {
  bridgeEndpoints,
  canvasPointFromEvent,
  drawDot,
  drawRect,
  drawSegment,
  floodFillContext,
  loadImageFromBase64,
  loadImageFromFile,
  nearestTerrainHex,
  pointToSegmentDistance,
  quantizeCanvasContext,
  rgbToHex,
} from '../lib/editorUtils';
import type { Point, StoredMap, ToolId } from '../lib/types';

interface EditorScreenProps {
  initialMap: StoredMap;
  saveMap: (map: StoredMap) => Promise<StoredMap>;
  onClose: (map: StoredMap) => void;
}

type PanelKey = 'terrain' | 'units' | 'map';

function panelForTool(toolId: ToolId): PanelKey {
  const group = TOOL_LOOKUP[toolId].group;
  if (group === 'terrain') {
    return 'terrain';
  }
  if (group === 'units') {
    return 'units';
  }
  return 'map';
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function sortCapitalIndices(capitals: number[]) {
  return [...new Set(capitals)].sort((left, right) => left - right);
}

function fitImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function teamAccent(index: number) {
  return TEAM_ACCENTS[TEAM_COLORS[index % TEAM_COLORS.length]];
}

function createDraftCounts(map: StoredMap) {
  return {
    infantry: map.data.infantry.reduce((count, team) => count + team.length, 0),
    tanks: map.data.tanks.reduce((count, team) => count + team.length, 0),
    cities: map.data.cities.length,
    capitals: map.data.capitals.length,
    bridges: map.data.bridges.length,
  };
}

export function EditorScreen({ initialMap, saveMap, onClose }: EditorScreenProps) {
  const [draft, setDraft] = useState(() => cloneMapRecord(initialMap));
  const [selectedTool, setSelectedTool] = useState<ToolId>('terrainBrush');
  const [selectedTeam, setSelectedTeam] = useState(0);
  const [terrainColor, setTerrainColor] = useState(DEFAULT_TERRAIN_HEX);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [activePanel, setActivePanel] = useState<PanelKey>('terrain');
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [ready, setReady] = useState(false);

  const draftRef = useRef(draft);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const hoverPointRef = useRef<{ x: number; y: number } | null>(null);
  const bridgeStartRef = useRef<Point | null>(null);
  const autosaveRequestedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const paintSessionRef = useRef<{
    active: boolean;
    start: { x: number; y: number } | null;
    last: { x: number; y: number } | null;
    snapshot: ImageData | null;
    dirty: boolean;
  }>({
    active: false,
    start: null,
    last: null,
    snapshot: null,
    dirty: false,
  });

  draftRef.current = draft;

  const counts = useMemo(() => createDraftCounts(draft), [draft]);
  const teamCount = teamsForMode(draft.data.mode);

  useEffect(() => {
    document.title = 'WoD Map Editor';
  }, []);

  useEffect(() => {
    if (selectedTeam < teamCount) {
      return;
    }

    setSelectedTeam(0);
  }, [selectedTeam, teamCount]);

  useEffect(() => {
    mountedRef.current = true;
    const backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.width = CANVAS_WIDTH;
    backgroundCanvas.height = CANVAS_HEIGHT;

    backgroundCanvasRef.current = backgroundCanvas;
    backgroundContextRef.current = backgroundCanvas.getContext('2d', { willReadFrequently: true });

    historyRef.current = [serializeSnapshot(snapshotForHistory(draftRef.current))];
    futureRef.current = [];
    setHistoryState({ canUndo: false, canRedo: false });

    const preloadList = [uiAssets.city, uiAssets.capital];
    for (const color of TEAM_COLORS) {
      preloadList.push(spriteAssets[color].infantry, spriteAssets[color].tank);
    }
    void preloadImages(preloadList).then(() => requestDraw());

    void loadBackgroundIntoCanvas(draftRef.current.data.map_surface).then(() => {
      if (!mountedRef.current) {
        return;
      }

      setReady(true);
      requestDraw();
    });

    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    requestDraw();
  }, [brushSize, draft, ready, selectedTeam, selectedTool, terrainColor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !isTextInputTarget(event.target)) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          void handleUndo();
          return;
        }
        if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault();
          void handleRedo();
          return;
        }
      }

      if (event.key === 'Escape') {
        paintSessionRef.current.active = false;
        paintSessionRef.current.snapshot = null;
        bridgeStartRef.current = null;
        hoverPointRef.current = null;
        requestDraw();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTool]);

  async function loadBackgroundIntoCanvas(base64: string) {
    const context = backgroundContextRef.current;
    if (!context) {
      return;
    }

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = DEFAULT_TERRAIN_HEX;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (!base64) {
      return;
    }

    const image = await loadImageFromBase64(base64);
    if (image.naturalWidth > 0) {
      context.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }

  function requestDraw() {
    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      drawScene();
    });
  }

  function drawScene() {
    const canvas = canvasRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    if (!canvas || !backgroundCanvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.drawImage(backgroundCanvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    context.strokeStyle = '#d2ae69';
    context.lineWidth = 4;
    context.lineCap = 'round';
    for (const bridge of draftRef.current.data.bridges) {
      const [[x1, y1], [x2, y2]] = bridgeEndpoints(bridge);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }

    if (selectedTool === 'bridge' && bridgeStartRef.current) {
      context.fillStyle = '#e9c786';
      context.beginPath();
      context.arc(bridgeStartRef.current[0], bridgeStartRef.current[1], 4, 0, Math.PI * 2);
      context.fill();

      if (hoverPointRef.current) {
        context.save();
        context.setLineDash([8, 6]);
        context.beginPath();
        context.moveTo(bridgeStartRef.current[0], bridgeStartRef.current[1]);
        context.lineTo(hoverPointRef.current.x, hoverPointRef.current.y);
        context.stroke();
        context.restore();
      }
    }

    const cityImage = getCachedImage(uiAssets.city);
    const capitalImage = getCachedImage(uiAssets.capital);
    draftRef.current.data.cities.forEach((point, index) => {
      const isCapital = draftRef.current.data.capitals.includes(index);
      const image = isCapital ? capitalImage : cityImage;
      const size = isCapital ? CAPITAL_SIZE : CITY_SIZE;

      if (image.complete && image.naturalWidth > 0) {
        context.drawImage(image, point[0] - size / 2, point[1] - size / 2, size, size);
      } else {
        context.fillStyle = isCapital ? '#f7ca5d' : '#e9eef6';
        context.beginPath();
        context.arc(point[0], point[1], size / 2.2, 0, Math.PI * 2);
        context.fill();
      }
    });

    draftRef.current.data.infantry.forEach((team, teamIndex) => {
      const image = getCachedImage(spriteAssets[TEAM_COLORS[teamIndex]].infantry);
      for (const [x, y] of team) {
        drawSprite(context, image, x, y, SPRITE_SIZE, teamAccent(teamIndex));
      }
    });

    draftRef.current.data.tanks.forEach((team, teamIndex) => {
      const image = getCachedImage(spriteAssets[TEAM_COLORS[teamIndex]].tank);
      for (const [x, y] of team) {
        drawSprite(context, image, x, y, SPRITE_SIZE + 4, teamAccent(teamIndex));
      }
    });

    if (TOOL_LOOKUP[selectedTool].kind === 'terrain' && hoverPointRef.current) {
      context.save();
      context.strokeStyle = terrainColor;
      context.lineWidth = 2;
      context.fillStyle = `${terrainColor}40`;
      context.beginPath();
      context.arc(hoverPointRef.current.x, hoverPointRef.current.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    }

    context.save();
    context.fillStyle = 'rgba(7, 11, 17, 0.75)';
    context.fillRect(12, 12, 220, 54);
    context.fillStyle = '#f4f7fb';
    context.font = '600 14px "Space Grotesk", sans-serif';
    context.fillText(TOOL_LOOKUP[selectedTool].label, 24, 34);
    context.fillStyle = 'rgba(244, 247, 251, 0.75)';
    context.font = '500 12px "IBM Plex Sans", sans-serif';
    const detail = TOOL_LOOKUP[selectedTool].kind === 'terrain'
      ? `Brush ${brushSize}px • Wheel to resize`
      : selectedTool === 'bridge'
        ? 'Click two points to place a bridge'
        : `${modeLabel(draftRef.current.data.mode)} • ${draftRef.current.name}`;
    context.fillText(detail, 24, 54);
    context.restore();
  }

  function drawSprite(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    size: number,
    fallbackColor: string,
  ) {
    if (image.complete && image.naturalWidth > 0) {
      context.drawImage(image, x - size / 2, y - size / 2, size, size);
      return;
    }

    context.fillStyle = fallbackColor;
    context.beginPath();
    context.arc(x, y, size / 3, 0, Math.PI * 2);
    context.fill();
  }

  function queueAutosave() {
    autosaveRequestedRef.current = true;
    setSaveState('dirty');

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void persistNow();
    }, AUTOSAVE_DELAY_MS);
  }

  async function persistNow() {
    if (!autosaveRequestedRef.current && saveState !== 'dirty') {
      return getSynchronizedMap();
    }

    if (!mountedRef.current) {
      return getSynchronizedMap();
    }

    setSaveState('saving');
    const saved = await saveMap(getSynchronizedMap());
    autosaveRequestedRef.current = false;

    if (!mountedRef.current) {
      return saved;
    }

    draftRef.current = saved;
    setDraft(saved);
    setSaveState('saved');
    return saved;
  }

  function getSynchronizedMap(source = draftRef.current) {
    const next = cloneMapRecord(source);
    const backgroundCanvas = backgroundCanvasRef.current;
    if (backgroundCanvas) {
      next.data.map_surface = base64PngFromCanvas(backgroundCanvas);
    }
    return next;
  }

  function updateHistoryState() {
    setHistoryState({
      canUndo: historyRef.current.length > 1,
      canRedo: futureRef.current.length > 0,
    });
  }

  function pushHistory(force = false, source = draftRef.current) {
    const snapshot = serializeSnapshot(snapshotForHistory(getSynchronizedMap(source)));
    const current = historyRef.current[historyRef.current.length - 1];

    if (force || current !== snapshot) {
      historyRef.current.push(snapshot);
      if (historyRef.current.length > HISTORY_LIMIT) {
        historyRef.current.shift();
      }
      futureRef.current = [];
      updateHistoryState();
    }

    queueAutosave();
  }

  async function restoreHistorySnapshot(serializedSnapshot: string) {
    const snapshot = parseSnapshot(serializedSnapshot);
    const restored = cloneMapRecord({
      ...draftRef.current,
      name: snapshot.name,
      data: normalizeMapData(snapshot.data),
    });

    draftRef.current = restored;
    setDraft(restored);
    await loadBackgroundIntoCanvas(restored.data.map_surface);
    requestDraw();
    queueAutosave();
  }

  async function handleUndo() {
    if (historyRef.current.length < 2) {
      return;
    }

    const current = historyRef.current.pop();
    if (current) {
      futureRef.current.push(current);
    }
    updateHistoryState();

    const previous = historyRef.current[historyRef.current.length - 1];
    if (previous) {
      await restoreHistorySnapshot(previous);
      updateHistoryState();
    }
  }

  async function handleRedo() {
    const snapshot = futureRef.current.pop();
    if (!snapshot) {
      return;
    }

    historyRef.current.push(snapshot);
    updateHistoryState();
    await restoreHistorySnapshot(snapshot);
    updateHistoryState();
  }

  function activateTool(toolId: ToolId) {
    setSelectedTool(toolId);
    setActivePanel(panelForTool(toolId));
    bridgeStartRef.current = null;
    hoverPointRef.current = null;
    paintSessionRef.current.snapshot = null;
    paintSessionRef.current.active = false;
    requestDraw();
  }

  function updateDraft(next: StoredMap, options?: { pushHistory?: boolean; autosave?: boolean }) {
    draftRef.current = next;
    setDraft(next);
    requestDraw();

    if (options?.pushHistory) {
      pushHistory(false, next);
      return;
    }

    if (options?.autosave !== false) {
      queueAutosave();
    }
  }

  function updateMapMode(nextMode: StoredMap['data']['mode']) {
    const next = cloneMapRecord(draftRef.current);
    next.data.mode = nextMode;
    const nextTeamCount = teamsForMode(nextMode);
    next.data.infantry = Array.from({ length: nextTeamCount }, (_, index) => next.data.infantry[index] ?? []);
    next.data.tanks = Array.from({ length: nextTeamCount }, (_, index) => next.data.tanks[index] ?? []);
    updateDraft(next, { pushHistory: true });
  }

  function nearestCityIndex(x: number, y: number) {
    let best = -1;
    let bestDistance = HIT_RADIUS * HIT_RADIUS;

    draftRef.current.data.cities.forEach(([cityX, cityY], index) => {
      const distance = (cityX - x) * (cityX - x) + (cityY - y) * (cityY - y);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });

    return best;
  }

  function eraseAt(x: number, y: number) {
    const next = cloneMapRecord(draftRef.current);
    const hits: Array<{ kind: 'infantry' | 'tank' | 'city' | 'bridge'; teamIndex?: number; index: number; distance: number }> = [];
    const hitRadiusSquared = HIT_RADIUS * HIT_RADIUS;

    next.data.infantry.forEach((team, teamIndex) => {
      team.forEach((point, index) => {
        const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
        if (distance <= hitRadiusSquared) {
          hits.push({ kind: 'infantry', teamIndex, index, distance });
        }
      });
    });

    next.data.tanks.forEach((team, teamIndex) => {
      team.forEach((point, index) => {
        const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
        if (distance <= hitRadiusSquared) {
          hits.push({ kind: 'tank', teamIndex, index, distance });
        }
      });
    });

    next.data.cities.forEach((point, index) => {
      const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
      if (distance <= hitRadiusSquared) {
        hits.push({ kind: 'city', index, distance });
      }
    });

    next.data.bridges.forEach((bridge, index) => {
      const [[x1, y1], [x2, y2]] = bridge;
      const distance = pointToSegmentDistance(x, y, x1, y1, x2, y2);
      if (distance * distance <= hitRadiusSquared) {
        hits.push({ kind: 'bridge', index, distance });
      }
    });

    if (hits.length === 0) {
      return;
    }

    hits.sort((left, right) => left.distance - right.distance);
    const closest = hits[0];

    if (closest.kind === 'infantry' && closest.teamIndex !== undefined) {
      next.data.infantry[closest.teamIndex].splice(closest.index, 1);
    }

    if (closest.kind === 'tank' && closest.teamIndex !== undefined) {
      next.data.tanks[closest.teamIndex].splice(closest.index, 1);
    }

    if (closest.kind === 'bridge') {
      next.data.bridges.splice(closest.index, 1);
    }

    if (closest.kind === 'city') {
      next.data.cities.splice(closest.index, 1);
      next.data.capitals = next.data.capitals
        .filter((index) => index !== closest.index)
        .map((index) => (index > closest.index ? index - 1 : index));
    }

    updateDraft(next, { pushHistory: true });
  }

  function applyPlacementTool(x: number, y: number) {
    const next = cloneMapRecord(draftRef.current);

    if (selectedTool === 'erase') {
      eraseAt(x, y);
      return;
    }

    if (selectedTool === 'infantry') {
      next.data.infantry[selectedTeam].push([x, y]);
      updateDraft(next, { pushHistory: true });
      return;
    }

    if (selectedTool === 'tank') {
      next.data.tanks[selectedTeam].push([x, y]);
      updateDraft(next, { pushHistory: true });
      return;
    }

    if (selectedTool === 'city') {
      next.data.cities.push([x, y]);
      updateDraft(next, { pushHistory: true });
      return;
    }

    if (selectedTool === 'capital') {
      const cityIndex = nearestCityIndex(x, y);
      if (cityIndex >= 0) {
        if (next.data.capitals.includes(cityIndex)) {
          next.data.capitals = next.data.capitals.filter((index) => index !== cityIndex);
        } else {
          next.data.capitals = sortCapitalIndices([...next.data.capitals, cityIndex]);
        }
      } else {
        next.data.cities.push([x, y]);
        next.data.capitals = sortCapitalIndices([...next.data.capitals, next.data.cities.length - 1]);
      }
      updateDraft(next, { pushHistory: true });
      return;
    }

    if (selectedTool === 'bridge') {
      if (!bridgeStartRef.current) {
        bridgeStartRef.current = [x, y];
        requestDraw();
        return;
      }

      next.data.bridges.push([[bridgeStartRef.current[0], bridgeStartRef.current[1]], [x, y]]);
      bridgeStartRef.current = null;
      updateDraft(next, { pushHistory: true });
    }
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const point = canvasPointFromEvent(canvas, event);
    hoverPointRef.current = point;

    if (TOOL_LOOKUP[selectedTool].kind !== 'terrain') {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    const context = backgroundContextRef.current;
    if (!context) {
      return;
    }

    bridgeStartRef.current = null;

    if (selectedTool === 'terrainFill') {
      if (floodFillContext(context, point.x, point.y, terrainColor)) {
        requestDraw();
        pushHistory();
      }
      return;
    }

    if (selectedTool === 'terrainPick') {
      const pixel = context.getImageData(point.x, point.y, 1, 1).data;
      setTerrainColor(nearestTerrainHex(rgbToHex(pixel[0], pixel[1], pixel[2])));
      requestDraw();
      return;
    }

    paintSessionRef.current.active = true;
    paintSessionRef.current.start = point;
    paintSessionRef.current.last = point;
    paintSessionRef.current.dirty = false;

    if (selectedTool === 'terrainBrush') {
      drawDot(context, point, brushSize, terrainColor);
      paintSessionRef.current.dirty = true;
      requestDraw();
      return;
    }

    paintSessionRef.current.snapshot = context.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const point = canvasPointFromEvent(canvas, event);
    hoverPointRef.current = point;
    const context = backgroundContextRef.current;
    if (!context) {
      requestDraw();
      return;
    }

    if (TOOL_LOOKUP[selectedTool].kind !== 'terrain') {
      requestDraw();
      return;
    }

    if (!paintSessionRef.current.active) {
      requestDraw();
      return;
    }

    if (selectedTool === 'terrainBrush' && paintSessionRef.current.last) {
      drawSegment(context, paintSessionRef.current.last, point, brushSize, terrainColor);
      paintSessionRef.current.last = point;
      paintSessionRef.current.dirty = true;
      requestDraw();
      return;
    }

    if (!paintSessionRef.current.snapshot || !paintSessionRef.current.start) {
      requestDraw();
      return;
    }

    context.putImageData(paintSessionRef.current.snapshot, 0, 0);
    if (selectedTool === 'terrainLine') {
      drawSegment(context, paintSessionRef.current.start, point, brushSize, terrainColor);
    }
    if (selectedTool === 'terrainRect') {
      drawRect(context, paintSessionRef.current.start, point, terrainColor);
    }
    paintSessionRef.current.dirty = true;
    requestDraw();
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const point = canvasPointFromEvent(canvas, event);
    hoverPointRef.current = point;

    if (TOOL_LOOKUP[selectedTool].kind !== 'terrain') {
      requestDraw();
      return;
    }

    if (selectedTool === 'terrainLine' || selectedTool === 'terrainRect') {
      handleCanvasPointerMove(event);
    }

    const wasDirty = paintSessionRef.current.dirty;
    paintSessionRef.current.active = false;
    paintSessionRef.current.last = null;
    paintSessionRef.current.start = null;
    paintSessionRef.current.snapshot = null;
    paintSessionRef.current.dirty = false;

    if (wasDirty) {
      pushHistory();
    } else {
      requestDraw();
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function handleCanvasPointerLeave() {
    if (!paintSessionRef.current.active) {
      hoverPointRef.current = null;
      requestDraw();
    }
  }

  async function handleBackgroundUpload(file: File) {
    const image = await loadImageFromFile(file);
    const context = backgroundContextRef.current;
    if (!context) {
      return;
    }

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = DEFAULT_TERRAIN_HEX;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    fitImageCover(context, image, CANVAS_WIDTH, CANVAS_HEIGHT);
    quantizeCanvasContext(context);
    requestDraw();
    pushHistory();
  }

  function resetTerrainToPlains() {
    const context = backgroundContextRef.current;
    if (!context) {
      return;
    }

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = DEFAULT_TERRAIN_HEX;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    requestDraw();
    pushHistory();
  }

  async function handleClose() {
    const saved = await persistNow();
    onClose(saved);
  }

  const terrainTools = TOOLS.filter((tool) => tool.group === 'terrain');
  const unitTools = TOOLS.filter((tool) => tool.group === 'units');
  const objectTools = TOOLS.filter((tool) => tool.group === 'objects');

  return (
    <section className="editor-shell">
      <aside className="editor-sidebar">
        <div className="sidebar-header">
          <button className="secondary-button compact" type="button" onClick={handleClose}>
            Back to maps
          </button>
          <div className={`save-badge ${saveState}`}>
            <span className="dot" />
            <span>{saveState === 'saving' ? 'Saving' : saveState === 'dirty' ? 'Unsaved changes' : 'Saved locally'}</span>
          </div>
        </div>

        <div className="map-meta-card">
          <img alt="WoD app icon" src={uiAssets.appIcon} />
          <div>
            <p className="eyebrow">Editing battlefield</p>
            <h2>{draft.name || 'Untitled map'}</h2>
            <span>{MODE_LABELS[draft.data.mode]}</span>
          </div>
        </div>

        <div className="panel-tabs" role="tablist" aria-label="Editor panels">
          <button className={activePanel === 'terrain' ? 'active' : ''} type="button" onClick={() => setActivePanel('terrain')}>
            Terrain
          </button>
          <button className={activePanel === 'units' ? 'active' : ''} type="button" onClick={() => setActivePanel('units')}>
            Units
          </button>
          <button className={activePanel === 'map' ? 'active' : ''} type="button" onClick={() => setActivePanel('map')}>
            Map
          </button>
        </div>

        <div className="sidebar-panels">
          <section className={`control-card ${activePanel === 'terrain' ? 'visible' : 'hidden-card'}`}>
            <div className="card-heading">
              <div>
                <p className="eyebrow">Terrain tools</p>
                <h3>Paint directly on the map</h3>
              </div>
              <span className="key-pill">Wheel = size</span>
            </div>
            <div className="tool-cluster">
              {terrainTools.map((tool) => (
                <button
                  key={tool.id}
                  className={`tool-chip ${selectedTool === tool.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => activateTool(tool.id)}
                >
                  <span>{tool.glyph}</span>
                  <div>
                    <strong>{tool.label}</strong>
                    <small>{tool.hint}</small>
                  </div>
                </button>
              ))}
            </div>

            <div className="brush-strip">
              <label htmlFor="brush-size">Brush size</label>
              <div>
                <strong>{brushSize}px</strong>
                <span>Scroll over the map to resize faster.</span>
              </div>
              <input
                id="brush-size"
                max={80}
                min={1}
                type="range"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
            </div>

            <div className="swatch-grid">
              {TERRAIN_COLORS.map((entry) => (
                <button
                  key={entry.hex}
                  aria-label={entry.name}
                  className={`swatch-button ${terrainColor === entry.hex ? 'active' : ''}`}
                  style={{ background: entry.hex }}
                  type="button"
                  onClick={() => setTerrainColor(entry.hex)}
                >
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={`control-card ${activePanel === 'units' ? 'visible' : 'hidden-card'}`}>
            <div className="card-heading">
              <div>
                <p className="eyebrow">Placement</p>
                <h3>Units and objects</h3>
              </div>
              <span className="key-pill">Right click = erase</span>
            </div>

            <div className="tool-cluster compact-cluster">
              {unitTools.concat(objectTools).map((tool) => (
                <button
                  key={tool.id}
                  className={`tool-chip ${selectedTool === tool.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => activateTool(tool.id)}
                >
                  <span>{tool.glyph}</span>
                  <div>
                    <strong>{tool.label}</strong>
                    <small>{tool.hint}</small>
                  </div>
                </button>
              ))}
            </div>

            <div className="team-pills">
              {Array.from({ length: teamCount }, (_, index) => (
                <button
                  key={TEAM_COLORS[index]}
                  className={selectedTeam === index ? 'active' : ''}
                  type="button"
                  onClick={() => setSelectedTeam(index)}
                >
                  <span style={{ background: teamAccent(index) }} />
                  Team {index + 1}
                </button>
              ))}
            </div>

            <div className="stats-grid">
              <article>
                <span>Infantry</span>
                <strong>{counts.infantry}</strong>
              </article>
              <article>
                <span>Tanks</span>
                <strong>{counts.tanks}</strong>
              </article>
              <article>
                <span>Cities</span>
                <strong>{counts.cities}</strong>
              </article>
              <article>
                <span>Capitals</span>
                <strong>{counts.capitals}</strong>
              </article>
              <article>
                <span>Bridges</span>
                <strong>{counts.bridges}</strong>
              </article>
            </div>
          </section>

          <section className={`control-card ${activePanel === 'map' ? 'visible' : 'hidden-card'}`}>
            <div className="card-heading">
              <div>
                <p className="eyebrow">Map setup</p>
                <h3>Metadata and file actions</h3>
              </div>
              <span className="key-pill">Static workspace</span>
            </div>

            <label className="field-block">
              <span>Name</span>
              <input
                type="text"
                value={draft.name}
                onBlur={() => pushHistory(false, draftRef.current)}
                onChange={(event) => {
                  updateDraft({ ...draftRef.current, name: event.target.value }, { autosave: true });
                }}
              />
            </label>

            <label className="field-block">
              <span>Mode</span>
              <select value={draft.data.mode} onChange={(event) => updateMapMode(event.target.value as StoredMap['data']['mode'])}>
                <option value="1v1">1v1 Duel</option>
                <option value="v3">3P Free For All</option>
                <option value="v4">4P Free For All</option>
              </select>
            </label>

            <div className="action-grid">
              <label className="secondary-button file-button">
                Upload background
                <input
                  accept="image/*"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleBackgroundUpload(file);
                    }
                    event.target.value = '';
                  }}
                />
              </label>
              <button className="secondary-button" type="button" onClick={resetTerrainToPlains}>
                Reset terrain
              </button>
              <button className="secondary-button" disabled={!historyState.canUndo} type="button" onClick={() => void handleUndo()}>
                Undo
              </button>
              <button className="secondary-button" disabled={!historyState.canRedo} type="button" onClick={() => void handleRedo()}>
                Redo
              </button>
              <button className="primary-button" type="button" onClick={() => downloadMapFile(getSynchronizedMap())}>
                Download map
              </button>
            </div>
          </section>
        </div>
      </aside>

      <div className="editor-stage">
        <div className="stage-topbar">
          <div>
            <h3>{draft.name || 'Untitled map'}</h3>
            <p>{MODE_LABELS[draft.data.mode]} • Ctrl+Z / Ctrl+Y history • Page scroll locked for brush sizing</p>
          </div>
          <div className="stage-status">
            <span>{TOOL_LOOKUP[selectedTool].label}</span>
            <strong>{TOOL_LOOKUP[selectedTool].hint}</strong>
          </div>
        </div>

        <div className="stage-frame">
          <canvas
            ref={canvasRef}
            className="map-canvas"
            height={CANVAS_HEIGHT}
            width={CANVAS_WIDTH}
            onClick={(event) => {
              if (TOOL_LOOKUP[selectedTool].kind === 'terrain') {
                return;
              }
              const point = canvasPointFromEvent(event.currentTarget, event);
              applyPlacementTool(point.x, point.y);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (TOOL_LOOKUP[selectedTool].kind === 'terrain') {
                return;
              }
              const point = canvasPointFromEvent(event.currentTarget, event);
              eraseAt(point.x, point.y);
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerLeave={handleCanvasPointerLeave}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onWheel={(event) => {
              if (TOOL_LOOKUP[selectedTool].kind !== 'terrain') {
                return;
              }
              event.preventDefault();
              const step = event.shiftKey ? 6 : 2;
              setBrushSize((current) => Math.max(1, Math.min(80, current + (event.deltaY < 0 ? step : -step))));
            }}
          />
        </div>

        <div className="stage-footer">
          <span>Terrain edits are rendered off the React path for lower pointer latency.</span>
          <span>{ready ? 'Canvas ready' : 'Preparing canvas...'}</span>
        </div>
      </div>
    </section>
  );
}