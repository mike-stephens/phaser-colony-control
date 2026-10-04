import { TILE_SIZE } from '../config';
import { ANT_STATS, Ant, AttackTarget, Task, isMoving } from './ants';
import { ANT_COST } from './economy';
import { isVisibleTo } from './fog';
import { Point, isWalkableWorld, worldToTile } from './map';
import { hasLineOfSight } from './pathfinding';
import { ColonyId, GameState, NEST_MAX_HP, NEST_RADIUS, findNest, getColony, nestCenter } from './state';
import { Owner, blocks } from './walls';
import { CREATURE_STATS, Creature } from './wildlife';

type AttackTask = Extract<Task, { kind: 'attack' }>;

/** Ants look for fights every this many ticks (staggered by id) rather than every tick. */
const SEEK_INTERVAL = 5;
/** Self-started fights are abandoned past this distance (px) from where they began. */
const LEASH_DIST = 8 * TILE_SIZE;
/** Bitten idle ants fight back against attackers within this distance (px). */
const RETALIATE_DIST = 4 * TILE_SIZE;
/**
 * When picking a fight on their own, ants treat workers as this much (px)
 * farther away than they are, so real threats (soldiers, queens, spiders)
 * come first.
 */
const WORKER_TARGET_PENALTY = 4 * TILE_SIZE;
/** Raiders still turn on enemy fighters (not workers) that come this close (px). */
const RAID_THREAT_RANGE = 2.5 * TILE_SIZE;
/** A self-started chase of a faster ant is dropped once it gets this far (px) out of reach. */
const OUTRUN_GAP = 3 * TILE_SIZE;
/** Ticks between chase re-paths. */
const REPATH_TICKS = 10;
/** Nests start regenerating this many ticks after the last bite... */
const NEST_REGEN_DELAY = 200;
/** ...at this many HP per tick. */
const NEST_REGEN_PER_TICK = 0.1;

interface Lookup {
  ants: Map<number, Ant>;
  creatures: Map<number, Creature>;
}

export function updateCombat(state: GameState): void {
  const lookup: Lookup = {
    ants: new Map(state.ants.map((a) => [a.id, a])),
    creatures: new Map(state.creatures.map((c) => [c.id, c])),
  };
  for (const ant of state.ants) if (ant.cooldown > 0) ant.cooldown--;

  for (const ant of state.ants) seekFight(state, ant, lookup);
  for (const ant of state.ants) {
    if (ant.task.kind === 'attack') runAttack(state, ant, ant.task, lookup);
  }
  chewWalls(state);

  removeDead(state);
  // Check for fallen nests before regenerating, so a nest at 0 HP can't heal back.
  checkElimination(state);
  regenerateNests(state);
}

/** Starts an attack on an ant, creature or nest. Used by commands and by the AI. */
export function startAttack(ant: Ant, target: AttackTarget, then: Task | null, leash: Point | null): void {
  ant.task = { kind: 'attack', target, then, leash, repathTick: 0 };
  ant.path = [];
  ant.moveTarget = null;
}

// ---------------------------------------------------------------- target selection

/**
 * Idle soldiers (and explorers and attack-movers) attack the nearest visible
 * threat in aggro range, preferring fighters over workers, and with nothing
 * else around, an enemy nest. Raiders sent at a nest stay on it, ignoring
 * workers, but fight enemy soldiers that close in or anything that bites
 * them, then go back to the nest. Idle ants of any
 * type fight back when bitten. Gatherers and builders keep working, and a
 * plain move order is never interrupted, so the player can always retreat.
 */
function seekFight(state: GameState, ant: Ant, lookup: Lookup): void {
  const task = ant.task;
  const raiding = task.kind === 'attack' && 'nest' in task.target;
  const canSeek =
    (task.kind === 'idle' && !isMoving(ant)) || task.kind === 'explore' || task.kind === 'attackMove' || raiding;
  if (!canSeek) {
    ant.lastAttacker = null;
    return;
  }
  if ((state.tick + ant.id) % SEEK_INTERVAL !== 0) return;

  let target: AttackTarget | null = null;
  if (ant.lastAttacker !== null) {
    const pos = targetPosition(state, ant.lastAttacker, lookup);
    if (pos && dist(ant, pos) <= RETALIATE_DIST) target = ant.lastAttacker;
    ant.lastAttacker = null;
  }
  const aggro = ANT_STATS[ant.type].aggroRange * TILE_SIZE;
  if (!target && raiding) {
    // Stay on the nest, but don't stand there while enemy soldiers chew on the squad.
    target = nearestVisibleEnemy(state, ant, RAID_THREAT_RANGE, { fightersOnly: true });
  } else if (!target && aggro > 0) {
    target = nearestVisibleEnemy(state, ant, aggro);
    // With no ants or creatures to fight, idle guards and attack-movers go for
    // an enemy nest in range (like attack-move hitting buildings in StarCraft).
    if (!target && (task.kind === 'idle' || task.kind === 'attackMove')) target = nearestKnownEnemyNest(state, ant, aggro);
  }
  if (target) startAttack(ant, target, task, { x: ant.x, y: ant.y });
}

function nearestKnownEnemyNest(state: GameState, ant: Ant, range: number): AttackTarget | null {
  let best: AttackTarget | null = null;
  let bestDist = range + NEST_RADIUS;
  for (const colony of state.colonies) {
    if (colony.id === ant.colony) continue;
    for (const nest of colony.nests) {
      const d = dist(ant, nestCenter(nest));
      if (d < bestDist && isVisibleTo(state, ant.colony, nest.tile.x, nest.tile.y)) {
        best = { nest: nest.id };
        bestDist = d;
      }
    }
  }
  return best;
}

/**
 * The visible enemy ant or wild creature in range that most needs fighting:
 * nearest first, but with workers ranked as if farther away.
 */
export function nearestVisibleEnemy(
  state: GameState,
  ant: Ant,
  range: number,
  opts: { fightersOnly?: boolean } = {},
): AttackTarget | null {
  let best: AttackTarget | null = null;
  let bestScore = Infinity;
  const consider = (p: Point, target: AttackTarget, penalty: number) => {
    const d = dist(ant, p);
    if (d > range || d + penalty >= bestScore) return;
    if (!isVisibleTo(state, ant.colony, worldToTile(p.x), worldToTile(p.y))) return;
    best = target;
    bestScore = d + penalty;
  };
  for (const other of state.ants) {
    if (other.colony !== ant.colony && other.hp > 0 && !(opts.fightersOnly && other.type === 'worker')) {
      consider(other, { ant: other.id }, other.type === 'worker' ? WORKER_TARGET_PENALTY : 0);
    }
  }
  for (const c of state.creatures) if (c.hp > 0) consider(c, { creature: c.id }, 0);
  return best;
}

/** Where a target is, or null if it is gone. */
function targetPosition(state: GameState, target: AttackTarget, lookup: Lookup): Point | null {
  if ('ant' in target) {
    const a = lookup.ants.get(target.ant);
    return a && a.hp > 0 ? a : null;
  }
  if ('creature' in target) {
    const c = lookup.creatures.get(target.creature);
    return c && c.hp > 0 ? c : null;
  }
  const found = findNest(state, target.nest);
  return found ? nestCenter(found.nest) : null;
}

function targetRadius(target: AttackTarget, lookup: Lookup): number {
  if ('ant' in target) return ANT_STATS[lookup.ants.get(target.ant)!.type].radius;
  if ('creature' in target) return CREATURE_STATS[lookup.creatures.get(target.creature)!.kind].radius;
  return NEST_RADIUS;
}

// ---------------------------------------------------------------- fighting

function runAttack(state: GameState, ant: Ant, task: AttackTask, lookup: Lookup): void {
  const stats = ANT_STATS[ant.type];
  const pos = targetPosition(state, task.target, lookup);
  // Lose track of moving targets that slip into the fog.
  const lost =
    !pos || (!('nest' in task.target) && !isVisibleTo(state, ant.colony, worldToTile(pos.x), worldToTile(pos.y)));
  if (lost) return endAttack(ant, task);

  if (task.leash && dist(ant, task.leash) > LEASH_DIST) {
    const home = task.leash;
    endAttack(ant, task);
    ant.moveTarget = home;
    return;
  }

  const reach = stats.radius + targetRadius(task.target, lookup) + 4;
  const d = dist(ant, pos);

  // Don't run after something faster that we only picked on ourselves.
  if (task.leash && 'ant' in task.target && d > reach + OUTRUN_GAP) {
    const prey = lookup.ants.get(task.target.ant)!;
    if (ANT_STATS[prey.type].speed > stats.speed) {
      const home = task.leash;
      endAttack(ant, task);
      if (ant.task.kind === 'idle') ant.moveTarget = home;
      return;
    }
  }

  // Nests are big: each attacker gets its own spot around the mound so a squad
  // surrounds it instead of queueing up on one side. It bites once it reaches
  // its spot, or as soon as it's within reach and can't get any closer.
  const slot = 'nest' in task.target ? nestSlot(state, ant, pos, reach) : null;
  const inRange = slot ? dist(ant, slot) <= 10 || (d <= reach && !isMoving(ant)) : d <= reach;
  if (inRange) {
    ant.path = [];
    ant.moveTarget = null;
    ant.blockedWall = null;
    ant.angle = Math.atan2(pos.y - ant.y, pos.x - ant.x);
    if (ant.cooldown <= 0) bite(state, ant, task.target, lookup);
    return;
  }

  // Nests don't move, so only re-plan those when stopped; moving targets get
  // a fresh path every few ticks, staggered by id so a big group doesn't all
  // re-plan on the same tick.
  const chasingMover = !('nest' in task.target);
  if (!isMoving(ant) || (chasingMover && state.tick >= task.repathTick)) {
    task.repathTick = state.tick + REPATH_TICKS + (ant.id % REPATH_TICKS);
    const goal = slot ?? { x: pos.x, y: pos.y };
    // Close and in the open: walk straight at it instead of running A*.
    const wallBlocked = (px: number, py: number) => blocks(state, ant.colony, tileIndex(state, px, py));
    if (d < 4 * TILE_SIZE && hasLineOfSight(state.map, ant, goal, stats.radius, wallBlocked)) {
      ant.path = [goal];
      ant.moveTarget = null;
    } else {
      ant.moveTarget = goal;
    }
  }
}

/** This ant's spot on a ring just inside biting reach of a nest (falls back to the centre). */
function nestSlot(state: GameState, ant: Ant, center: Point, reach: number): Point {
  const angle = ant.id * 2.39996;
  const r = reach - 3;
  const p = { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
  return isWalkableWorld(state.map, p.x, p.y) ? p : center;
}

function bite(state: GameState, ant: Ant, target: AttackTarget, lookup: Lookup): void {
  const stats = ANT_STATS[ant.type];
  ant.cooldown = stats.attackCooldown;
  ant.lastAttackTick = state.tick;
  const attackerColony = getColony(state, ant.colony);

  if ('ant' in target) {
    const enemy = lookup.ants.get(target.ant)!;
    const wasAlive = enemy.hp > 0;
    enemy.hp -= stats.damage;
    enemy.lastAttacker = { ant: ant.id };
    getColony(state, enemy.colony).lastAntHitTick = state.tick;
    if (wasAlive && enemy.hp <= 0) attackerColony.stats.kills++;
  } else if ('creature' in target) {
    const c = lookup.creatures.get(target.creature)!;
    const wasAlive = c.hp > 0;
    c.hp -= stats.damage;
    c.lastAttacker = ant.id;
    if (wasAlive && c.hp <= 0) attackerColony.stats.kills++;
  } else {
    const found = findNest(state, target.nest);
    if (!found) return;
    found.nest.hp = Math.max(0, found.nest.hp - stats.damage);
    found.nest.lastHitTick = state.tick;
  }
}

function endAttack(ant: Ant, task: AttackTask): void {
  ant.task = task.then ?? { kind: 'idle' };
  ant.path = [];
  ant.moveTarget = null;
}

/** Ants and creatures stuck against someone else's wall bite it until it crumbles. */
function chewWalls(state: GameState): void {
  const chew = (
    m: { blockedWall: number | null; cooldown: number; lastAttackTick: number },
    owner: Owner,
    damage: number,
    cooldown: number,
  ) => {
    if (m.blockedWall === null) return;
    const wall = state.walls[m.blockedWall];
    if (!wall || !blocks(state, owner, m.blockedWall)) {
      m.blockedWall = null;
      return;
    }
    if (m.cooldown > 0) return;
    m.cooldown = cooldown;
    m.lastAttackTick = state.tick;
    wall.hp -= damage;
    if (wall.hp <= 0) {
      delete state.walls[m.blockedWall];
      m.blockedWall = null;
    }
  };
  for (const a of state.ants) chew(a, a.colony, ANT_STATS[a.type].damage, ANT_STATS[a.type].attackCooldown);
  for (const c of state.creatures) {
    const s = CREATURE_STATS[c.kind];
    chew(c, 'wild', s.damage, s.attackCooldown);
  }
}

// ---------------------------------------------------------------- bookkeeping

/**
 * Removes ants and creatures killed this tick (by bites or starvation),
 * counting colony losses. Dead creatures leave a carcass to eat.
 */
export function removeDead(state: GameState): void {
  if (state.ants.some((a) => a.hp <= 0)) {
    state.ants = state.ants.filter((a) => {
      if (a.hp > 0) return true;
      getColony(state, a.colony).stats.losses++;
      return false;
    });
  }
  if (state.creatures.some((c) => c.hp <= 0)) {
    state.creatures = state.creatures.filter((c) => {
      if (c.hp > 0) return true;
      const amount = CREATURE_STATS[c.kind].carcassFood;
      if (isWalkableWorld(state.map, c.x, c.y)) {
        state.food.push({ id: state.nextId++, kind: 'carcass', x: c.x, y: c.y, amount, max: amount });
      }
      return false;
    });
  }
}

function regenerateNests(state: GameState): void {
  for (const colony of state.colonies) {
    for (const nest of colony.nests) {
      if (nest.hp <= 0 || nest.hp >= NEST_MAX_HP) continue;
      if (state.tick - nest.lastHitTick < NEST_REGEN_DELAY) continue;
      nest.hp = Math.min(NEST_MAX_HP, nest.hp + NEST_REGEN_PER_TICK);
    }
  }
}

/**
 * Nests at 0 HP collapse into ruins (losing their training queue, refunded
 * nowhere). A colony is out when its last nest falls, or when it has no ants,
 * nothing hatching and can't afford a worker; its remaining ants scatter and
 * die. The last colony standing wins.
 */
function checkElimination(state: GameState): void {
  for (const colony of state.colonies) {
    if (colony.eliminated) continue;
    for (const nest of colony.nests.filter((n) => n.hp <= 0)) {
      state.ruins.push({ colony: colony.id, tile: { ...nest.tile } });
    }
    colony.nests = colony.nests.filter((n) => n.hp > 0);

    const hasAnts = state.ants.some((a) => a.colony === colony.id);
    const queued = colony.nests.some((n) => n.queue.length > 0);
    const stranded = !hasAnts && !queued && colony.food < ANT_COST.worker.food;
    if (colony.nests.length > 0 && !stranded) continue;
    eliminate(state, colony.id);
  }
  const alive = state.colonies.filter((c) => !c.eliminated);
  if (state.winner === null && alive.length === 1) state.winner = alive[0].id;
}

function eliminate(state: GameState, id: ColonyId): void {
  const colony = getColony(state, id);
  colony.eliminated = true;
  for (const nest of colony.nests) state.ruins.push({ colony: id, tile: { ...nest.tile } });
  colony.nests = [];
  for (const ant of state.ants) if (ant.colony === id) ant.hp = 0;
  removeDead(state);
}

function tileIndex(state: GameState, px: number, py: number): number {
  return worldToTile(py) * state.map.width + worldToTile(px);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
