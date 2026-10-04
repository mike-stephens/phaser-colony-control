import type { Point } from './map';
import type { ColonyId } from './state';

export type AntType = 'worker' | 'soldier' | 'queen';

export interface AntStats {
  /** World pixels per second. */
  speed: number;
  maxHp: number;
  /** Body radius in world pixels, used for selection, reach and path clearance. */
  radius: number;
  /** Vision radius in tiles. */
  sight: number;
  /** Damage per bite. */
  damage: number;
  /** Ticks between bites. */
  attackCooldown: number;
  /** Tiles within which an idle ant attacks enemies on its own; 0 = only when ordered or bitten. */
  aggroRange: number;
}

export const ANT_STATS: Record<AntType, AntStats> = {
  worker: { speed: 64, maxHp: 10, radius: 6, sight: 4, damage: 1, attackCooldown: 20, aggroRange: 0 },
  soldier: { speed: 58, maxHp: 25, radius: 8, sight: 4, damage: 4, attackCooldown: 20, aggroRange: 5 },
  queen: { speed: 36, maxHp: 40, radius: 10, sight: 3, damage: 3, attackCooldown: 20, aggroRange: 0 },
};

/** `nest` is a nest id (colonies can have several nests). */
export type AttackTarget = { ant: number } | { nest: number } | { creature: number };

/**
 * What an ant is doing beyond its current path. A plain move order leaves the
 * ant 'idle' with a path; the other tasks re-plan on their own (tasks.ts,
 * combat.ts).
 */
export type Task =
  | { kind: 'idle' }
  | { kind: 'explore'; center: Point; radius: number }
  | {
      kind: 'gather';
      foodId: number;
      phase: 'toFood' | 'harvesting' | 'toNest';
      /** Ticks left in the harvesting phase. */
      timer: number;
      /** Re-path attempts in the current phase; gives up after a few. */
      retries: number;
      /** Where the last food came from, to find a replacement when it runs out. */
      lastFoodPos: Point;
    }
  | {
      /** Walking to a spot but fighting anything met on the way (attack-move). */
      kind: 'attackMove';
      target: Point;
      retries: number;
    }
  | {
      /** A queen walking to a site to found a new nest there. */
      kind: 'found';
      target: Point;
      retries: number;
    }
  | {
      kind: 'build';
      phase: 'toPile' | 'collecting' | 'toSite';
      /** Ticks left picking up a pebble. */
      timer: number;
      retries: number;
    }
  | {
      kind: 'attack';
      target: AttackTarget;
      /** Task to resume once the target is gone (e.g. the raid this fight interrupted). */
      then: Task | null;
      /** For self-started fights: give up if dragged this far from here. Null for direct orders. */
      leash: Point | null;
      /** Tick at which the chase path may be recomputed. */
      repathTick: number;
    };

export interface Ant {
  id: number;
  colony: ColonyId;
  type: AntType;
  x: number;
  y: number;
  /** Position at the start of the current tick, for render interpolation. */
  prevX: number;
  prevY: number;
  /** Heading in radians; 0 faces +x. */
  angle: number;
  hp: number;
  task: Task;
  /** Food units being carried back to the nest. */
  carrying: number;
  /** Remaining world-space waypoints to walk, nearest first. */
  path: Point[];
  /** Destination waiting for a path to be computed (see stepSimulation). */
  moveTarget: Point | null;
  /** Ticks until this ant can bite again. */
  cooldown: number;
  /** Tick of this ant's most recent bite (for the lunge animation); -1 = never. */
  lastAttackTick: number;
  /** The last ant or creature that bit this one, until it reacts. */
  lastAttacker: AttackTarget | null;
  /** Carrying a pebble to a wall plan. */
  pebble: boolean;
  /** Tile index of an enemy wall this ant has walked into and is chewing through. */
  blockedWall: number | null;
}

export function createAnt(id: number, colony: ColonyId, type: AntType, pos: Point): Ant {
  return {
    id,
    colony,
    type,
    x: pos.x,
    y: pos.y,
    prevX: pos.x,
    prevY: pos.y,
    angle: 0,
    hp: ANT_STATS[type].maxHp,
    task: { kind: 'idle' },
    carrying: 0,
    path: [],
    moveTarget: null,
    cooldown: 0,
    lastAttackTick: -1,
    lastAttacker: null,
    pebble: false,
    blockedWall: null,
  };
}

export function isMoving(ant: Ant): boolean {
  return ant.path.length > 0 || ant.moveTarget !== null;
}
