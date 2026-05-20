import type { Mode, ToolId } from './types';

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;
export const HIT_RADIUS = 12;
export const SPRITE_SIZE = 18;
export const CITY_SIZE = 26;
export const CAPITAL_SIZE = 30;
export const DEFAULT_BRUSH_SIZE = 10;
export const HISTORY_LIMIT = 40;
export const AUTOSAVE_DELAY_MS = 220;
export const DEFAULT_TERRAIN_HEX = '#A1C246';

export const TEAM_COLORS = ['blue', 'orange', 'red', 'purple'] as const;

export const TEAM_ACCENTS: Record<(typeof TEAM_COLORS)[number], string> = {
  blue: '#4b8dff',
  orange: '#ff9c47',
  red: '#eb5a58',
  purple: '#b881ff',
};

export const MODE_TEAMS: Record<Mode, number> = {
  '1v1': 2,
  v3: 3,
  v4: 4,
};

export const MODE_LABELS: Record<Mode, string> = {
  '1v1': '1v1 Duel',
  v3: '3P Free For All',
  v4: '4P Free For All',
};

export const TERRAIN_COLORS = [
  { name: 'Plains', hex: '#A1C246' },
  { name: 'Forest', hex: '#388336' },
  { name: 'River', hex: '#279BFF' },
  { name: 'Mud', hex: '#784B23' },
  { name: 'Sand', hex: '#EEE3B0' },
  { name: 'Hill', hex: '#888A87' },
  { name: 'Mountain', hex: '#6D6B6F' },
] as const;

export const TERRAIN_PALETTE = TERRAIN_COLORS.map((entry) => entry.hex);

export interface ToolDefinition {
  id: ToolId;
  label: string;
  hint: string;
  group: 'terrain' | 'units' | 'objects';
  kind: 'terrain' | 'team' | 'plain' | 'erase';
  glyph: string;
}

export const TOOLS: ToolDefinition[] = [
  { id: 'terrainBrush', label: 'Brush', hint: 'Paint terrain with drag input.', group: 'terrain', kind: 'terrain', glyph: 'BR' },
  { id: 'terrainLine', label: 'Line', hint: 'Draw snapped terrain strokes.', group: 'terrain', kind: 'terrain', glyph: 'LN' },
  { id: 'terrainRect', label: 'Rect', hint: 'Block out areas fast.', group: 'terrain', kind: 'terrain', glyph: 'RC' },
  { id: 'terrainFill', label: 'Fill', hint: 'Flood a contiguous terrain region.', group: 'terrain', kind: 'terrain', glyph: 'FL' },
  { id: 'terrainPick', label: 'Pick', hint: 'Sample terrain from the map.', group: 'terrain', kind: 'terrain', glyph: 'PK' },
  { id: 'infantry', label: 'Infantry', hint: 'Place infantry for the selected team.', group: 'units', kind: 'team', glyph: 'IN' },
  { id: 'tank', label: 'Tank', hint: 'Place tanks for the selected team.', group: 'units', kind: 'team', glyph: 'TK' },
  { id: 'city', label: 'City', hint: 'Place a neutral city.', group: 'objects', kind: 'plain', glyph: 'CT' },
  { id: 'capital', label: 'Capital', hint: 'Toggle capital state on a city.', group: 'objects', kind: 'plain', glyph: 'CP' },
  { id: 'bridge', label: 'Bridge', hint: 'Click two points to span a bridge.', group: 'objects', kind: 'plain', glyph: 'BG' },
  { id: 'erase', label: 'Erase', hint: 'Remove the nearest placed object.', group: 'objects', kind: 'erase', glyph: 'ER' },
];

export const TOOL_LOOKUP: Record<ToolId, ToolDefinition> = Object.fromEntries(
  TOOLS.map((tool) => [tool.id, tool]),
) as Record<ToolId, ToolDefinition>;