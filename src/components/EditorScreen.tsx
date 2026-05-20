import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Brackets, Info, Keyboard, Mouse, MousePointer2, MouseRight, Redo2, Undo2, ZoomIn, type LucideIcon } from 'lucide-react';
import { flagAssets, getCachedImage, preloadImages, spriteAssets, uiAssets } from '../lib/assets';
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
  TEAM_DISPLAY_ORDER,
  TEAM_LABELS,
  TERRAIN_COLORS,
  TOOLS,
  TOOL_LOOKUP,
  teamColorForIndex,
} from '../lib/constants';
import {
  base64PngFromCanvas,
  cloneMapData,
  cloneMapRecord,
  downloadMapFile,
  teamsForMode,
} from '../lib/mapCodec';
import {
  drawCircleOutline,
  drawDot,
  fillPolygonPixels,
  drawRect,
  drawSegment,
  floodFillContext,
  loadImageFromBase64,
  loadImageFromFile,
  nearestTerrainHex,
  pointToSegmentDistance,
  quantizeCanvasContext,
  rgbToHex,
  sampleClosedBezierShape,
} from '../lib/editorUtils';
import type { MapData, Point, StoredMap, ToolId } from '../lib/types';

interface EditorScreenProps {
  initialMap: StoredMap;
  saveMap: (map: StoredMap) => Promise<StoredMap>;
  onClose: (map: StoredMap) => void;
}

type PanelKey = 'terrain' | 'units' | 'map';

interface HistoryEntry {
  data: MapData;
  surface: ImageData | null;
}

interface EntityBrushSession {
  active: boolean;
  dirty: boolean;
  last: { x: number; y: number } | null;
  pointerId: number | null;
  tool: 'infantry' | 'tank' | 'city' | 'capital' | null;
  working: StoredMap | null;
}

interface MoveSession {
  active: boolean;
  moved: boolean;
  origin: StoredMap | null;
  pointerId: number | null;
  target: Exclude<HoverTarget, { type: 'terrain' } | { type: 'bridge' }> | null;
  working: StoredMap | null;
}

interface ControlHint {
  action: string;
  icon: LucideIcon;
  id: string;
  keys?: string[];
  label: string;
}

type HoverTarget =
  | { type: 'terrain'; label: string; terrainHex: string }
  | { type: 'bridge'; label: string; removeLabel: string; bridge: [Point, Point]; color: string }
  | { type: 'infantry' | 'tank'; label: string; removeLabel: string; point: Point; color: string; entityIndex: number; teamIndex: number }
  | { type: 'city' | 'capital'; label: string; removeLabel: string; point: Point; color: string; cityIndex: number };

function panelForTool(toolId: ToolId): PanelKey {
  const group = TOOL_LOOKUP[toolId].group;
  if (group === 'terrain') return 'terrain';
  if (group === 'units' || group === 'objects') return 'units';
  return 'map';
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function sortCapitalIndices(capitals: number[]) {
  return [...new Set(capitals)].sort((a, b) => a - b);
}

function fitImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const sw = image.naturalWidth || image.width;
  const sh = image.naturalHeight || image.height;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  context.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function teamAccent(index: number, teamCount: number) {
  return TEAM_ACCENTS[teamColorForIndex(index, teamCount)];
}

function createDraftCounts(map: StoredMap) {
  return {
    infantry: map.data.infantry.reduce((c, t) => c + t.length, 0),
    tanks: map.data.tanks.reduce((c, t) => c + t.length, 0),
    cities: map.data.cities.length,
    capitals: map.data.capitals.length,
    bridges: map.data.bridges.length,
  };
}

function clampZoom(value: number) {
  return Math.max(1, Math.min(5, Number(value.toFixed(2))));
}

function disableSmoothing(context: CanvasRenderingContext2D) {
  context.imageSmoothingEnabled = false;
}

function enableSmoothing(context: CanvasRenderingContext2D) {
  context.imageSmoothingEnabled = true;
}

function isBrushSizedTool(toolId: ToolId) {
  return toolId === 'terrainBrush' || toolId === 'terrainLine' || toolId === 'tank' || toolId === 'capital';
}

function isEntityBrushTool(toolId: ToolId): toolId is 'infantry' | 'tank' | 'city' | 'capital' {
  return toolId === 'infantry' || toolId === 'tank' || toolId === 'city' || toolId === 'capital';
}

function isMoveEntityTool(toolId: ToolId) {
  return toolId === 'infantry' || toolId === 'tank' || toolId === 'city' || toolId === 'capital';
}

function visibleTeamOrder(teamCount: number) {
  return TEAM_DISPLAY_ORDER.filter((index) => index < teamCount);
}

function hoverTargetKey(target: HoverTarget | null) {
  if (!target) return 'none';
  if (target.type === 'terrain') return `terrain:${target.terrainHex}:${target.label}`;
  if (target.type === 'bridge' && target.bridge) {
    const [[x1, y1], [x2, y2]] = target.bridge;
    return `bridge:${x1}:${y1}:${x2}:${y2}`;
  }
  if (target.type === 'infantry' || target.type === 'tank') {
    return `${target.type}:${target.teamIndex}:${target.entityIndex}`;
  }
  if (target.type === 'city' || target.type === 'capital') {
    return `${target.type}:${target.cityIndex}`;
  }
  return `${target.type}:${target.removeLabel}`;
}

interface ToolIconProps {
  selectedTeam: number;
  teamCount: number;
  toolId: ToolId;
}

function ControlGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="help-row-icon" strokeWidth={2} />;
}

function ToolIcon({ selectedTeam, teamCount, toolId }: ToolIconProps) {
  const teamColor = teamColorForIndex(selectedTeam, teamCount);

  if (toolId === 'infantry' || toolId === 'tank') {
    return (
      <img
        alt=""
        className="tool-icon-image"
        draggable={false}
        src={spriteAssets[teamColor][toolId === 'infantry' ? 'infantry' : 'tank']}
      />
    );
  }

  if (toolId === 'city' || toolId === 'capital') {
    return <img alt="" className="tool-icon-image" draggable={false} src={toolId === 'city' ? uiAssets.city : uiAssets.capital} />;
  }

  if (toolId === 'terrainFill') {
    return <img alt="" className="tool-icon-image" draggable={false} src={uiAssets.fill} />;
  }

  const svgClassName = 'tool-icon-svg';
  switch (toolId) {
    case 'terrainBrush':
      return (
        <svg aria-hidden="true" className={svgClassName} viewBox="0 0 24 24">
          <path d="M15.8 3.2 20.8 8.2 10.2 18.8 5.2 13.8Z" fill="currentColor" opacity="0.85" />
          <path d="M4.5 19.5c0-2.1 1.7-3.8 3.8-3.8h1.4v1.4c0 2.1-1.7 3.8-3.8 3.8H4.5Z" fill="currentColor" />
        </svg>
      );
    case 'terrainLine':
      return (
        <svg aria-hidden="true" className={svgClassName} viewBox="0 0 24 24">
          <path d="M5 18 18 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <circle cx="5" cy="18" fill="currentColor" r="2" />
          <circle cx="18" cy="5" fill="currentColor" r="2" />
        </svg>
      );
    case 'terrainRect':
      return (
        <svg aria-hidden="true" className={svgClassName} viewBox="0 0 24 24">
          <rect fill="none" height="12" rx="1.5" stroke="currentColor" strokeWidth="2.5" width="16" x="4" y="6" />
        </svg>
      );
    case 'terrainShape':
      return (
        <svg aria-hidden="true" className={svgClassName} viewBox="0 0 24 24">
          <path d="M4.5 14.5c2.5-6 6.5-9 10.5-6 2.7 2 4.5 1.7 4.5 5 0 3.5-3.5 6-7.8 6-4.5 0-8.2-1.8-7.2-5Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="7" cy="14" fill="currentColor" r="1.4" />
          <circle cx="17" cy="9" fill="currentColor" r="1.4" />
        </svg>
      );
    case 'bridge':
      return (
        <svg aria-hidden="true" className={svgClassName} viewBox="0 0 24 24">
          <path d="M4 15h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
          <path d="M7 15V9m10 6V9" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M7 9c1.2 1 2.8 1.5 5 1.5S15.8 10 17 9" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'erase':
      return (
        <svg aria-hidden="true" className={svgClassName} viewBox="0 0 24 24">
          <path d="m7 16 5-8 5 8-2 3H9Z" fill="currentColor" opacity="0.9" />
          <path d="M6 18h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    default:
      return null;
  }
}

function drawMarkerImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  fallback: string,
) {
  if (image.complete && image.naturalWidth > 0) {
    ctx.save();
    enableSmoothing(ctx);
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    ctx.restore();
    return;
  }

  ctx.fillStyle = fallback;
  ctx.beginPath();
  ctx.arc(x, y, size / 2.2, 0, Math.PI * 2);
  ctx.fill();
}

export function EditorScreen({ initialMap, saveMap, onClose }: EditorScreenProps) {
  const [draft, setDraft] = useState(() => cloneMapRecord(initialMap));
  const [selectedTool, setSelectedTool] = useState<ToolId>('terrainBrush');
  const [selectedTeam, setSelectedTeam] = useState(0);
  const [terrainColor, setTerrainColor] = useState(DEFAULT_TERRAIN_HEX);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [zoom, setZoom] = useState(1);
  const [expandedPanels, setExpandedPanels] = useState<Record<PanelKey, boolean>>({ map: true, terrain: true, units: true });
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [ready, setReady] = useState(false);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [shapePointCount, setShapePointCount] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialMap.name);
  const [dockUnitHelpRight, setDockUnitHelpRight] = useState(false);

  // mirrors of state for stable handler access (avoids stale closures + extra effects)
  const draftRef = useRef(draft);
  const selectedToolRef = useRef(selectedTool);
  const selectedTeamRef = useRef(selectedTeam);
  const terrainColorRef = useRef(terrainColor);
  const brushSizeRef = useRef(brushSize);
  draftRef.current = draft;
  selectedToolRef.current = selectedTool;
  selectedTeamRef.current = selectedTeam;
  terrainColorRef.current = terrainColor;
  brushSizeRef.current = brushSize;

  // canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // render loop
  const frameRef = useRef<number | null>(null);
  const sceneDirtyRef = useRef(true);
  const overlayDirtyRef = useRef(true);

  // interaction
  const hoverPointRef = useRef<{ x: number; y: number } | null>(null);
  const hoverTargetRef = useRef<HoverTarget | null>(null);
  const bridgeStartRef = useRef<Point | null>(null);
  const shapePointsRef = useRef<Point[]>([]);
  const paintSessionRef = useRef<{
    active: boolean;
    pointerId: number | null;
    start: { x: number; y: number } | null;
    last: { x: number; y: number } | null;
    snapshot: ImageData | null;
    dirty: boolean;
  }>({ active: false, pointerId: null, start: null, last: null, snapshot: null, dirty: false });
  const entityBrushSessionRef = useRef<EntityBrushSession>({
    active: false,
    dirty: false,
    last: null,
    pointerId: null,
    tool: null,
    working: null,
  });
  const moveSessionRef = useRef<MoveSession>({
    active: false,
    moved: false,
    origin: null,
    pointerId: null,
    target: null,
    working: null,
  });

  // history (in-memory, no base64)
  const historyRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);

  // autosave
  const autosaveTimerRef = useRef<number | null>(null);
  const dirtyForAutosaveRef = useRef(false);
  const mountedRef = useRef(true);

  const counts = useMemo(() => createDraftCounts(draft), [draft]);
  const teamCount = teamsForMode(draft.data.mode);
  const canvasStackStyle = useMemo(
    () => ({ '--editor-zoom': String(zoom) } as CSSProperties),
    [zoom],
  );

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!mountedRef.current) return;
      if (sceneDirtyRef.current) {
        drawScene();
        sceneDirtyRef.current = false;
      }
      if (overlayDirtyRef.current) {
        drawOverlay();
        overlayDirtyRef.current = false;
      }
    });
  }, []);

  // ────────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    document.title = `${initialMap.name} - WoD Map Editor`;

    const terrain = document.createElement('canvas');
    terrain.width = CANVAS_WIDTH;
    terrain.height = CANVAS_HEIGHT;
    const tctx = terrain.getContext('2d', { willReadFrequently: true });
    terrainCanvasRef.current = terrain;
    terrainCtxRef.current = tctx;

    if (tctx) {
      disableSmoothing(tctx);
      tctx.fillStyle = DEFAULT_TERRAIN_HEX;
      tctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    historyRef.current = [];
    futureRef.current = [];

    const preloadList: string[] = [uiAssets.city, uiAssets.capital];
    for (const color of TEAM_COLORS) {
      preloadList.push(spriteAssets[color].infantry, spriteAssets[color].tank);
      preloadList.push(flagAssets[color]);
    }
    void preloadImages(preloadList).then(() => {
      sceneDirtyRef.current = true;
      requestDraw();
    });

    void (async () => {
      if (initialMap.data.map_surface && tctx) {
        const image = await loadImageFromBase64(initialMap.data.map_surface);
        if (!mountedRef.current) return;
        if (image.naturalWidth > 0) tctx.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
      if (!mountedRef.current) return;
      historyRef.current = [snapshotHistory()];
      updateHistoryState();
      setReady(true);
      sceneDirtyRef.current = true;
      requestDraw();
    })();

    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null; // critical: prevent permanently stuck "frame pending" after remount
      }
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${draft.name || 'Untitled map'} - WoD Map Editor`;
  }, [draft.name]);

  useEffect(() => {
    if (!isEditingName) {
      setNameDraft(draft.name);
    }
  }, [draft.name, isEditingName]);

  // Ensure draw after layout commits
  useLayoutEffect(() => {
    sceneDirtyRef.current = true;
    overlayDirtyRef.current = true;
    requestDraw();
  });

  // DPR-aware canvas backing size to match container
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sync = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      };
      sync(canvasRef.current);
      sync(overlayRef.current);
      sceneDirtyRef.current = true;
      overlayDirtyRef.current = true;
      requestDraw();
    };
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    update();
    return () => ro.disconnect();
  }, [requestDraw]);

  // Native non-passive wheel listener (React synthetic onWheel is passive)
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const step = event.shiftKey ? 6 : 2;
        setBrushSize((current) =>
          Math.max(1, Math.min(120, current + (event.deltaY < 0 ? step : -step))),
        );
      } else {
        const step = event.shiftKey ? 0.2 : 0.1;
        setZoom((current) => clampZoom(current + (event.deltaY < 0 ? step : -step)));
      }
      overlayDirtyRef.current = true;
      sceneDirtyRef.current = true;
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [requestDraw]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey)) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) { event.preventDefault(); handleUndo(); return; }
        if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); handleRedo(); return; }
        return;
      }
      if (event.key === 'Escape') {
        if (moveSessionRef.current.active && moveSessionRef.current.origin) {
          previewDraft(cloneMapRecord(moveSessionRef.current.origin));
        }
        paintSessionRef.current.active = false;
        paintSessionRef.current.snapshot = null;
        entityBrushSessionRef.current = { active: false, dirty: false, last: null, pointerId: null, tool: null, working: null };
        moveSessionRef.current = { active: false, moved: false, origin: null, pointerId: null, target: null, working: null };
        bridgeStartRef.current = null;
        shapePointsRef.current = [];
        hoverPointRef.current = null;
        sceneDirtyRef.current = true;
        overlayDirtyRef.current = true;
        requestDraw();
        return;
      }

      const k = event.key.toLowerCase();
      const map: Record<string, ToolId> = {
        b: 'terrainBrush', l: 'terrainLine', r: 'terrainRect', f: 'terrainFill', s: 'terrainShape',
        i: 'infantry', t: 'tank', c: 'city', k: 'capital', g: 'bridge', e: 'erase',
      };
      if (map[k]) { activateTool(map[k]); return; }
      if (k === '[') setBrushSize((s) => Math.max(1, s - 2));
      if (k === ']') setBrushSize((s) => Math.min(120, s + 2));
      if (/^[1-4]$/.test(k)) {
        const teamOrder = visibleTeamOrder(teamCount);
        const displayIndex = parseInt(k, 10) - 1;
        const team = teamOrder[displayIndex];
        if (team !== undefined) setSelectedTeam(team);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamCount]);

  // Mark dirty when relevant state changes
  useEffect(() => {
    sceneDirtyRef.current = true;
    overlayDirtyRef.current = true;
    requestDraw();
  }, [draft, ready, selectedTool, selectedTeam, terrainColor, brushSize, zoom, requestDraw]);

  useEffect(() => {
    if (!hoverPointRef.current) {
      syncHoverTarget(null);
      return;
    }
    syncHoverTarget(findHoverTarget(hoverPointRef.current.x, hoverPointRef.current.y));
  }, [draft]);

  useEffect(() => {
    if (selectedTeam >= teamCount) setSelectedTeam(0);
  }, [selectedTeam, teamCount]);

  useEffect(() => {
    if (!isMoveEntityTool(selectedTool)) {
      setDockUnitHelpRight(false);
    }
  }, [selectedTool]);

  // ────────────────────────────────────────────────────────────
  // Rendering
  // ────────────────────────────────────────────────────────────
  function drawScene() {
    const canvas = canvasRef.current;
    const terrain = terrainCanvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    disableSmoothing(ctx);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(terrain, 0, 0, w, h);

    ctx.save();
    ctx.scale(w / CANVAS_WIDTH, h / CANVAS_HEIGHT);
    disableSmoothing(ctx);

    // Bridges
    ctx.strokeStyle = '#e1b265';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const [[x1, y1], [x2, y2]] of draftRef.current.data.bridges) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Cities / capitals
    const cityImg = getCachedImage(uiAssets.city);
    const capitalImg = getCachedImage(uiAssets.capital);
    draftRef.current.data.cities.forEach((point, index) => {
      const isCapital = draftRef.current.data.capitals.includes(index);
      const img = isCapital ? capitalImg : cityImg;
      const size = isCapital ? CAPITAL_SIZE : CITY_SIZE;
      drawMarkerImage(ctx, img, point[0], point[1], size, isCapital ? '#f7ca5d' : '#e9eef6');
    });

    // Units
    draftRef.current.data.infantry.forEach((team, ti) => {
      const teamColor = teamColorForIndex(ti, teamCount);
      const img = getCachedImage(spriteAssets[teamColor].infantry);
      for (const [x, y] of team) drawSprite(ctx, img, x, y, SPRITE_SIZE, teamAccent(ti, teamCount));
    });
    draftRef.current.data.tanks.forEach((team, ti) => {
      const teamColor = teamColorForIndex(ti, teamCount);
      const img = getCachedImage(spriteAssets[teamColor].tank);
      for (const [x, y] of team) drawSprite(ctx, img, x, y, SPRITE_SIZE + 4, teamAccent(ti, teamCount));
    });

    ctx.restore();
  }

  function drawPulseRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    pulse: number,
  ) {
    ctx.save();
    ctx.globalAlpha = 0.18 + pulse * 0.1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius + 2 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + pulse * 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + pulse * 14;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawHoverHighlight(ctx: CanvasRenderingContext2D, hover: { x: number; y: number } | null) {
    const target = hoverTargetRef.current;
    if (!target) return false;
    const tool = selectedToolRef.current;

    const pulse = 0.55 + 0.45 * ((Math.sin(performance.now() / 210) + 1) / 2);

    if (target.type === 'terrain') {
      if (TOOL_LOOKUP[tool].group !== 'terrain') {
        return false;
      }
      if (!hover) return false;
      const radius = tool === 'terrainBrush' || tool === 'terrainLine'
        ? Math.max(8, Math.round(brushSizeRef.current / 2))
        : HIT_RADIUS;
      drawPulseRing(ctx, hover.x, hover.y, radius, target.terrainHex, pulse);
      return true;
    }

    if (target.type === 'bridge' && target.bridge) {
      if (tool !== 'bridge') {
        return false;
      }
      ctx.save();
      ctx.strokeStyle = target.color;
      ctx.lineWidth = 4 + pulse * 2;
      ctx.shadowColor = target.color;
      ctx.shadowBlur = 12 + pulse * 16;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(target.bridge[0][0], target.bridge[0][1]);
      ctx.lineTo(target.bridge[1][0], target.bridge[1][1]);
      ctx.stroke();
      ctx.restore();
      return true;
    }

    if (!isMoveEntityTool(tool)) {
      return false;
    }

    if (target.type === 'infantry' || target.type === 'tank' || target.type === 'city' || target.type === 'capital') {
      const [x, y] = target.point;
      const radius = target.type === 'tank'
        ? SPRITE_SIZE * 0.72
        : target.type === 'capital'
          ? CAPITAL_SIZE * 0.55
          : target.type === 'city'
            ? CITY_SIZE * 0.52
            : SPRITE_SIZE * 0.62;
      drawPulseRing(ctx, x, y, radius, target.color, pulse);
      return true;
    }

    return false;
  }

  function drawOverlay() {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    disableSmoothing(ctx);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(w / CANVAS_WIDTH, h / CANVAS_HEIGHT);
    disableSmoothing(ctx);

    const tool = selectedToolRef.current;
    const hover = hoverPointRef.current;
    const shapePoints = shapePointsRef.current;

    if (tool === 'bridge' && bridgeStartRef.current) {
      ctx.fillStyle = '#e9c786';
      ctx.beginPath();
      ctx.arc(bridgeStartRef.current[0], bridgeStartRef.current[1], 4, 0, Math.PI * 2);
      ctx.fill();
      if (hover) {
        ctx.strokeStyle = '#e1b265';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(bridgeStartRef.current[0], bridgeStartRef.current[1]);
        ctx.lineTo(hover.x, hover.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (tool === 'terrainShape' && shapePoints.length > 0) {
      const previewPoints = hover ? [...shapePoints, [hover.x, hover.y] as Point] : shapePoints;

      if (previewPoints.length >= 2) {
        const sampled = previewPoints.length >= 3 ? sampleClosedBezierShape(previewPoints) : previewPoints;
        for (let index = 0; index < sampled.length; index += 1) {
          const start = sampled[index];
          const end = sampled[(index + 1) % sampled.length];
          if (previewPoints.length === 2 && index === sampled.length - 1) {
            break;
          }
          drawSegment(ctx, { x: start[0], y: start[1] }, { x: end[0], y: end[1] }, 1, terrainColorRef.current);
        }
      }

      for (const point of shapePoints) {
        ctx.fillStyle = terrainColorRef.current;
        ctx.fillRect(point[0] - 1, point[1] - 1, 3, 3);
      }
    }

    const animateHover = drawHoverHighlight(ctx, hover);

    if (hover) {
      if (tool === 'terrainBrush' || tool === 'terrainLine') {
        const color = terrainColorRef.current;
        const size = Math.max(1, Math.round(brushSizeRef.current));
        drawCircleOutline(ctx, hover, size, color);
      } else if (tool === 'tank' || tool === 'capital') {
        const size = Math.max(HIT_RADIUS * 2, Math.round(brushSizeRef.current));
        const color = tool === 'tank' ? teamAccent(selectedTeamRef.current, teamCount) : '#f7ca5d';
        drawCircleOutline(ctx, hover, size, color);
      } else if (tool !== 'bridge') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, HIT_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();

    if (animateHover && hover) {
      overlayDirtyRef.current = true;
      requestDraw();
    }
  }

  function drawSprite(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    size: number,
    fallback: string,
  ) {
    if (image.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
      return;
    }
    ctx.fillStyle = fallback;
    ctx.beginPath();
    ctx.arc(x, y, size / 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ────────────────────────────────────────────────────────────
  // History
  // ────────────────────────────────────────────────────────────
  function snapshotHistory(): HistoryEntry {
    const tctx = terrainCtxRef.current;
    const surface = tctx ? tctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT) : null;
    return {
      data: cloneMapData(draftRef.current.data),
      surface,
    };
  }

  function pushHistory() {
    historyRef.current.push(snapshotHistory());
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    updateHistoryState();
    queueAutosave();
  }

  function updateHistoryState() {
    setHistoryState({
      canUndo: historyRef.current.length > 1,
      canRedo: futureRef.current.length > 0,
    });
  }

  function restoreHistory(entry: HistoryEntry) {
    const tctx = terrainCtxRef.current;
    if (tctx && entry.surface) tctx.putImageData(entry.surface, 0, 0);
    const next: StoredMap = { ...draftRef.current, data: cloneMapData(entry.data) };
    draftRef.current = next;
    setDraft(next);
    sceneDirtyRef.current = true;
    requestDraw();
    queueAutosave();
  }

  function handleUndo() {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current.pop();
    if (current) futureRef.current.push(current);
    const previous = historyRef.current[historyRef.current.length - 1];
    if (previous) restoreHistory(previous);
    updateHistoryState();
  }

  function handleRedo() {
    const entry = futureRef.current.pop();
    if (!entry) return;
    historyRef.current.push(entry);
    restoreHistory(entry);
    updateHistoryState();
  }

  // ────────────────────────────────────────────────────────────
  // Autosave
  // ────────────────────────────────────────────────────────────
  function queueAutosave() {
    dirtyForAutosaveRef.current = true;
    setSaveState('dirty');
    if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => { void persistNow(); }, AUTOSAVE_DELAY_MS);
  }

  function buildSyncedMap(source = draftRef.current): StoredMap {
    const terrain = terrainCanvasRef.current;
    const next = cloneMapRecord(source);
    if (terrain) next.data.map_surface = base64PngFromCanvas(terrain);
    return next;
  }

  async function persistNow() {
    if (!dirtyForAutosaveRef.current) return draftRef.current;
    if (!mountedRef.current) return draftRef.current;
    setSaveState('saving');
    const saved = await saveMap(buildSyncedMap());
    dirtyForAutosaveRef.current = false;
    if (!mountedRef.current) return saved;
    draftRef.current = { ...saved };
    setDraft(saved);
    setSaveState('saved');
    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // Tools / placement
  // ────────────────────────────────────────────────────────────
  function activateTool(toolId: ToolId) {
    setSelectedTool(toolId);
    setExpandedPanels((current) => ({ ...current, [panelForTool(toolId)]: true }));
    bridgeStartRef.current = null;
    shapePointsRef.current = [];
    setShapePointCount(0);
    paintSessionRef.current.snapshot = null;
    paintSessionRef.current.active = false;
    entityBrushSessionRef.current = { active: false, dirty: false, last: null, pointerId: null, tool: null, working: null };
    sceneDirtyRef.current = true;
    overlayDirtyRef.current = true;
    requestDraw();
  }

  function togglePanel(panel: PanelKey) {
    setExpandedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function commitMapName() {
    const nextName = nameDraft.trim() || 'Untitled map';
    setIsEditingName(false);
    setNameDraft(nextName);
    if (nextName === draftRef.current.name) {
      return;
    }
    const next = { ...draftRef.current, name: nextName };
    draftRef.current = next;
    setDraft(next);
    queueAutosave();
  }

  function syncHoverTarget(next: HoverTarget | null) {
    if (hoverTargetKey(hoverTargetRef.current) === hoverTargetKey(next)) {
      hoverTargetRef.current = next;
      return;
    }
    hoverTargetRef.current = next;
    setHoverTarget(next);
  }

  function findHoverTarget(x: number, y: number): HoverTarget | null {
    const hits: Array<{ distance: number; target: HoverTarget }> = [];
    const unitRadiusSquared = HIT_RADIUS * HIT_RADIUS;

    draftRef.current.data.infantry.forEach((team, teamIndex) => team.forEach((point, entityIndex) => {
      const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (distance <= unitRadiusSquared) {
        const currentTeamCount = teamsForMode(draftRef.current.data.mode);
        const teamColor = teamColorForIndex(teamIndex, currentTeamCount);
        const teamName = TEAM_LABELS[teamColor];
        hits.push({
          distance,
          target: {
            type: 'infantry',
            entityIndex,
            label: `${teamName} infantry`,
            removeLabel: `${teamName.toLowerCase()} infantry`,
            point,
            color: TEAM_ACCENTS[teamColor],
            teamIndex,
          },
        });
      }
    }));

    draftRef.current.data.tanks.forEach((team, teamIndex) => team.forEach((point, entityIndex) => {
      const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (distance <= unitRadiusSquared) {
        const currentTeamCount = teamsForMode(draftRef.current.data.mode);
        const teamColor = teamColorForIndex(teamIndex, currentTeamCount);
        const teamName = TEAM_LABELS[teamColor];
        hits.push({
          distance,
          target: {
            type: 'tank',
            entityIndex,
            label: `${teamName} tank`,
            removeLabel: `${teamName.toLowerCase()} tank`,
            point,
            color: TEAM_ACCENTS[teamColor],
            teamIndex,
          },
        });
      }
    }));

    const capitalSet = new Set(draftRef.current.data.capitals);
    draftRef.current.data.cities.forEach((point, index) => {
      const isCapital = capitalSet.has(index);
      const radius = Math.max(HIT_RADIUS, Math.round((isCapital ? CAPITAL_SIZE : CITY_SIZE) / 2));
      const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (distance <= radius * radius) {
        hits.push({
          distance,
          target: {
            type: isCapital ? 'capital' : 'city',
            cityIndex: index,
            label: isCapital ? 'Capital' : 'City',
            removeLabel: isCapital ? 'capital' : 'city',
            point,
            color: isCapital ? '#f7ca5d' : '#d7ecff',
          },
        });
      }
    });

    draftRef.current.data.bridges.forEach((bridge) => {
      const distance = pointToSegmentDistance(x, y, bridge[0][0], bridge[0][1], bridge[1][0], bridge[1][1]);
      if (distance <= HIT_RADIUS) {
        hits.push({
          distance,
          target: {
            type: 'bridge',
            label: 'Bridge',
            removeLabel: 'bridge',
            bridge,
            color: '#e9c786',
          },
        });
      }
    });

    if (hits.length > 0) {
      hits.sort((left, right) => left.distance - right.distance);
      return hits[0].target;
    }

    const terrainContext = terrainCtxRef.current;
    if (!terrainContext) return null;
    const pixel = terrainContext.getImageData(x, y, 1, 1).data;
    const terrainHex = nearestTerrainHex(rgbToHex(pixel[0], pixel[1], pixel[2]));
    const terrain = TERRAIN_COLORS.find((entry) => entry.hex === terrainHex);
    return {
      type: 'terrain',
      label: `${terrain?.name ?? 'Terrain'} terrain`,
      terrainHex,
    };
  }

  function previewDraft(next: StoredMap) {
    draftRef.current = next;
    setDraft(next);
    sceneDirtyRef.current = true;
    requestDraw();
  }

  function commitDraft(next: StoredMap, withHistory = true) {
    draftRef.current = next;
    setDraft(next);
    sceneDirtyRef.current = true;
    requestDraw();
    if (withHistory) pushHistory();
    else queueAutosave();
  }

  function updateMapMode(nextMode: StoredMap['data']['mode']) {
    const next = cloneMapRecord(draftRef.current);
    next.data.mode = nextMode;
    const n = teamsForMode(nextMode);
    next.data.infantry = Array.from({ length: n }, (_, i) => next.data.infantry[i] ?? []);
    next.data.tanks = Array.from({ length: n }, (_, i) => next.data.tanks[i] ?? []);
    commitDraft(next);
  }

  function nearestCityIndex(x: number, y: number) {
    let best = -1;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    draftRef.current.data.cities.forEach(([cx, cy], i) => {
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  function conversionRadius() {
    return Math.max(HIT_RADIUS, Math.round(brushSizeRef.current / 2));
  }

  function applyTankBrush(map: StoredMap, x: number, y: number) {
    const teamIndex = selectedTeamRef.current;
    const radiusSquared = conversionRadius() * conversionRadius();
    const nextInfantry: Point[] = [];
    let changed = false;

    for (const point of map.data.infantry[teamIndex]) {
      const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
      if (distance <= radiusSquared) {
        map.data.tanks[teamIndex].push(point);
        changed = true;
      } else {
        nextInfantry.push(point);
      }
    }

    map.data.infantry[teamIndex] = nextInfantry;
    return changed;
  }

  function applyInfantryBrush(map: StoredMap, x: number, y: number) {
    const targetTeamIndex = selectedTeamRef.current;
    const radiusSquared = conversionRadius() * conversionRadius();
    const converted: Point[] = [];
    let changed = false;

    map.data.infantry = map.data.infantry.map((team, teamIndex) => team.filter((point) => {
      const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
      if (distance > radiusSquared) {
        return true;
      }
      if (teamIndex === targetTeamIndex) {
        return true;
      }
      converted.push(point);
      changed = true;
      return false;
    }));

    map.data.tanks = map.data.tanks.map((team) => team.filter((point) => {
      const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
      if (distance > radiusSquared) {
        return true;
      }
      converted.push(point);
      changed = true;
      return false;
    }));

    if (converted.length > 0) {
      map.data.infantry[targetTeamIndex].push(...converted);
    }

    return changed;
  }

  function applyCapitalBrush(map: StoredMap, x: number, y: number) {
    const radiusSquared = conversionRadius() * conversionRadius();
    const capitalSet = new Set(map.data.capitals);
    let changed = false;

    map.data.cities.forEach((point, index) => {
      const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
      if (distance <= radiusSquared && !capitalSet.has(index)) {
        capitalSet.add(index);
        changed = true;
      }
    });

    if (changed) {
      map.data.capitals = sortCapitalIndices([...capitalSet]);
    }

    return changed;
  }

  function applyCityBrush(map: StoredMap, x: number, y: number) {
    const radiusSquared = conversionRadius() * conversionRadius();
    const capitalSet = new Set(map.data.capitals);
    let changed = false;

    map.data.cities.forEach((point, index) => {
      const distance = (point[0] - x) * (point[0] - x) + (point[1] - y) * (point[1] - y);
      if (distance <= radiusSquared && capitalSet.has(index)) {
        capitalSet.delete(index);
        changed = true;
      }
    });

    if (changed) {
      map.data.capitals = sortCapitalIndices([...capitalSet]);
    }

    return changed;
  }

  function applyEntityBrushAtPoint(map: StoredMap, tool: 'infantry' | 'tank' | 'city' | 'capital', x: number, y: number) {
    if (tool === 'infantry') return applyInfantryBrush(map, x, y);
    if (tool === 'tank') return applyTankBrush(map, x, y);
    if (tool === 'city') return applyCityBrush(map, x, y);
    return applyCapitalBrush(map, x, y);
  }

  function applyEntityBrushAlongSegment(
    map: StoredMap,
    tool: 'infantry' | 'tank' | 'city' | 'capital',
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY), 1);
    let changed = false;

    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      changed = applyEntityBrushAtPoint(
        map,
        tool,
        Math.round(start.x + deltaX * t),
        Math.round(start.y + deltaY * t),
      ) || changed;
    }

    return changed;
  }

  function moveHoveredEntity(
    map: StoredMap,
    target: Exclude<HoverTarget, { type: 'terrain' } | { type: 'bridge' }>,
    x: number,
    y: number,
  ) {
    const nextPoint: Point = [x, y];

    if (target.type === 'infantry') {
      const current = map.data.infantry[target.teamIndex][target.entityIndex];
      if (!current || (current[0] === x && current[1] === y)) return false;
      map.data.infantry[target.teamIndex][target.entityIndex] = nextPoint;
      return true;
    }

    if (target.type === 'tank') {
      const current = map.data.tanks[target.teamIndex][target.entityIndex];
      if (!current || (current[0] === x && current[1] === y)) return false;
      map.data.tanks[target.teamIndex][target.entityIndex] = nextPoint;
      return true;
    }

    if (target.type === 'city' || target.type === 'capital') {
      const current = map.data.cities[target.cityIndex];
      if (!current || (current[0] === x && current[1] === y)) return false;
      map.data.cities[target.cityIndex] = nextPoint;
      return true;
    }

    return false;
  }

  function commitShape(points = shapePointsRef.current, confirmPoint?: Point) {
    const tctx = terrainCtxRef.current;
    const pointsToCommit = confirmPoint && points.length === 2 ? [...points, confirmPoint] : points;
    if (!tctx || pointsToCommit.length < 3) {
      return;
    }

    const sampled = sampleClosedBezierShape(pointsToCommit);
    fillPolygonPixels(tctx, sampled, terrainColorRef.current);
    shapePointsRef.current = [];
    setShapePointCount(0);
    hoverPointRef.current = null;
    syncHoverTarget(null);
    sceneDirtyRef.current = true;
    overlayDirtyRef.current = true;
    requestDraw();
    pushHistory();
  }

  function eraseAt(x: number, y: number) {
    const next = cloneMapRecord(draftRef.current);
    const hits: Array<{ kind: 'infantry' | 'tank' | 'city' | 'bridge'; teamIndex?: number; index: number; d: number }> = [];
    const r2 = HIT_RADIUS * HIT_RADIUS;

    next.data.infantry.forEach((team, ti) => team.forEach((p, i) => {
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (d <= r2) hits.push({ kind: 'infantry', teamIndex: ti, index: i, d });
    }));
    next.data.tanks.forEach((team, ti) => team.forEach((p, i) => {
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (d <= r2) hits.push({ kind: 'tank', teamIndex: ti, index: i, d });
    }));
    next.data.cities.forEach((p, i) => {
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (d <= r2) hits.push({ kind: 'city', index: i, d });
    });
    next.data.bridges.forEach((b, i) => {
      const [[x1, y1], [x2, y2]] = b;
      const d = pointToSegmentDistance(x, y, x1, y1, x2, y2);
      if (d * d <= r2) hits.push({ kind: 'bridge', index: i, d: d * d });
    });

    if (hits.length === 0) return;
    hits.sort((a, b) => a.d - b.d);
    const c = hits[0];
    if (c.kind === 'infantry' && c.teamIndex !== undefined) next.data.infantry[c.teamIndex].splice(c.index, 1);
    if (c.kind === 'tank' && c.teamIndex !== undefined) next.data.tanks[c.teamIndex].splice(c.index, 1);
    if (c.kind === 'bridge') next.data.bridges.splice(c.index, 1);
    if (c.kind === 'city') {
      next.data.cities.splice(c.index, 1);
      next.data.capitals = next.data.capitals
        .filter((idx) => idx !== c.index)
        .map((idx) => (idx > c.index ? idx - 1 : idx));
    }
    commitDraft(next);
  }

  function applyPlacement(x: number, y: number) {
    const tool = selectedToolRef.current;
    if (tool === 'erase') { eraseAt(x, y); return; }
    const next = cloneMapRecord(draftRef.current);
    const team = selectedTeamRef.current;

    if (tool === 'infantry') { next.data.infantry[team].push([x, y]); commitDraft(next); return; }
    if (tool === 'tank') { next.data.tanks[team].push([x, y]); commitDraft(next); return; }
    if (tool === 'city') { next.data.cities.push([x, y]); commitDraft(next); return; }
    if (tool === 'capital') {
      next.data.cities.push([x, y]);
      next.data.capitals = sortCapitalIndices([...next.data.capitals, next.data.cities.length - 1]);
      commitDraft(next);
      return;
    }
    if (tool === 'bridge') {
      if (!bridgeStartRef.current) {
        bridgeStartRef.current = [x, y];
        overlayDirtyRef.current = true;
        requestDraw();
        return;
      }
      next.data.bridges.push([[bridgeStartRef.current[0], bridgeStartRef.current[1]], [x, y]]);
      bridgeStartRef.current = null;
      commitDraft(next);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Pointer
  // ────────────────────────────────────────────────────────────
  function pointFromEvent(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT);
    return {
      x: Math.max(0, Math.min(CANVAS_WIDTH - 1, x)),
      y: Math.max(0, Math.min(CANVAS_HEIGHT - 1, y)),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 2) return;
    const canvas = event.currentTarget;
    const point = pointFromEvent(canvas, event);
    hoverPointRef.current = point;
    const nextHoverTarget = findHoverTarget(point.x, point.y);
    syncHoverTarget(nextHoverTarget);
    const tool = selectedToolRef.current;

    if (event.button === 2) {
      if (tool === 'terrainShape' && shapePointsRef.current.length >= 2) {
        commitShape(shapePointsRef.current, [point.x, point.y]);
        return;
      }
      eraseAt(point.x, point.y);
      overlayDirtyRef.current = true;
      requestDraw();
      return;
    }

    if (event.shiftKey && isEntityBrushTool(tool)) {
      const working = cloneMapRecord(draftRef.current);
      const dirty = applyEntityBrushAtPoint(working, tool, point.x, point.y);
      entityBrushSessionRef.current = {
        active: true,
        dirty,
        last: point,
        pointerId: event.pointerId,
        tool,
        working,
      };
      canvas.setPointerCapture(event.pointerId);
      if (dirty) {
        previewDraft(working);
      }
      overlayDirtyRef.current = true;
      requestDraw();
      return;
    }

    if (
      event.button === 0
      && isMoveEntityTool(tool)
      && nextHoverTarget
      && nextHoverTarget.type !== 'terrain'
      && nextHoverTarget.type !== 'bridge'
    ) {
      moveSessionRef.current = {
        active: true,
        moved: false,
        origin: cloneMapRecord(draftRef.current),
        pointerId: event.pointerId,
        target: nextHoverTarget,
        working: cloneMapRecord(draftRef.current),
      };
      canvas.setPointerCapture(event.pointerId);
      overlayDirtyRef.current = true;
      requestDraw();
      return;
    }

    if (tool === 'terrainShape') {
      const nextPoints = [...shapePointsRef.current, [point.x, point.y] as Point];
      shapePointsRef.current = nextPoints;
      setShapePointCount(nextPoints.length);
      overlayDirtyRef.current = true;
      requestDraw();
      return;
    }

    const kind = TOOL_LOOKUP[tool].kind;

    if (kind !== 'terrain') {
      applyPlacement(point.x, point.y);
      overlayDirtyRef.current = true;
      requestDraw();
      return;
    }

    const tctx = terrainCtxRef.current;
    if (!tctx) return;
    canvas.setPointerCapture(event.pointerId);
    bridgeStartRef.current = null;

    if (tool === 'terrainFill') {
      if (floodFillContext(tctx, point.x, point.y, terrainColorRef.current)) {
        sceneDirtyRef.current = true;
        requestDraw();
        pushHistory();
      }
      return;
    }

    paintSessionRef.current = {
      active: true,
      pointerId: event.pointerId,
      start: point,
      last: point,
      snapshot: null,
      dirty: false,
    };

    if (tool === 'terrainBrush') {
      drawDot(tctx, point, brushSizeRef.current, terrainColorRef.current);
      paintSessionRef.current.dirty = true;
      sceneDirtyRef.current = true;
      requestDraw();
      return;
    }
    paintSessionRef.current.snapshot = tctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const point = pointFromEvent(canvas, event);
    hoverPointRef.current = point;
    syncHoverTarget(findHoverTarget(point.x, point.y));
    overlayDirtyRef.current = true;

    const tool = selectedToolRef.current;
    const entityBrushSession = entityBrushSessionRef.current;
    const moveSession = moveSessionRef.current;
    const session = paintSessionRef.current;
    const tctx = terrainCtxRef.current;

    if (tool === 'terrainShape') {
      requestDraw();
      return;
    }

    if (moveSession.active && moveSession.pointerId === event.pointerId && moveSession.target && moveSession.working) {
      const changed = moveHoveredEntity(moveSession.working, moveSession.target, point.x, point.y);
      moveSession.moved = moveSession.moved || changed;
      if (changed) {
        previewDraft(moveSession.working);
      }
      requestDraw();
      return;
    }

    if (entityBrushSession.active && entityBrushSession.tool === tool && entityBrushSession.working && entityBrushSession.last) {
      const changed = applyEntityBrushAlongSegment(entityBrushSession.working, entityBrushSession.tool, entityBrushSession.last, point);
      entityBrushSession.last = point;
      entityBrushSession.dirty = entityBrushSession.dirty || changed;
      if (changed) {
        previewDraft(entityBrushSession.working);
      }
      requestDraw();
      return;
    }

    if (!session.active || !tctx || TOOL_LOOKUP[tool].kind !== 'terrain') {
      requestDraw();
      return;
    }

    if (tool === 'terrainBrush' && session.last) {
      drawSegment(tctx, session.last, point, brushSizeRef.current, terrainColorRef.current);
      session.last = point;
      session.dirty = true;
      sceneDirtyRef.current = true;
      requestDraw();
      return;
    }
    if ((tool === 'terrainLine' || tool === 'terrainRect') && session.snapshot && session.start) {
      tctx.putImageData(session.snapshot, 0, 0);
      if (tool === 'terrainLine') {
        drawSegment(tctx, session.start, point, brushSizeRef.current, terrainColorRef.current);
      } else {
        drawRect(tctx, session.start, point, terrainColorRef.current);
      }
      session.dirty = true;
      sceneDirtyRef.current = true;
      requestDraw();
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const tool = selectedToolRef.current;
    const moveSession = moveSessionRef.current;
    const entityBrushSession = entityBrushSessionRef.current;
    const session = paintSessionRef.current;

    if (moveSession.active && moveSession.pointerId === event.pointerId) {
      const wasMoved = moveSession.moved;
      moveSessionRef.current = { active: false, moved: false, origin: null, pointerId: null, target: null, working: null };
      if (wasMoved) {
        pushHistory();
      }
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (entityBrushSession.active && entityBrushSession.pointerId === event.pointerId) {
      const wasDirty = entityBrushSession.dirty;
      entityBrushSessionRef.current = { active: false, dirty: false, last: null, pointerId: null, tool: null, working: null };
      if (wasDirty) {
        pushHistory();
      }
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (TOOL_LOOKUP[tool].kind === 'terrain' && session.active) {
      const wasDirty = session.dirty;
      paintSessionRef.current = {
        active: false, pointerId: null, start: null, last: null, snapshot: null, dirty: false,
      };
      if (wasDirty) {
        sceneDirtyRef.current = true;
        requestDraw();
        pushHistory();
      }
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerLeave() {
    if (paintSessionRef.current.active || entityBrushSessionRef.current.active || moveSessionRef.current.active) return;
    hoverPointRef.current = null;
    syncHoverTarget(null);
    overlayDirtyRef.current = true;
    requestDraw();
  }

  function handleStagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!showsUnitControls || !stageRef.current) {
      if (dockUnitHelpRight) {
        setDockUnitHelpRight(false);
      }
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const shouldDockRight = localX <= 248 && localY <= 176;

    if (shouldDockRight !== dockUnitHelpRight) {
      setDockUnitHelpRight(shouldDockRight);
    }
  }

  function handleStagePointerLeave() {
    if (dockUnitHelpRight) {
      setDockUnitHelpRight(false);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Background / reset / close
  // ────────────────────────────────────────────────────────────
  async function handleBackgroundUpload(file: File) {
    const tctx = terrainCtxRef.current;
    if (!tctx) return;
    const image = await loadImageFromFile(file);
    tctx.fillStyle = DEFAULT_TERRAIN_HEX;
    tctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    fitImageCover(tctx, image, CANVAS_WIDTH, CANVAS_HEIGHT);
    quantizeCanvasContext(tctx);
    sceneDirtyRef.current = true;
    requestDraw();
    pushHistory();
  }

  function resetTerrainToPlains() {
    const tctx = terrainCtxRef.current;
    if (!tctx) return;
    tctx.fillStyle = DEFAULT_TERRAIN_HEX;
    tctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    sceneDirtyRef.current = true;
    requestDraw();
    pushHistory();
  }

  async function handleClose() {
    const saved = await persistNow();
    onClose(saved);
  }

  const terrainTools = TOOLS.filter((t) => t.group === 'terrain');
  const unitTools = TOOLS.filter((t) => t.group === 'units');
  const objectTools = TOOLS.filter((t) => t.group === 'objects');
  const orderedTeams = visibleTeamOrder(teamCount);
  const showsBrushSize = isBrushSizedTool(selectedTool);
  const showsUnitControls = isMoveEntityTool(selectedTool);
  const stageContext = useMemo(() => {
    const parts = [TOOL_LOOKUP[selectedTool].hint];

    if (showsBrushSize) {
      parts.push(`Brush ${brushSize}px.`);
    }

    if (selectedTool === 'terrainShape') {
      if (shapePointCount >= 2) {
        parts.push(`${shapePointCount} anchors placed. Right-click adds the last anchor and confirms.`);
      } else if (shapePointCount > 0) {
        parts.push(`${shapePointCount} anchor placed. Add 1 more anchor, then right-click to confirm.`);
      } else {
        parts.push('Left-click anchors, then right-click to place the last anchor and confirm.');
      }
    }

    if (isMoveEntityTool(selectedTool)) {
      parts.push('Left click places. Shift + left drag brushes replacements.');
    } else if (selectedTool === 'erase') {
      parts.push('Click or right-click removes the nearest object.');
    } else if (selectedTool === 'bridge') {
      parts.push('Click two points to place a bridge.');
    }

    return parts.join(' ');
  }, [brushSize, selectedTool, shapePointCount, showsBrushSize]);
  const unitControlItems = useMemo<ControlHint[]>(() => {
    if (!showsUnitControls) {
      return [];
    }

    return [
      { id: 'unit-place', icon: MousePointer2, label: 'Left click', action: 'places the selected unit.', keys: ['LMB'] },
      { id: 'unit-drag', icon: MousePointer2, label: 'Left drag', action: 'moves a placed unit or city.', keys: ['LMB'] },
      { id: 'unit-brush', icon: Mouse, label: 'Shift + left drag', action: 'brushes replacements to the selected tool.', keys: ['Shift', 'LMB'] },
    ];
  }, [showsUnitControls]);
  const helpItems = useMemo<ControlHint[]>(() => {
    const items: ControlHint[] = [
      { id: 'zoom', icon: ZoomIn, label: 'Wheel', action: 'Zoom the map.' },
      { id: 'brush-size', icon: Mouse, label: 'Ctrl + wheel', keys: ['Ctrl'], action: 'Adjust brush size for brush-based tools.' },
      {
        id: 'erase',
        icon: MouseRight,
        label: 'Right click',
        action: hoverTarget && hoverTarget.type !== 'terrain'
          ? `Remove the hovered ${hoverTarget.removeLabel}.`
          : 'Remove the nearest hovered object.',
      },
      { id: 'undo', icon: Undo2, label: 'Undo', keys: ['Ctrl', 'Z'], action: 'Step back one edit.' },
      { id: 'redo', icon: Redo2, label: 'Redo', keys: ['Ctrl', 'Y'], action: 'Step forward one edit.' },
      { id: 'brush-brackets', icon: Brackets, label: '[ / ]', action: 'Shrink or grow the brush.' },
      { id: 'teams', icon: Keyboard, label: '1 - 4', action: 'Switch the active team color.' },
      { id: 'tools', icon: Keyboard, label: 'B L R F S I T C K G E', action: 'Quick-select editor tools.' },
      { id: 'hover', icon: MousePointer2, label: 'Hover', action: 'Preview glow only on targets relevant to the active tool.' },
    ];

    if (isMoveEntityTool(selectedTool)) {
      items.splice(3, 0, {
        id: 'move-drag',
        icon: MousePointer2,
        label: 'Left drag',
        action: 'Move the hovered unit or city.',
      });
      items.splice(4, 0, {
        id: 'replace-brush',
        icon: Mouse,
        label: 'Shift + left drag',
        keys: ['Shift'],
        action: 'Brush-replace compatible targets to the selected tool.',
      });
    }

    if (selectedTool === 'terrainShape') {
      items.splice(3, 0, {
        id: 'shape-confirm',
        icon: MouseRight,
        label: 'Right click',
        action: shapePointCount >= 2 ? 'Place the last anchor and confirm the current curved shape.' : 'Confirm a curved shape after placing 2 anchors.',
      });
    }

    if (selectedTool === 'tank' || selectedTool === 'capital') {
      items.splice(3, 0, {
        id: 'convert-drag',
        icon: MousePointer2,
        label: 'Drag',
        action: selectedTool === 'tank' ? 'Convert infantry into tanks.' : 'Convert cities into capitals.',
      });
    }

    return items;
  }, [hoverTarget, selectedTool, shapePointCount]);

  return (
    <section className="editor-shell">
      <aside className="editor-sidebar">
        <div className="sidebar-header">
          <button className="ghost-button" type="button" onClick={handleClose} title="Back to library">
            ← Library
          </button>
          <div className={`save-badge ${saveState}`}>
            <span className="dot" />
            <span>{saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved' : 'Saved'}</span>
          </div>
        </div>

        <div className="map-meta-card">
          <div className="meta-text">
            <p className="eyebrow">Editing</p>
            {isEditingName ? (
              <input
                autoFocus
                className="map-name-input"
                type="text"
                value={nameDraft}
                onBlur={commitMapName}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitMapName();
                  }
                  if (event.key === 'Escape') {
                    setIsEditingName(false);
                    setNameDraft(draftRef.current.name);
                  }
                }}
              />
            ) : (
              <button className="map-name-button" type="button" onClick={() => setIsEditingName(true)}>
                <h2>{draft.name || 'Untitled map'}</h2>
              </button>
            )}
            <span>{MODE_LABELS[draft.data.mode]}</span>
          </div>
          <div className="meta-actions">
            <button className="icon-button" type="button" disabled={!historyState.canUndo} onClick={handleUndo} title="Undo (Ctrl+Z)">↶</button>
            <button className="icon-button" type="button" disabled={!historyState.canRedo} onClick={handleRedo} title="Redo (Ctrl+Y)">↷</button>
          </div>
        </div>

        <div className="sidebar-panels">
          <section className="control-card control-panel">
            <button
              aria-expanded={expandedPanels.map}
              className="panel-toggle"
              type="button"
              onClick={() => togglePanel('map')}
            >
              <span className="panel-toggle-copy">
                <span className="panel-toggle-title">Map</span>
                <span className="panel-toggle-subtitle">Mode, background, and export</span>
              </span>
              <span className={`panel-toggle-chevron ${expandedPanels.map ? 'expanded' : ''}`}>▾</span>
            </button>
            {expandedPanels.map && (
              <div className="panel-body">
              <label className="field-block">
                <span>Mode</span>
                <select value={draft.data.mode} onChange={(e) => updateMapMode(e.target.value as StoredMap['data']['mode'])}>
                  <option value="1v1">1v1 Duel</option>
                  <option value="v3">3-Player FFA</option>
                  <option value="v4">4-Player FFA</option>
                </select>
              </label>
              <div className="action-grid">
                <label className="secondary-button file-button">
                  Upload background
                  <input
                    accept="image/*"
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleBackgroundUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button className="secondary-button" type="button" onClick={resetTerrainToPlains}>Reset terrain</button>
                <button className="primary-button" type="button" onClick={() => downloadMapFile(buildSyncedMap())}>
                  Download bundle
                </button>
              </div>
              </div>
            )}
          </section>

          <section className="control-card control-panel">
            <button
              aria-expanded={expandedPanels.terrain}
              className="panel-toggle"
              type="button"
              onClick={() => togglePanel('terrain')}
            >
              <span className="panel-toggle-copy">
                <span className="panel-toggle-title">Terrain</span>
                <span className="panel-toggle-subtitle">Brushes, shapes, and palette</span>
              </span>
              <span className={`panel-toggle-chevron ${expandedPanels.terrain ? 'expanded' : ''}`}>▾</span>
            </button>
            {expandedPanels.terrain && (
              <div className="panel-body">
              <div className="tool-grid">
                {terrainTools.map((tool) => (
                  <button
                    key={tool.id}
                    className={`tool-button ${selectedTool === tool.id ? 'active' : ''}`}
                    type="button"
                    onClick={() => activateTool(tool.id)}
                    title={tool.hint}
                  >
                    <span className="glyph"><ToolIcon selectedTeam={selectedTeam} teamCount={teamCount} toolId={tool.id} /></span>
                    <span className="label">{tool.label}</span>
                  </button>
                ))}
              </div>

              <div className="brush-strip">
                <div className="brush-head">
                  <span>Brush</span>
                  <strong>{brushSize}px</strong>
                </div>
                <input
                  aria-label="Brush size"
                  max={120}
                  min={1}
                  type="range"
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
              </div>

              <div className="swatch-grid">
                {TERRAIN_COLORS.map((entry) => (
                  <button
                    key={entry.hex}
                    aria-label={entry.name}
                    title={entry.name}
                    className={`swatch ${terrainColor === entry.hex ? 'active' : ''}`}
                    style={{ background: entry.hex }}
                    type="button"
                    onClick={() => setTerrainColor(entry.hex)}
                  >
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
              </div>
            )}
          </section>

          <section className="control-card control-panel">
            <button
              aria-expanded={expandedPanels.units}
              className="panel-toggle"
              type="button"
              onClick={() => togglePanel('units')}
            >
              <span className="panel-toggle-copy">
                <span className="panel-toggle-title">Units</span>
                <span className="panel-toggle-subtitle">Teams, units, objects, and counts</span>
              </span>
              <span className={`panel-toggle-chevron ${expandedPanels.units ? 'expanded' : ''}`}>▾</span>
            </button>
            {expandedPanels.units && (
              <div className="panel-body">
              <div className="tool-grid">
                {unitTools.concat(objectTools).map((tool) => (
                  <button
                    key={tool.id}
                    className={`tool-button ${selectedTool === tool.id ? 'active' : ''}`}
                    type="button"
                    onClick={() => activateTool(tool.id)}
                    title={tool.hint}
                  >
                    <span className="glyph"><ToolIcon selectedTeam={selectedTeam} teamCount={teamCount} toolId={tool.id} /></span>
                    <span className="label">{tool.label}</span>
                  </button>
                ))}
              </div>

              <div className="team-pills">
                {orderedTeams.map((index, displayIndex) => (
                  <button
                    key={teamColorForIndex(index, teamCount)}
                    className={selectedTeam === index ? 'active' : ''}
                    type="button"
                    onClick={() => setSelectedTeam(index)}
                    title={`${TEAM_LABELS[teamColorForIndex(index, teamCount)]} (key ${displayIndex + 1})`}
                  >
                    <img alt="" className="team-flag" draggable={false} src={flagAssets[teamColorForIndex(index, teamCount)]} />
                    {TEAM_LABELS[teamColorForIndex(index, teamCount)]}
                  </button>
                ))}
              </div>
              </div>
            )}
          </section>

        </div>
      </aside>

      <div className="editor-stage">
        <div className="stage-topbar">
          <div className="stage-tool-summary">
            <span className="tool-chip-pill"><span className="tool-chip-icon"><ToolIcon selectedTeam={selectedTeam} teamCount={teamCount} toolId={selectedTool} /></span>{TOOL_LOOKUP[selectedTool].label}</span>
            <p className="stage-context">{stageContext}</p>
          </div>
          <div className="stage-topbar-actions">
            <div className="stage-help">
              <button aria-label="Show editor controls" className="stage-help-trigger" type="button">
                <Info aria-hidden="true" className="stage-help-trigger-icon" strokeWidth={2.2} />
              </button>
              <div className="stage-help-card" role="note">
                <p className="stage-help-title">Controls</p>
                <div className="stage-help-list">
                  {helpItems.map((item) => (
                    <div key={item.id} className="help-row">
                      <span className="help-row-glyph"><ControlGlyph icon={item.icon} /></span>
                      <div className="help-row-copy">
                        <div className="help-row-head">
                          <span className="help-row-label">{item.label}</span>
                          {item.keys?.length ? (
                            <span className="help-row-keys">
                              {item.keys.map((key) => (
                                <span key={`${item.id}-${key}`} className="keycap">{key}</span>
                              ))}
                            </span>
                          ) : null}
                        </div>
                        <span className="help-row-action">{item.action}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="stage-frame" ref={stageRef} onPointerLeave={handleStagePointerLeave} onPointerMove={handleStagePointerMove}>
          {showsUnitControls ? (
            <div className={`stage-floating-help ${dockUnitHelpRight ? 'dock-right' : 'dock-left'}`} role="note">
              {unitControlItems.map((item) => (
                <div key={item.id} className="help-row stage-floating-help-row">
                  <span className="help-row-glyph"><ControlGlyph icon={item.icon} /></span>
                  <div className="help-row-copy">
                    <span className="stage-floating-help-text"><strong>{item.label}</strong> {item.action}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="canvas-stack" style={canvasStackStyle}>
            <canvas ref={canvasRef} className="map-canvas base" onContextMenu={(e) => e.preventDefault()} />
            <canvas
              ref={overlayRef}
              className="map-canvas overlay"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
            />
            {!ready && <div className="canvas-loading"><span className="loading-pulse" /></div>}
          </div>
        </div>
      </div>
    </section>
  );
}
