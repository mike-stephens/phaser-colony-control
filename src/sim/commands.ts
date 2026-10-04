import { Ant, AntType, AttackTarget, isMoving } from './ants';
import { startAttack } from './combat';
import { ANT_COST, trainBlocker } from './economy';
import { isExploredBy, isVisibleTo } from './fog';
import { formationSlots } from './formation';
import { Point, TilePos, worldToTile } from './map';
import { regionAt } from './regions';
import { ColonyId, GameState, getColony, nestPoint } from './state';
import { EXPLORE_RADIUS, startBuilding, startGathering } from './tasks';
import { wallPlanBlocker } from './walls';

/**
 * Orders that a colony can give its ants. The player's input and the AI
 * opponent both go through issueCommand, so neither has special powers.
 */
export type Command =
  | { type: 'move'; antIds: number[]; target: Point }
  | { type: 'explore'; antIds: number[]; target: Point }
  | { type: 'gather'; antIds: number[]; foodId: number }
  /** Adjusts how many of the colony's workers gather from one food source. */
  | { type: 'setGatherers'; foodId: number; count: number }
  /** Queues an ant at the nest, paying its food cost now. */
  | { type: 'train'; antType: AntType }
  /** Removes queue[index] and refunds it (cancelling index 0 loses its progress). */
  | { type: 'cancelTraining'; index: number }
  /** Where newly hatched ants gather; null resets to the nest. */
  | { type: 'setRally'; target: Point | null }
  /** Attack a visible enemy ant or creature, or raid an enemy nest you have found. */
  | { type: 'attack'; antIds: number[]; target: AttackTarget }
  /** Mark tiles for wall building. Tiles that can't take a wall are skipped. */
  | { type: 'planWalls'; tiles: TilePos[] }
  /** Remove wall plans or knock down your own built walls. */
  | { type: 'removeWalls'; tiles: TilePos[] }
  /** Adjusts how many of the colony's workers build walls. */
  | { type: 'setBuilders'; count: number };

export function issueCommand(state: GameState, colony: ColonyId, command: Command): void {
  switch (command.type) {
    case 'move':
      issueMove(state, ownAnts(state, colony, command.antIds), command.target);
      break;
    case 'explore':
      issueExplore(state, ownAnts(state, colony, command.antIds), command.target);
      break;
    case 'gather':
      issueGather(state, colony, ownAnts(state, colony, command.antIds), command.foodId);
      break;
    case 'setGatherers':
      setGatherers(state, colony, command.foodId, command.count);
      break;
    case 'train': {
      const c = getColony(state, colony);
      if (trainBlocker(state, c, command.antType) !== null) break;
      c.food -= ANT_COST[command.antType].food;
      c.queue.push(command.antType);
      break;
    }
    case 'cancelTraining': {
      const c = getColony(state, colony);
      const type = c.queue[command.index];
      if (!type) break;
      c.queue.splice(command.index, 1);
      c.food += ANT_COST[type].food;
      if (command.index === 0) c.progress = 0;
      break;
    }
    case 'setRally':
      getColony(state, colony).rally = command.target ? { ...command.target } : null;
      break;
    case 'attack':
      if (!canTarget(state, colony, command.target)) break;
      for (const ant of ownAnts(state, colony, command.antIds)) startAttack(ant, command.target, null, null);
      break;
    case 'planWalls':
      for (const t of command.tiles) {
        if (wallPlanBlocker(state, colony, t.x, t.y) !== null) continue;
        const tile = t.y * state.map.width + t.x;
        state.walls[tile] = { tile, owner: colony, built: false, pebbles: 0, hp: 0 };
      }
      break;
    case 'removeWalls':
      for (const t of command.tiles) {
        const tile = t.y * state.map.width + t.x;
        if (state.walls[tile]?.owner === colony) delete state.walls[tile];
      }
      break;
    case 'setBuilders':
      setBuilders(state, colony, command.count);
      break;
  }
}

/** Workers of `colony` currently assigned to wall building. */
export function buildersOf(state: GameState, colony: ColonyId): Ant[] {
  return state.ants.filter((a) => a.colony === colony && a.task.kind === 'build');
}

/** Same selection rules as setGatherers: idle workers first, then the least busy. */
function setBuilders(state: GameState, colony: ColonyId, count: number): void {
  const current = buildersOf(state, colony);
  if (count > current.length) {
    const nest = nestPoint(state, colony);
    const availability = (a: Ant) =>
      a.task.kind === 'idle' ? (isMoving(a) ? 1 : 0) : a.task.kind === 'explore' ? 2 : 3;
    const candidates = state.ants
      .filter((a) => a.colony === colony && a.type === 'worker' && a.task.kind !== 'build')
      .sort((a, b) => availability(a) - availability(b) || dist2(a, nest) - dist2(b, nest) || a.id - b.id);
    for (const ant of candidates.slice(0, count - current.length)) startBuilding(ant);
  } else if (count < current.length) {
    const release = [...current].sort((a, b) => Number(a.pebble) - Number(b.pebble) || a.id - b.id);
    for (const ant of release.slice(0, current.length - Math.max(count, 0))) {
      ant.task = { kind: 'idle' };
      ant.pebble = false;
      ant.path = [];
      ant.moveTarget = null;
    }
  }
}

/** Fog-of-war check: only visible enemies/creatures and discovered enemy nests can be targeted. */
function canTarget(state: GameState, colony: ColonyId, target: AttackTarget): boolean {
  if ('ant' in target) {
    const enemy = state.ants.find((a) => a.id === target.ant);
    return !!enemy && enemy.colony !== colony && isVisibleTo(state, colony, worldToTile(enemy.x), worldToTile(enemy.y));
  }
  if ('creature' in target) {
    const c = state.creatures.find((x) => x.id === target.creature);
    return !!c && isVisibleTo(state, colony, worldToTile(c.x), worldToTile(c.y));
  }
  const enemy = getColony(state, target.nest);
  return target.nest !== colony && !enemy.eliminated && isExploredBy(state, colony, enemy.nest.x, enemy.nest.y);
}

/** Workers of `colony` currently assigned to the given food source. */
export function gatherersOf(state: GameState, colony: ColonyId, foodId: number): Ant[] {
  return state.ants.filter(
    (a) => a.colony === colony && a.task.kind === 'gather' && a.task.foodId === foodId,
  );
}

function ownAnts(state: GameState, colony: ColonyId, antIds: number[]): Ant[] {
  const ids = new Set(antIds);
  return state.ants.filter((a) => ids.has(a.id) && a.colony === colony);
}

function issueMove(state: GameState, ants: Ant[], target: Point): void {
  // Ants on different islands can't share a formation; group them by region.
  const byRegion = new Map<number, Ant[]>();
  for (const ant of ants) {
    ant.task = { kind: 'idle' };
    const region = regionAt(state.map, worldToTile(ant.x), worldToTile(ant.y));
    if (region < 0) continue;
    const group = byRegion.get(region) ?? [];
    group.push(ant);
    byRegion.set(region, group);
  }

  for (const [region, group] of byRegion) {
    const slots = formationSlots(state.map, target, group.length, region);
    // Closest ants take the slots nearest the target so the group stays compact.
    group.sort((a, b) => dist2(a, target) - dist2(b, target) || a.id - b.id);
    group.forEach((ant, i) => {
      const slot = slots[i];
      if (!slot) return;
      ant.moveTarget = slot;
      ant.path = [];
    });
  }
}

function issueExplore(_state: GameState, ants: Ant[], target: Point): void {
  for (const ant of ants) {
    ant.task = { kind: 'explore', center: { ...target }, radius: EXPLORE_RADIUS };
    ant.path = [];
    ant.moveTarget = null;
  }
}

function findKnownFood(state: GameState, colony: ColonyId, foodId: number) {
  const food = state.food.find((f) => f.id === foodId);
  if (!food || !isExploredBy(state, colony, worldToTile(food.x), worldToTile(food.y))) return null;
  return food;
}

function issueGather(state: GameState, colony: ColonyId, ants: Ant[], foodId: number): void {
  const food = findKnownFood(state, colony, foodId);
  if (!food) return;
  const foodRegion = regionAt(state.map, worldToTile(food.x), worldToTile(food.y));
  const workers = ants.filter(
    (a) => a.type === 'worker' && regionAt(state.map, worldToTile(a.x), worldToTile(a.y)) === foodRegion,
  );
  for (const w of workers) startGathering(w, food);
  // Anything that can't carry food (soldiers, queens) escorts the workers instead.
  const others = ants.filter((a) => !workers.includes(a));
  if (others.length > 0) issueMove(state, others, { x: food.x, y: food.y });
}

/**
 * Picks the most available workers to reach `count` gatherers: idle ants
 * first, then explorers, then ants gathering elsewhere; nearest first within
 * each group. Lowering the count sends the extra ants home.
 */
function setGatherers(state: GameState, colony: ColonyId, foodId: number, count: number): void {
  const food = findKnownFood(state, colony, foodId);
  if (!food) return;
  const current = gatherersOf(state, colony, foodId);

  if (count > current.length) {
    const foodRegion = regionAt(state.map, worldToTile(food.x), worldToTile(food.y));
    const availability = (a: Ant) =>
      a.task.kind === 'idle' ? (isMoving(a) ? 1 : 0) : a.task.kind === 'explore' ? 2 : 3;
    const candidates = state.ants
      .filter(
        (a) =>
          a.colony === colony &&
          a.type === 'worker' &&
          !current.includes(a) &&
          regionAt(state.map, worldToTile(a.x), worldToTile(a.y)) === foodRegion,
      )
      .sort((a, b) => availability(a) - availability(b) || dist2(a, food) - dist2(b, food) || a.id - b.id);
    for (const ant of candidates.slice(0, count - current.length)) startGathering(ant, food);
  } else if (count < current.length) {
    // Release ants that are empty-handed and furthest away first.
    const release = [...current]
      .sort((a, b) => a.carrying - b.carrying || dist2(b, food) - dist2(a, food) || a.id - b.id)
      .slice(0, current.length - Math.max(count, 0));
    for (const ant of release) {
      ant.task = { kind: 'idle' };
      ant.path = [];
      ant.moveTarget = nestPoint(state, colony);
    }
  }
}

function dist2(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
