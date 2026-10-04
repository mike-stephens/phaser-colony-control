import { updateAi } from './ai';
import { ANT_STATS } from './ants';
import { updateCombat } from './combat';
import { updateEconomy } from './economy';
import { updateFog } from './fog';
import { Point, inBounds, tileCenter, worldToTile } from './map';
import { findPath, smoothPath } from './pathfinding';
import { Rng } from './rng';
import { GameState } from './state';
import { updateTasks } from './tasks';
import { Owner, blocks, wallCost } from './walls';
import { CREATURE_STATS, updateWildlife } from './wildlife';

/** Fixed simulation step. Rendering interpolates between steps. */
export const TICK_MS = 50;

/**
 * Upper bound on A* nodes expanded per tick, so a 100-ant move order is
 * spread over a few ticks instead of stalling a frame. Counted in nodes rather
 * than milliseconds so the simulation stays deterministic.
 */
const PATH_NODE_BUDGET = 20_000;

/** Anything that walks: ants and creatures share pathing and wall rules. */
interface Mover {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  angle: number;
  path: Point[];
  moveTarget: Point | null;
  blockedWall: number | null;
}

interface MoverInfo {
  mover: Mover;
  owner: Owner;
  speed: number;
  radius: number;
}

export function stepSimulation(state: GameState): void {
  if (state.winner !== null) return;
  state.tick++;
  const rng = new Rng(state.rngState);
  updateAi(state, rng);
  updateEconomy(state, rng);
  updateTasks(state, rng);
  updateWildlife(state, rng);
  updateCombat(state);

  const movers = allMovers(state);
  processPathRequests(state, movers);
  for (const m of movers) {
    m.mover.prevX = m.mover.x;
    m.mover.prevY = m.mover.y;
    walk(state, m, (m.speed * TICK_MS) / 1000);
  }
  updateFog(state);
  state.rngState = rng.state;
}

function allMovers(state: GameState): MoverInfo[] {
  const list: MoverInfo[] = state.ants.map((a) => ({
    mover: a,
    owner: a.colony,
    speed: ANT_STATS[a.type].speed,
    radius: ANT_STATS[a.type].radius,
  }));
  for (const c of state.creatures) {
    const s = CREATURE_STATS[c.kind];
    list.push({ mover: c, owner: 'wild', speed: s.speed, radius: s.radius });
  }
  return list;
}

function processPathRequests(state: GameState, movers: MoverInfo[]): void {
  let budget = PATH_NODE_BUDGET;
  for (const { mover, owner, radius } of movers) {
    if (budget <= 0) break;
    if (!mover.moveTarget) continue;
    const target = mover.moveTarget;
    mover.moveTarget = null;

    const { tiles, expanded } = findPath(
      state.map,
      { x: worldToTile(mover.x), y: worldToTile(mover.y) },
      { x: worldToTile(target.x), y: worldToTile(target.y) },
      wallCost(state, owner),
    );
    budget -= Math.max(expanded, 1);
    if (!tiles) continue;

    const points: Point[] = [
      { x: mover.x, y: mover.y },
      ...tiles.slice(1, -1).map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) })),
      target,
    ];
    const wallBlocked = (px: number, py: number) => blocks(state, owner, tileOf(state, px, py));
    mover.path = smoothPath(state.map, points, radius, wallBlocked).slice(1);
  }
}

/**
 * Advances along the path. Stepping into a tile with someone else's wall
 * stops the mover and marks the wall to be chewed through (combat.ts).
 */
function walk(state: GameState, { mover, owner }: MoverInfo, distance: number): void {
  if (mover.blockedWall !== null) {
    if (blocks(state, owner, mover.blockedWall)) return;
    mover.blockedWall = null;
  }
  let remaining = distance;
  while (remaining > 0 && mover.path.length > 0) {
    const wp = mover.path[0];
    const dx = wp.x - mover.x;
    const dy = wp.y - mover.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) mover.angle = Math.atan2(dy, dx);
    const step = Math.min(d, remaining);
    const nx = d > 0 ? mover.x + (dx / d) * step : wp.x;
    const ny = d > 0 ? mover.y + (dy / d) * step : wp.y;

    const from = tileOf(state, mover.x, mover.y);
    const to = tileOf(state, nx, ny);
    if (to !== from && blocks(state, owner, to)) {
      mover.blockedWall = to;
      return;
    }

    mover.x = nx;
    mover.y = ny;
    remaining -= step;
    if (step === d) mover.path.shift();
  }
}

function tileOf(state: GameState, px: number, py: number): number {
  const tx = worldToTile(px);
  const ty = worldToTile(py);
  return inBounds(state.map, tx, ty) ? ty * state.map.width + tx : -1;
}
