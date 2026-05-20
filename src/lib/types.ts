export type Mode = '1v1' | 'v3' | 'v4';

export type Point = [number, number];

export type Bridge = [Point, Point];

export interface MapData {
  map_surface: string;
  mode: Mode;
  infantry: Point[][];
  tanks: Point[][];
  cities: Point[];
  capitals: number[];
  bridges: Bridge[];
}

export interface StoredMap {
  id: string;
  name: string;
  data: MapData;
  createdAt: number;
  updatedAt: number;
}

export interface EditorSnapshot {
  name: string;
  data: MapData;
}

export type ToolId =
  | 'terrainBrush'
  | 'terrainLine'
  | 'terrainRect'
  | 'terrainFill'
  | 'terrainShape'
  | 'infantry'
  | 'tank'
  | 'city'
  | 'capital'
  | 'bridge'
  | 'erase';