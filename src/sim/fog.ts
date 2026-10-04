import { ANT_STATS } from './ants';
import { GameMap, inBounds, worldToTile } from './map';
import type { ColonyId, GameState } from './state';

/** Vision radius of a nest, in tiles. */
export const NEST_SIGHT = 8;

/**
 * Fog of war. `state.fog[colony]` is the saved "explored" grid (1 = seen at
 * least once). What each colony can see *right now* is derived every tick
 * and cached here rather than saved.
 */
const visibleCache = new WeakMap<GameState, Map<ColonyId, Uint8Array>>();

export function updateFog(state: GameState): void {
  const { map } = state;
  let visible = visibleCache.get(state);
  if (!visible) {
    visible = new Map();
    visibleCache.set(state, visible);
  }

  for (const colony of state.colonies) {
    let grid = visible.get(colony.id);
    if (!grid) {
      grid = new Uint8Array(map.width * map.height);
      visible.set(colony.id, grid);
    }
    grid.fill(0);
    for (const nest of colony.nests) reveal(map, grid, state.fog[colony.id], nest.tile.x, nest.tile.y, NEST_SIGHT);
  }

  for (const ant of state.ants) {
    const grid = visible.get(ant.colony);
    if (!grid) continue;
    reveal(map, grid, state.fog[ant.colony], worldToTile(ant.x), worldToTile(ant.y), ANT_STATS[ant.type].sight);
  }
}

function reveal(map: GameMap, visible: Uint8Array, explored: number[], cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(map, x, y) || (x - cx) ** 2 + (y - cy) ** 2 > r * r + r) continue;
      const i = y * map.width + x;
      visible[i] = 1;
      explored[i] = 1;
    }
  }
}

/** Tiles the colony can currently see (1) or not (0). */
export function visibleTiles(state: GameState, colony: ColonyId): Uint8Array {
  let grid = visibleCache.get(state)?.get(colony);
  if (!grid) {
    updateFog(state);
    grid = visibleCache.get(state)!.get(colony)!;
  }
  return grid;
}

export function isExploredBy(state: GameState, colony: ColonyId, tx: number, ty: number): boolean {
  return inBounds(state.map, tx, ty) && state.fog[colony][ty * state.map.width + tx] === 1;
}

export function isVisibleTo(state: GameState, colony: ColonyId, tx: number, ty: number): boolean {
  return inBounds(state.map, tx, ty) && visibleTiles(state, colony)[ty * state.map.width + tx] === 1;
}
