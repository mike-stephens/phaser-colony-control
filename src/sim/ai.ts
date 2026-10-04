import { isMoving } from './ants';
import { gatherersOf, issueCommand } from './commands';
import { ANT_COST, upkeepDue, trainBlocker } from './economy';
import { isExploredBy } from './fog';
import { Point, isWalkable, tileCenter, worldToTile } from './map';
import { regionAt } from './regions';
import { Rng } from './rng';
import { Colony, GameState, nestPoint } from './state';

/** How often (ticks) the AI re-evaluates; it doesn't need to react every tick. */
const THINK_INTERVAL = 40;
/** Most workers the AI puts on a single food source. */
const MAX_PER_SOURCE = 4;
/** Workers the AI aims for before it starts adding soldiers. */
const WORKER_TARGET = 20;
/** Soldiers only eat; don't build them until the economy has this many workers. */
const MIN_WORKERS_FOR_SOLDIERS = 12;

/**
 * Computer opponent. It only acts through issueCommand and only knows what
 * its own fog of war shows, the same as the player. For now it runs the
 * economy (explore, gather, train); fighting comes in Phase 5.
 */
export function updateAi(state: GameState, rng: Rng): void {
  if (!state.rules.ai || state.tick % THINK_INTERVAL !== 0) return;
  for (const colony of state.colonies) {
    if (!colony.isPlayer) think(state, colony, rng);
  }
}

function think(state: GameState, colony: Colony, rng: Rng): void {
  const openSlots = assignIdleWorkers(state, colony, rng);
  train(state, colony, openSlots);
}

/** Puts idle workers on known food or scouting; returns gatherer slots still open. */
function assignIdleWorkers(state: GameState, colony: Colony, rng: Rng): number {
  const idle = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'worker' && a.task.kind === 'idle' && !isMoving(a),
  );

  const nest = nestPoint(state, colony.id);
  const homeRegion = regionAt(state.map, colony.nest.x, colony.nest.y);
  const known = state.food
    .filter((f) => {
      const tx = worldToTile(f.x);
      const ty = worldToTile(f.y);
      return isExploredBy(state, colony.id, tx, ty) && regionAt(state.map, tx, ty) === homeRegion;
    })
    .sort((a, b) => Math.hypot(a.x - nest.x, a.y - nest.y) - Math.hypot(b.x - nest.x, b.y - nest.y));

  let free = idle.length;
  let openSlots = 0;
  for (const food of known) {
    const current = gatherersOf(state, colony.id, food.id).length;
    const add = Math.min(free, MAX_PER_SOURCE - current);
    if (add > 0) {
      issueCommand(state, colony.id, { type: 'setGatherers', foodId: food.id, count: current + add });
      free -= add;
    }
    openSlots += Math.max(0, MAX_PER_SOURCE - current - Math.max(add, 0));
  }

  // Nothing known for the rest to gather: scout the nearest unexplored ground.
  const scouts = idle.filter((a) => a.task.kind === 'idle');
  if (scouts.length > 0) {
    const target = scoutTarget(state, colony, rng);
    if (target) issueCommand(state, colony.id, { type: 'explore', antIds: scouts.map((a) => a.id), target });
  }
  return openSlots;
}

/** Samples random tiles and returns the unexplored, reachable one closest to the nest. */
function scoutTarget(state: GameState, colony: Colony, rng: Rng): Point | null {
  const { map } = state;
  const home = regionAt(map, colony.nest.x, colony.nest.y);
  let best: Point | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < 300; i++) {
    const x = rng.int(0, map.width - 1);
    const y = rng.int(0, map.height - 1);
    if (!isWalkable(map, x, y) || regionAt(map, x, y) !== home || isExploredBy(state, colony.id, x, y)) continue;
    const d = Math.hypot(x - colony.nest.x, y - colony.nest.y);
    if (d < bestDist) {
      best = { x: tileCenter(x), y: tileCenter(y) };
      bestDist = d;
    }
  }
  return best;
}

/**
 * Grows the colony only as fast as its food supply allows: more workers while
 * there is food for them to gather, soldiers once the economy has slack.
 */
function train(state: GameState, colony: Colony, openSlots: number): void {
  if (colony.queue.length >= 2) return;
  const workers = state.ants.filter((a) => a.colony === colony.id && a.type === 'worker').length;
  const soldiers = state.ants.filter((a) => a.colony === colony.id && a.type === 'soldier').length;
  const upkeep = upkeepDue(state, colony.id);
  let type: 'worker' | 'soldier' | null = null;
  if (openSlots > 0 && (workers < WORKER_TARGET || soldiers * 2 >= workers)) {
    type = 'worker';
  } else if (workers >= MIN_WORKERS_FOR_SOLDIERS && soldiers * 2 < workers) {
    type = 'soldier';
  }
  if (!type) return;
  // Keep meals in reserve so training never starves the colony; soldiers need more slack.
  const reserve = upkeep * (type === 'worker' ? 2 : 4);
  if (colony.food - ANT_COST[type].food < reserve) return;
  if (trainBlocker(state, colony, type) === null) {
    issueCommand(state, colony.id, { type: 'train', antType: type });
  }
}
