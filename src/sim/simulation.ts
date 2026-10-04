import { ANT_STATS, Ant } from './ants';
import { updateFog } from './fog';
import { Point, tileCenter, worldToTile } from './map';
import { findPath, smoothPath } from './pathfinding';
import { Rng } from './rng';
import { GameState } from './state';
import { updateTasks } from './tasks';

/** Fixed simulation step. Rendering interpolates between steps. */
export const TICK_MS = 50;

/**
 * Upper bound on A* nodes expanded per tick, so a 100-ant move order is
 * spread over a few ticks instead of stalling a frame. Counted in nodes rather
 * than milliseconds so the simulation stays deterministic.
 */
const PATH_NODE_BUDGET = 40_000;

export function stepSimulation(state: GameState): void {
  state.tick++;
  const rng = new Rng(state.rngState);
  updateTasks(state, rng);
  processPathRequests(state);
  for (const ant of state.ants) {
    ant.prevX = ant.x;
    ant.prevY = ant.y;
    walk(ant, (ANT_STATS[ant.type].speed * TICK_MS) / 1000);
  }
  updateFog(state);
  state.rngState = rng.state;
}

function processPathRequests(state: GameState): void {
  let budget = PATH_NODE_BUDGET;
  for (const ant of state.ants) {
    if (budget <= 0) break;
    if (!ant.moveTarget) continue;
    const target = ant.moveTarget;
    ant.moveTarget = null;

    const { tiles, expanded } = findPath(
      state.map,
      { x: worldToTile(ant.x), y: worldToTile(ant.y) },
      { x: worldToTile(target.x), y: worldToTile(target.y) },
    );
    budget -= Math.max(expanded, 1);
    if (!tiles) continue;

    const points: Point[] = [
      { x: ant.x, y: ant.y },
      ...tiles.slice(1, -1).map((t) => ({ x: tileCenter(t.x), y: tileCenter(t.y) })),
      target,
    ];
    ant.path = smoothPath(state.map, points, ANT_STATS[ant.type].radius).slice(1);
  }
}

function walk(ant: Ant, distance: number): void {
  let remaining = distance;
  while (remaining > 0 && ant.path.length > 0) {
    const wp = ant.path[0];
    const dx = wp.x - ant.x;
    const dy = wp.y - ant.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) ant.angle = Math.atan2(dy, dx);
    if (d <= remaining) {
      ant.x = wp.x;
      ant.y = wp.y;
      remaining -= d;
      ant.path.shift();
    } else {
      ant.x += (dx / d) * remaining;
      ant.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
}
