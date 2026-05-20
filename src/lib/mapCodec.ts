import pako from 'pako';
import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_TERRAIN_HEX, MODE_LABELS, MODE_TEAMS } from './constants';
import type { Bridge, EditorSnapshot, MapData, Mode, Point, StoredMap } from './types';

const MODE_ALIASES: Record<string, Mode> = {
  '1v1': '1v1',
  '1v1 duel': '1v1',
  duel: '1v1',
  '3pffa': 'v3',
  '3p ffa': 'v3',
  v3: 'v3',
  '4pffa': 'v4',
  '4p ffa': 'v4',
  ffa: 'v4',
  v4: 'v4',
};

export function normalizeMode(mode: string | null | undefined): Mode {
  return MODE_ALIASES[String(mode ?? '1v1').trim().toLowerCase()] ?? '1v1';
}

export function teamsForMode(mode: string | null | undefined) {
  return MODE_TEAMS[normalizeMode(mode)];
}

export function modeLabel(mode: string | null | undefined) {
  return MODE_LABELS[normalizeMode(mode)];
}

function normalizePoint(point: unknown): Point | null {
  if (!Array.isArray(point) || point.length < 2) {
    return null;
  }

  const x = Number(point[0]);
  const y = Number(point[1]);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return [x, y];
}

function normalizeBridge(bridge: unknown): Bridge | null {
  if (Array.isArray(bridge) && bridge.length === 4) {
    const start = normalizePoint([bridge[0], bridge[1]]);
    const end = normalizePoint([bridge[2], bridge[3]]);
    return start && end ? [start, end] : null;
  }

  if (Array.isArray(bridge) && bridge.length === 2) {
    const start = normalizePoint(bridge[0]);
    const end = normalizePoint(bridge[1]);
    return start && end ? [start, end] : null;
  }

  if (bridge && typeof bridge === 'object' && 'value' in (bridge as Record<string, unknown>)) {
    return normalizeBridge((bridge as { value: unknown }).value);
  }

  return null;
}

function createSolidMapSurface(hex = DEFAULT_TERRAIN_HEX) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }

  context.fillStyle = hex;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

export function emptyMapData(mode: Mode = '1v1'): MapData {
  const teamCount = MODE_TEAMS[mode];
  return {
    map_surface: createSolidMapSurface(),
    mode,
    infantry: Array.from({ length: teamCount }, () => []),
    tanks: Array.from({ length: teamCount }, () => []),
    cities: [],
    capitals: [],
    bridges: [],
  };
}

export function normalizeMapData(data: unknown): MapData {
  if (!data || typeof data !== 'object') {
    return emptyMapData('1v1');
  }

  const raw = data as Partial<MapData> & { mode?: string };
  const mode = normalizeMode(raw.mode);
  const teamCount = teamsForMode(mode);

  const normalizeTeamBuckets = (collection: unknown) =>
    Array.from({ length: teamCount }, (_, index) => {
      const bucket = Array.isArray(collection) ? collection[index] : null;
      return Array.isArray(bucket)
        ? bucket.map(normalizePoint).filter((point): point is Point => point !== null)
        : [];
    });

  const cities = Array.isArray(raw.cities)
    ? raw.cities.map(normalizePoint).filter((point): point is Point => point !== null)
    : [];

  const capitals = Array.isArray(raw.capitals)
    ? raw.capitals.map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value < cities.length)
    : [];

  const bridges = Array.isArray(raw.bridges)
    ? raw.bridges.map(normalizeBridge).filter((bridge): bridge is Bridge => bridge !== null)
    : [];

  return {
    map_surface: typeof raw.map_surface === 'string' ? raw.map_surface : createSolidMapSurface(),
    mode,
    infantry: normalizeTeamBuckets(raw.infantry),
    tanks: normalizeTeamBuckets(raw.tanks),
    cities,
    capitals,
    bridges,
  };
}

export function cloneMapData(mapData: MapData): MapData {
  return {
    map_surface: mapData.map_surface,
    mode: mapData.mode,
    infantry: mapData.infantry.map((team) => team.map(([x, y]) => [x, y] as Point)),
    tanks: mapData.tanks.map((team) => team.map(([x, y]) => [x, y] as Point)),
    cities: mapData.cities.map(([x, y]) => [x, y] as Point),
    capitals: [...mapData.capitals],
    bridges: mapData.bridges.map(([start, end]) => [[start[0], start[1]], [end[0], end[1]]] as Bridge),
  };
}

export function cloneMapRecord(map: StoredMap): StoredMap {
  return {
    ...map,
    data: cloneMapData(map.data),
  };
}

export function createMapRecord(name: string, mode: Mode = '1v1'): StoredMap {
  const timestamp = Date.now();
  return {
    id: generateMapId(),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    data: emptyMapData(mode),
  };
}

export function generateMapId() {
  return `map_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function snapshotForHistory(map: StoredMap): EditorSnapshot {
  return {
    name: map.name,
    data: cloneMapData(map.data),
  };
}

export function applySnapshot(map: StoredMap, snapshot: EditorSnapshot): StoredMap {
  return {
    ...map,
    name: snapshot.name,
    data: normalizeMapData(snapshot.data),
  };
}

export function serializeSnapshot(snapshot: EditorSnapshot) {
  return JSON.stringify(snapshot);
}

export function parseSnapshot(snapshot: string): EditorSnapshot {
  const parsed = JSON.parse(snapshot) as EditorSnapshot;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : 'Untitled map',
    data: normalizeMapData(parsed.data),
  };
}

export function gzipMap(mapData: MapData) {
  return pako.gzip(JSON.stringify(normalizeMapData(mapData)));
}

export async function readCompressedMap(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = pako.ungzip(bytes, { to: 'string' });
  return normalizeMapData(JSON.parse(text));
}

export function downloadMapFile(map: StoredMap) {
  const blob = new Blob([gzipMap(map.data)], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${map.name || 'map'}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function base64PngFromCanvas(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

export function formatUpdatedAt(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}