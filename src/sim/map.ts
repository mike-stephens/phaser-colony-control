export enum Terrain {
  Grass = 0,
  Dirt = 1,
  Water = 2,
  Rock = 3,
  Hole = 4,
}

export const WALKABLE: Record<Terrain, boolean> = {
  [Terrain.Grass]: true,
  [Terrain.Dirt]: true,
  [Terrain.Water]: false,
  [Terrain.Rock]: false,
  [Terrain.Hole]: false,
};

export interface TilePos {
  x: number;
  y: number;
}

/** The world grid. Tiles are stored row-major: index = y * width + x. */
export interface GameMap {
  width: number;
  height: number;
  tiles: Terrain[];
}

export function tileAt(map: GameMap, x: number, y: number): Terrain {
  return map.tiles[y * map.width + x];
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && WALKABLE[tileAt(map, x, y)];
}
