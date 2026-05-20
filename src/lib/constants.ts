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
export const TEAM_DISPLAY_ORDER = [0, 2, 1, 3] as const;
export const TEAM_LABELS: Record<(typeof TEAM_COLORS)[number], string> = {
  blue: 'Blue',
  orange: 'Orange',
  red: 'Red',
  purple: 'Purple',
};

export const TEAM_ACCENTS: Record<(typeof TEAM_COLORS)[number], string> = {
  blue: '#4b8dff',
  orange: '#ff9c47',
  red: '#eb5a58',
  purple: '#b881ff',
};

export function teamColorForIndex(teamIndex: number, teamCount: number) {
  if (teamCount === 2 && teamIndex === 1) {
    return 'red' as const;
  }

  return TEAM_COLORS[teamIndex % TEAM_COLORS.length];
}

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
  { name: 'Snow', hex: '#FFFFFF' },
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
  kind: 'terrain' | 'team' | 'plain' | 'erase' | 'select';
}

export const TOOLS: ToolDefinition[] = [
  { id: 'terrainBrush', label: 'Brush', hint: 'Paint terrain with drag input.', group: 'terrain', kind: 'terrain' },
  { id: 'terrainLine', label: 'Line', hint: 'Draw thick terrain strokes.', group: 'terrain', kind: 'terrain' },
  { id: 'terrainRect', label: 'Rect', hint: 'Block out areas fast.', group: 'terrain', kind: 'terrain' },
  { id: 'terrainFill', label: 'Fill', hint: 'Flood a contiguous terrain region.', group: 'terrain', kind: 'terrain' },
  { id: 'terrainShape', label: 'Shape', hint: 'Left-click anchors, then right-click to fill a curved shape.', group: 'terrain', kind: 'terrain' },
  { id: 'bridge', label: 'Bridge', hint: 'Click two points to span a bridge.', group: 'terrain', kind: 'plain' },
  { id: 'select', label: 'Select', hint: 'Drag to select units and cities. Shift adds. Ctrl drags only the box.', group: 'units', kind: 'select' },
  { id: 'infantry', label: 'Infantry', hint: 'Place infantry for the selected team.', group: 'units', kind: 'team' },
  { id: 'tank', label: 'Tank', hint: 'Brush over infantry to convert them into tanks.', group: 'units', kind: 'team' },
  { id: 'city', label: 'City', hint: 'Place a neutral city.', group: 'objects', kind: 'plain' },
  { id: 'capital', label: 'Capital', hint: 'Brush over cities to turn them into capitals.', group: 'objects', kind: 'plain' },
  { id: 'erase', label: 'Erase', hint: 'Remove the nearest placed object.', group: 'objects', kind: 'erase' },
];

export const TOOL_LOOKUP: Record<ToolId, ToolDefinition> = Object.fromEntries(
  TOOLS.map((tool) => [tool.id, tool]),
) as Record<ToolId, ToolDefinition>;