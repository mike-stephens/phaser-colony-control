import { Ant, Task, isMoving } from './ants';
import { isExploredBy } from './fog';
import { CARRY_CAPACITY, Food, HARVEST_TICKS } from './food';
import { Point, isWalkable, isWalkableWorld, tileCenter, worldToTile } from './map';
import { regionAt } from './regions';
import { Rng } from './rng';
import { GameState, nestPoint } from './state';

type GatherTask = Extract<Task, { kind: 'gather' }>;
type ExploreTask = Extract<Task, { kind: 'explore' }>;

/** How close (px) an ant must get to its food/nest target to count as arrived. */
const ARRIVE_DIST = 14;
/** Ants within this distance (px) of their nest drop off whatever they carry. */
const DEPOSIT_DIST = 28;
/** Area (tiles) an explore order covers around the clicked point. */
export const EXPLORE_RADIUS = 8;
/** How far (tiles) a gatherer looks for a new source when its food runs out. */
const REPLACEMENT_SEARCH = 12;
const MAX_RETRIES = 3;

/** Advances every ant's task by one tick. May set ant.moveTarget. */
export function updateTasks(state: GameState, rng: Rng): void {
  for (const ant of state.ants) {
    if (ant.carrying > 0 && !isMoving(ant) && dist(ant, nestPoint(state, ant.colony)) <= DEPOSIT_DIST) {
      state.colonies.find((c) => c.id === ant.colony)!.food += ant.carrying;
      ant.carrying = 0;
    }
    const task = ant.task;
    if (task.kind === 'gather') updateGather(state, ant, task, rng);
    else if (task.kind === 'explore') updateExplore(state, ant, task, rng);
  }
}

// ---------------------------------------------------------------- gathering

export function startGathering(ant: Ant, food: Food): void {
  ant.task = {
    kind: 'gather',
    foodId: food.id,
    phase: 'toFood',
    timer: 0,
    retries: 0,
    lastFoodPos: { x: food.x, y: food.y },
  };
  ant.path = [];
  ant.moveTarget = null;
}

function updateGather(state: GameState, ant: Ant, task: GatherTask, rng: Rng): void {
  const food = state.food.find((f) => f.id === task.foodId);

  switch (task.phase) {
    case 'toFood': {
      if (!food) return findReplacementOrStop(state, ant, task);
      if (isMoving(ant)) return;
      if (dist(ant, food) <= ARRIVE_DIST) {
        task.phase = 'harvesting';
        task.timer = HARVEST_TICKS;
        task.retries = 0;
        return;
      }
      retryMove(ant, task, jitter(state, food, rng));
      return;
    }

    case 'harvesting': {
      if (!food) {
        if (ant.carrying > 0) return headHome(state, ant, task, rng);
        return findReplacementOrStop(state, ant, task);
      }
      if (--task.timer > 0) return;
      const taken = Math.min(CARRY_CAPACITY - ant.carrying, food.amount);
      food.amount -= taken;
      ant.carrying += taken;
      task.lastFoodPos = { x: food.x, y: food.y };
      if (food.amount <= 0) state.food = state.food.filter((f) => f !== food);
      return headHome(state, ant, task, rng);
    }

    case 'toNest': {
      if (isMoving(ant)) return;
      const nest = nestPoint(state, ant.colony);
      // updateTasks deposits the load once the ant stops near the nest.
      if (dist(ant, nest) <= DEPOSIT_DIST && ant.carrying === 0) {
        task.phase = 'toFood';
        task.retries = 0;
        return;
      }
      retryMove(ant, task, jitter(state, nest, rng));
      return;
    }
  }
}

function headHome(state: GameState, ant: Ant, task: GatherTask, rng: Rng): void {
  task.phase = 'toNest';
  task.retries = 0;
  ant.moveTarget = jitter(state, nestPoint(state, ant.colony), rng);
}

function retryMove(ant: Ant, task: GatherTask, target: Point): void {
  if (task.retries++ >= MAX_RETRIES) {
    ant.task = { kind: 'idle' };
    return;
  }
  ant.moveTarget = target;
}

/** When a source is used up, move to the nearest known one close by, else stop. */
function findReplacementOrStop(state: GameState, ant: Ant, task: GatherTask): void {
  const region = regionAt(state.map, worldToTile(ant.x), worldToTile(ant.y));
  let best: Food | null = null;
  let bestDist = REPLACEMENT_SEARCH * 32;
  for (const f of state.food) {
    const d = dist(f, task.lastFoodPos);
    if (
      d < bestDist &&
      regionAt(state.map, worldToTile(f.x), worldToTile(f.y)) === region &&
      isExploredBy(state, ant.colony, worldToTile(f.x), worldToTile(f.y))
    ) {
      best = f;
      bestDist = d;
    }
  }
  if (best) {
    task.foodId = best.id;
    task.phase = 'toFood';
    task.retries = 0;
  } else {
    ant.task = { kind: 'idle' };
  }
}

// ---------------------------------------------------------------- exploring

function updateExplore(state: GameState, ant: Ant, task: ExploreTask, rng: Rng): void {
  if (isMoving(ant)) return;
  const target = pickExploreTarget(state, ant, task, rng);
  if (target) ant.moveTarget = target;
  else ant.task = { kind: 'idle' };
}

/**
 * Chooses an unexplored, reachable tile inside the explore area. Samples a few
 * random candidates and takes the closest, so a group fans out but each ant
 * still makes steady progress.
 */
function pickExploreTarget(state: GameState, ant: Ant, task: ExploreTask, rng: Rng): Point | null {
  const { map } = state;
  const region = regionAt(map, worldToTile(ant.x), worldToTile(ant.y));
  const cx = worldToTile(task.center.x);
  const cy = worldToTile(task.center.y);
  const r = task.radius;
  const candidates: Point[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (!isWalkable(map, x, y) || regionAt(map, x, y) !== region) continue;
      if (isExploredBy(state, ant.colony, x, y)) continue;
      candidates.push({ x: tileCenter(x), y: tileCenter(y) });
    }
  }
  if (candidates.length === 0) return null;

  let best = rng.pick(candidates);
  for (let i = 0; i < 5; i++) {
    const c = rng.pick(candidates);
    if (dist(c, ant) < dist(best, ant)) best = c;
  }
  return best;
}

// ---------------------------------------------------------------- helpers

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A walkable point near p, so ants don't all stand on the exact same pixel. */
function jitter(state: GameState, p: Point, rng: Rng): Point {
  for (let i = 0; i < 4; i++) {
    const q = { x: p.x + (rng.next() * 2 - 1) * 8, y: p.y + (rng.next() * 2 - 1) * 8 };
    if (isWalkableWorld(state.map, q.x, q.y)) return q;
  }
  return p;
}
