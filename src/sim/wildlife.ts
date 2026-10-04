import { TILE_SIZE } from '../config';
import { Ant } from './ants';
import { Point, isWalkable, isWalkableWorld, tileCenter } from './map';
import { hasLineOfSight } from './pathfinding';
import { Rng } from './rng';
import { GameState, getColony } from './state';

export type CreatureKind = 'spider';

export interface CreatureStats {
  speed: number;
  maxHp: number;
  radius: number;
  damage: number;
  attackCooldown: number;
  /** Tiles within which it pounces on ants. */
  aggroRange: number;
  /** Tiles it will roam or chase from its lair before turning back. */
  leash: number;
  /** Food left behind as a carcass when killed. */
  carcassFood: number;
}

export const CREATURE_STATS: Record<CreatureKind, CreatureStats> = {
  spider: {
    speed: 56,
    maxHp: 120,
    radius: 13,
    damage: 5,
    attackCooldown: 20,
    aggroRange: 5,
    leash: 12,
    carcassFood: 120,
  },
};

/** Wild animal that preys on ants of any colony. */
export interface Creature {
  id: number;
  kind: CreatureKind;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  angle: number;
  hp: number;
  path: Point[];
  moveTarget: Point | null;
  blockedWall: number | null;
  cooldown: number;
  lastAttackTick: number;
  /** Home spot it wanders around and returns to. */
  lair: Point;
  /** Ant it is hunting. */
  prey: number | null;
  /** Last ant that bit it, so it can turn on its attacker. */
  lastAttacker: number | null;
  /** Ticks until it picks a new wandering spot. */
  restTimer: number;
}

const FIRST_SPAWN_TICK = 20 * 60 * 3;
const SPAWN_INTERVAL = 20 * 90;
/** Spawn far from nests so a colony is never ambushed at its doorstep. */
const SPAWN_NEST_DISTANCE = 25;
const REPATH_TICKS = 10;
const SEEK_INTERVAL = 5;

/** Up to 2 spiders early on, one more every 10 minutes, at most 4. */
export function maxCreatures(tick: number): number {
  return Math.min(4, 2 + Math.floor(tick / (20 * 60 * 10)));
}

export function updateWildlife(state: GameState, rng: Rng): void {
  if (!state.rules.wildlife) return;
  if (state.tick >= FIRST_SPAWN_TICK && state.tick % SPAWN_INTERVAL === 0) maybeSpawn(state, rng);
  const ants = new Map(state.ants.map((a) => [a.id, a]));
  for (const c of state.creatures) {
    if (c.cooldown > 0) c.cooldown--;
    think(state, c, ants, rng);
  }
}

function maybeSpawn(state: GameState, rng: Rng): void {
  if (state.creatures.length >= maxCreatures(state.tick)) return;
  const { map } = state;
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = rng.int(2, map.width - 3);
    const y = rng.int(2, map.height - 3);
    if (!isWalkable(map, x, y)) continue;
    if (state.colonies.some((c) => Math.hypot(c.nest.x - x, c.nest.y - y) < SPAWN_NEST_DISTANCE)) continue;
    const pos = { x: tileCenter(x), y: tileCenter(y) };
    state.creatures.push({
      id: state.nextId++,
      kind: 'spider',
      ...pos,
      prevX: pos.x,
      prevY: pos.y,
      angle: rng.next() * Math.PI * 2,
      hp: CREATURE_STATS.spider.maxHp,
      path: [],
      moveTarget: null,
      blockedWall: null,
      cooldown: 0,
      lastAttackTick: -1,
      lair: pos,
      prey: null,
      lastAttacker: null,
      restTimer: 0,
    });
    return;
  }
}

function think(state: GameState, c: Creature, ants: Map<number, Ant>, rng: Rng): void {
  const stats = CREATURE_STATS[c.kind];
  const leash = stats.leash * TILE_SIZE;

  // Pick prey: whoever bit it, else the nearest ant in range of its lair's territory.
  if ((state.tick + c.id) % SEEK_INTERVAL === 0) {
    const attacker = c.lastAttacker !== null ? ants.get(c.lastAttacker) : undefined;
    c.lastAttacker = null;
    if (attacker && attacker.hp > 0 && dist(attacker, c.lair) <= leash) {
      c.prey = attacker.id;
    } else if (c.prey === null) {
      c.prey = nearestAnt(state, c, stats.aggroRange * TILE_SIZE)?.id ?? null;
    }
  }

  const prey = c.prey !== null ? ants.get(c.prey) : undefined;
  if (prey && prey.hp > 0 && dist(prey, c.lair) <= leash) {
    hunt(state, c, prey);
    return;
  }
  if (c.prey !== null) {
    // Lost it (dead or out of range): head home.
    c.prey = null;
    c.path = [];
    c.moveTarget = { ...c.lair };
  }
  wander(state, c, rng);
}

function hunt(state: GameState, c: Creature, prey: Ant): void {
  const stats = CREATURE_STATS[c.kind];
  const reach = stats.radius + 10;
  const d = dist(c, prey);
  if (d <= reach) {
    c.path = [];
    c.moveTarget = null;
    c.angle = Math.atan2(prey.y - c.y, prey.x - c.x);
    if (c.cooldown <= 0) {
      c.cooldown = stats.attackCooldown;
      c.lastAttackTick = state.tick;
      prey.hp -= stats.damage;
      prey.lastAttacker = { creature: c.id };
      getColony(state, prey.colony).lastAntHitTick = state.tick;
    }
    return;
  }
  if (c.path.length === 0 || state.tick % REPATH_TICKS === c.id % REPATH_TICKS) {
    if (d < 4 * TILE_SIZE && hasLineOfSight(state.map, c, prey, stats.radius)) {
      c.path = [{ x: prey.x, y: prey.y }];
      c.moveTarget = null;
    } else {
      c.moveTarget = { x: prey.x, y: prey.y };
    }
  }
}

function wander(state: GameState, c: Creature, rng: Rng): void {
  if (c.path.length > 0 || c.moveTarget) return;
  if (c.restTimer > 0) {
    c.restTimer--;
    return;
  }
  c.restTimer = rng.int(40, 120);
  const range = CREATURE_STATS[c.kind].leash * 0.6 * TILE_SIZE;
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * range;
    const p = { x: c.lair.x + Math.cos(a) * r, y: c.lair.y + Math.sin(a) * r };
    if (isWalkableWorld(state.map, p.x, p.y)) {
      c.moveTarget = p;
      return;
    }
  }
}

function nearestAnt(state: GameState, c: Creature, range: number): Ant | null {
  let best: Ant | null = null;
  let bestDist = range;
  for (const a of state.ants) {
    const d = dist(a, c);
    if (d < bestDist && a.hp > 0) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
