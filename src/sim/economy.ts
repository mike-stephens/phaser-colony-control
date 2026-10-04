import { ANT_STATS, AntType, createAnt } from './ants';
import { FOOD_AMOUNTS } from './food';
import { isWalkableWorld, tileCenter, worldToTile } from './map';
import { findFoodSpot, foodSourceTarget, randomFoodKind } from './mapgen';
import { Rng } from './rng';
import { Colony, ColonyId, GameState, Nest, nestCenter } from './state';
import { colonyCapacity, updateDigging } from './underground';

/** Food cost and training time (in ticks; 20 ticks = 1 s) for each ant type. */
export const ANT_COST: Record<AntType, { food: number; ticks: number }> = {
  worker: { food: 10, ticks: 160 },
  soldier: { food: 25, ticks: 300 },
  queen: { food: 100, ticks: 900 },
};

/** Food each ant eats per upkeep interval. */
export const UPKEEP: Record<AntType, number> = { worker: 1, soldier: 2, queen: 4 };
export const UPKEEP_INTERVAL_TICKS = 600;
/** Share of max HP an unfed ant loses per missed meal (3 missed meals = death). */
const STARVE_DAMAGE = 1 / 3;
/** Share of max HP a fed ant recovers per meal. */
const FED_HEAL = 0.25;
export const MAX_QUEUE = 5;
/** Feeding order when food is short: queens first, soldiers last. */
const FEEDING_ORDER: AntType[] = ['queen', 'worker', 'soldier'];
/** How often (ticks) a new food source may appear somewhere in the yard. */
export const FOOD_REGROW_TICKS = 1200;

export function updateEconomy(state: GameState, rng: Rng): void {
  for (const colony of state.colonies) {
    if (colony.eliminated) continue;
    for (const nest of colony.nests) updateProduction(state, colony, nest, rng);
  }
  updateDigging(state, rng);
  if (state.rules.foodRegrowth && state.tick % FOOD_REGROW_TICKS === 0) regrowFood(state, rng);
  if (state.rules.upkeep && state.tick % UPKEEP_INTERVAL_TICKS === 0) {
    // Ants starved to death here are removed (and counted) by combat.removeDead.
    for (const colony of state.colonies) if (!colony.eliminated) payUpkeep(state, colony);
  }
}

export function population(state: GameState, colony: ColonyId): number {
  let n = 0;
  for (const a of state.ants) if (a.colony === colony) n++;
  return n;
}

/** Food the colony will eat at the next upkeep. */
export function upkeepDue(state: GameState, colony: ColonyId): number {
  let total = 0;
  for (const a of state.ants) if (a.colony === colony) total += UPKEEP[a.type];
  return total;
}

/** Ticks until the next upkeep meal. */
export function ticksUntilUpkeep(state: GameState): number {
  return UPKEEP_INTERVAL_TICKS - (state.tick % UPKEEP_INTERVAL_TICKS);
}

/** Ants queued across all of a colony's nests. */
export function queuedCount(colony: Colony): number {
  return colony.nests.reduce((n, nest) => n + nest.queue.length, 0);
}

/**
 * Why `nest` can't queue this ant right now, or null if it can. The colony's
 * underground sets how many ants it can house (hatched plus queued).
 */
export function trainBlocker(state: GameState, colony: Colony, nest: Nest, type: AntType): string | null {
  if (nest.queue.length >= MAX_QUEUE) return 'Queue full';
  if (population(state, colony.id) + queuedCount(colony) >= colonyCapacity(colony)) return 'Nest full: digging';
  if (colony.food < ANT_COST[type].food) return 'Not enough food';
  return null;
}

function updateProduction(state: GameState, colony: Colony, nest: Nest, rng: Rng): void {
  const type = nest.queue[0];
  if (!type) return;
  if (nest.progress < ANT_COST[type].ticks) {
    nest.progress++;
    return;
  }
  // Fully grown; hatch it once there is room.
  if (population(state, colony.id) >= colonyCapacity(colony)) return;
  nest.queue.shift();
  nest.progress = 0;
  hatch(state, colony, nest, type, rng);
}

function hatch(state: GameState, colony: Colony, nest: Nest, type: AntType, rng: Rng): void {
  const at = nestCenter(nest);
  const ant = createAnt(state.nextId++, colony.id, type, at);
  ant.angle = rng.next() * Math.PI * 2;
  ant.moveTarget = nest.rally ?? nearNest(state, at, rng);
  state.ants.push(ant);
  colony.stats.trained++;
}

/** A walkable spot a short walk from the nest entrance, so hatchlings don't pile up on it. */
function nearNest(state: GameState, nest: { x: number; y: number }, rng: Rng) {
  for (let i = 0; i < 8; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 36 + rng.next() * 40;
    const p = { x: nest.x + Math.cos(a) * r, y: nest.y + Math.sin(a) * r };
    if (isWalkableWorld(state.map, p.x, p.y)) return p;
  }
  return { ...nest };
}

function payUpkeep(state: GameState, colony: Colony): void {
  const ants = state.ants
    .filter((a) => a.colony === colony.id)
    .sort((a, b) => FEEDING_ORDER.indexOf(a.type) - FEEDING_ORDER.indexOf(b.type) || a.id - b.id);
  let starved = 0;
  for (const ant of ants) {
    const max = ANT_STATS[ant.type].maxHp;
    if (colony.food >= UPKEEP[ant.type]) {
      colony.food -= UPKEEP[ant.type];
      ant.hp = Math.min(max, ant.hp + max * FED_HEAL);
    } else {
      ant.hp -= max * STARVE_DAMAGE;
      if (ant.hp < 0.01) ant.hp = 0;
      starved++;
    }
  }
  colony.starving = starved > 0;
}

/** Keeps the yard from running dry: tops food back up toward the map's starting level. */
function regrowFood(state: GameState, rng: Rng): void {
  if (state.food.length >= foodSourceTarget(state.map)) return;
  const nests = state.colonies.flatMap((c) => c.nests.map((n) => n.tile));
  const existing = state.food.map((f) => ({ x: worldToTile(f.x), y: worldToTile(f.y) }));
  const tile = findFoodSpot(state.map, rng, nests, existing);
  if (!tile) return;
  const kind = randomFoodKind(rng);
  const [min, max] = FOOD_AMOUNTS[kind];
  const amount = rng.int(min, max);
  state.food.push({ id: state.nextId++, kind, x: tileCenter(tile.x), y: tileCenter(tile.y), amount, max: amount });
}
