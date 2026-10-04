import { TILE_SIZE } from '../config';
import { isExploredBy } from './fog';
import { inBounds, isWalkable, tileCenter } from './map';
import type { ColonyId, GameState } from './state';

/** Who is moving: a colony, or wildlife (which respects nobody's walls). */
export type Owner = ColonyId | 'wild';

export interface Wall {
  /** Tile index (y * width + x). */
  tile: number;
  owner: ColonyId;
  /** False while it's still a plan waiting for pebbles. */
  built: boolean;
  pebbles: number;
  hp: number;
}

/** A pile of pebbles workers can carry off to build walls. */
export interface PebblePile {
  id: number;
  x: number;
  y: number;
  amount: number;
  max: number;
}

/** Pebbles needed per wall tile. */
export const WALL_PEBBLES = 3;
export const WALL_HP = 300;
/**
 * Extra A* cost for walking through someone else's wall (it has to be chewed
 * through). Enemies take a detour of up to roughly this many tiles instead.
 */
export const WALL_PATH_PENALTY = 25;
/** Walls can't be planned this close (tiles) to any nest, so entrances stay open. */
const NEST_CLEARANCE = 2;

export function wallAt(state: GameState, tile: number): Wall | undefined {
  return state.walls[tile];
}

/**
 * Built walls stop everyone except their owner's ants, who know the gaps.
 * So a colony can never wall itself in, and enemies must go around or chew through.
 */
export function blocks(state: GameState, owner: Owner, tile: number): boolean {
  const wall = state.walls[tile];
  return !!wall && wall.built && wall.owner !== owner;
}

/** Extra path cost per tile for a mover owned by `owner`. */
export function wallCost(state: GameState, owner: Owner): (tile: number) => number {
  return (tile) => (blocks(state, owner, tile) ? WALL_PATH_PENALTY : 0);
}

/** Why `colony` can't plan a wall on (x, y), or null if it can. */
export function wallPlanBlocker(state: GameState, colony: ColonyId, x: number, y: number): string | null {
  const { map } = state;
  if (!inBounds(map, x, y) || !isWalkable(map, x, y)) return 'Not open ground';
  if (!isExploredBy(state, colony, x, y)) return 'Unexplored';
  const idx = y * map.width + x;
  if (state.walls[idx]) return 'Already a wall';
  for (const c of state.colonies) {
    if (Math.hypot(c.nest.x - x, c.nest.y - y) <= NEST_CLEARANCE) return 'Too close to a nest';
  }
  const cx = tileCenter(x);
  const cy = tileCenter(y);
  const near = (p: { x: number; y: number }) => Math.abs(p.x - cx) < TILE_SIZE && Math.abs(p.y - cy) < TILE_SIZE;
  if (state.food.some(near) || state.pebbles.some(near)) return 'Something is in the way';
  return null;
}

/** Unfinished wall plans belonging to a colony. */
export function openPlans(state: GameState, colony: ColonyId): Wall[] {
  return Object.values(state.walls).filter((w) => w.owner === colony && !w.built);
}
