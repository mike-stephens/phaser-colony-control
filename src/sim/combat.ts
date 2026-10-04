import { TILE_SIZE } from '../config';
import { ANT_STATS, Ant, Task, isMoving } from './ants';
import { ANT_COST } from './economy';
import { isVisibleTo } from './fog';
import { Point, worldToTile } from './map';
import { hasLineOfSight } from './pathfinding';
import { ColonyId, GameState, NEST_MAX_HP, NEST_RADIUS, getColony, nestPoint } from './state';

type AttackTask = Extract<Task, { kind: 'attack' }>;

/** Ants look for fights every this many ticks (staggered by id) rather than every tick. */
const SEEK_INTERVAL = 5;
/** Self-started fights are abandoned past this distance (px) from where they began. */
const LEASH_DIST = 8 * TILE_SIZE;
/** Bitten idle ants fight back against attackers within this distance (px). */
const RETALIATE_DIST = 4 * TILE_SIZE;
/** Ticks between chase re-paths. */
const REPATH_TICKS = 10;
/** Nests start regenerating this many ticks after the last bite... */
const NEST_REGEN_DELAY = 200;
/** ...at this many HP per tick. */
const NEST_REGEN_PER_TICK = 0.1;

export function updateCombat(state: GameState): void {
  const byId = new Map(state.ants.map((a) => [a.id, a]));
  for (const ant of state.ants) if (ant.cooldown > 0) ant.cooldown--;

  for (const ant of state.ants) seekFight(state, ant, byId);
  for (const ant of state.ants) {
    if (ant.task.kind === 'attack') runAttack(state, ant, ant.task, byId);
  }

  removeDead(state);
  // Check for fallen nests before regenerating, so a nest at 0 HP can't heal back.
  checkElimination(state);
  regenerateNests(state);
}

/** Starts an attack on an ant or nest. Used by commands and by the AI. */
export function startAttack(ant: Ant, target: AttackTask['target'], then: Task | null, leash: Point | null): void {
  ant.task = { kind: 'attack', target, then, leash, repathTick: 0 };
  ant.path = [];
  ant.moveTarget = null;
}

// ---------------------------------------------------------------- target selection

/**
 * Idle soldiers (and explorers, and raiders on the way to a nest) attack the
 * nearest visible enemy in aggro range. Idle ants of any type fight back when
 * bitten. Gatherers keep working, and a plain move order is never interrupted,
 * so the player can always retreat.
 */
function seekFight(state: GameState, ant: Ant, byId: Map<number, Ant>): void {
  const task = ant.task;
  const raiding = task.kind === 'attack' && 'nest' in task.target;
  const canSeek = (task.kind === 'idle' && !isMoving(ant)) || task.kind === 'explore' || raiding;
  if (!canSeek) {
    ant.lastAttacker = null;
    return;
  }
  if ((state.tick + ant.id) % SEEK_INTERVAL !== 0) return;

  let target: Ant | null = null;
  if (ant.lastAttacker !== null) {
    const attacker = byId.get(ant.lastAttacker);
    if (attacker && attacker.hp > 0 && dist(ant, attacker) <= RETALIATE_DIST) target = attacker;
    ant.lastAttacker = null;
  }
  const aggro = ANT_STATS[ant.type].aggroRange * TILE_SIZE;
  if (!target && aggro > 0) target = nearestVisibleEnemy(state, ant, aggro);
  if (target) startAttack(ant, { ant: target.id }, task, { x: ant.x, y: ant.y });
}

function nearestVisibleEnemy(state: GameState, ant: Ant, range: number): Ant | null {
  let best: Ant | null = null;
  let bestDist = range;
  for (const other of state.ants) {
    if (other.colony === ant.colony || other.hp <= 0) continue;
    const d = dist(ant, other);
    if (d <= bestDist && isVisibleTo(state, ant.colony, worldToTile(other.x), worldToTile(other.y))) {
      best = other;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- fighting

function runAttack(state: GameState, ant: Ant, task: AttackTask, byId: Map<number, Ant>): void {
  const stats = ANT_STATS[ant.type];
  let pos: Point | null = null;
  let reach = 0;

  if ('ant' in task.target) {
    const enemy = byId.get(task.target.ant);
    // Lose track of targets that die or slip into the fog.
    if (enemy && enemy.hp > 0 && isVisibleTo(state, ant.colony, worldToTile(enemy.x), worldToTile(enemy.y))) {
      pos = enemy;
      reach = stats.radius + ANT_STATS[enemy.type].radius + 4;
    }
  } else {
    const colony = getColony(state, task.target.nest);
    if (!colony.eliminated) {
      pos = nestPoint(state, colony.id);
      reach = stats.radius + NEST_RADIUS + 4;
    }
  }

  if (!pos) return endAttack(ant, task);
  if (task.leash && dist(ant, task.leash) > LEASH_DIST) {
    const home = task.leash;
    endAttack(ant, task);
    ant.moveTarget = home;
    return;
  }

  const d = dist(ant, pos);
  if (d <= reach) {
    ant.path = [];
    ant.moveTarget = null;
    ant.angle = Math.atan2(pos.y - ant.y, pos.x - ant.x);
    if (ant.cooldown <= 0) bite(state, ant, task, byId);
    return;
  }

  if (!isMoving(ant) || state.tick >= task.repathTick) {
    task.repathTick = state.tick + REPATH_TICKS;
    // Close and in the open: walk straight at it instead of running A*.
    if (d < 4 * TILE_SIZE && hasLineOfSight(state.map, ant, pos, stats.radius)) {
      ant.path = [{ x: pos.x, y: pos.y }];
      ant.moveTarget = null;
    } else {
      ant.moveTarget = { x: pos.x, y: pos.y };
    }
  }
}

function bite(state: GameState, ant: Ant, task: AttackTask, byId: Map<number, Ant>): void {
  const stats = ANT_STATS[ant.type];
  ant.cooldown = stats.attackCooldown;
  ant.lastAttackTick = state.tick;
  const attackerColony = getColony(state, ant.colony);

  if ('ant' in task.target) {
    const enemy = byId.get(task.target.ant)!;
    const wasAlive = enemy.hp > 0;
    enemy.hp -= stats.damage;
    enemy.lastAttacker = ant.id;
    getColony(state, enemy.colony).lastAntHitTick = state.tick;
    if (wasAlive && enemy.hp <= 0) attackerColony.stats.kills++;
  } else {
    const colony = getColony(state, task.target.nest);
    colony.nestHp = Math.max(0, colony.nestHp - stats.damage);
    colony.lastNestHitTick = state.tick;
  }
}

function endAttack(ant: Ant, task: AttackTask): void {
  ant.task = task.then ?? { kind: 'idle' };
  ant.path = [];
  ant.moveTarget = null;
}

// ---------------------------------------------------------------- bookkeeping

/** Removes ants killed this tick (by bites or starvation) and counts the losses. */
export function removeDead(state: GameState): void {
  if (!state.ants.some((a) => a.hp <= 0)) return;
  state.ants = state.ants.filter((a) => {
    if (a.hp > 0) return true;
    getColony(state, a.colony).stats.losses++;
    return false;
  });
}

function regenerateNests(state: GameState): void {
  for (const colony of state.colonies) {
    if (colony.eliminated || colony.nestHp <= 0 || colony.nestHp >= NEST_MAX_HP) continue;
    if (state.tick - colony.lastNestHitTick < NEST_REGEN_DELAY) continue;
    colony.nestHp = Math.min(NEST_MAX_HP, colony.nestHp + NEST_REGEN_PER_TICK);
  }
}

/**
 * A colony is out when its nest falls, or when it has no ants, nothing
 * hatching and can't afford a worker. Its remaining ants scatter and die.
 * The last colony standing wins.
 */
function checkElimination(state: GameState): void {
  for (const colony of state.colonies) {
    if (colony.eliminated) continue;
    const hasAnts = state.ants.some((a) => a.colony === colony.id);
    const stranded = !hasAnts && colony.queue.length === 0 && colony.food < ANT_COST.worker.food;
    if (colony.nestHp > 0 && !stranded) continue;
    eliminate(state, colony.id);
  }
  const alive = state.colonies.filter((c) => !c.eliminated);
  if (state.winner === null && alive.length === 1) state.winner = alive[0].id;
}

function eliminate(state: GameState, id: ColonyId): void {
  const colony = getColony(state, id);
  colony.eliminated = true;
  colony.queue = [];
  colony.nestHp = 0;
  for (const ant of state.ants) if (ant.colony === id) ant.hp = 0;
  removeDead(state);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
