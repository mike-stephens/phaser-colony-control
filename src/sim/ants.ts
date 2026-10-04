import type { Point } from './map';
import type { ColonyId } from './state';

export type AntType = 'worker' | 'soldier' | 'queen';

export interface AntStats {
  /** World pixels per second. */
  speed: number;
  maxHp: number;
  /** Body radius in world pixels, used for selection and path clearance. */
  radius: number;
  /** Vision radius in tiles. */
  sight: number;
}

export const ANT_STATS: Record<AntType, AntStats> = {
  worker: { speed: 64, maxHp: 10, radius: 6, sight: 4 },
  soldier: { speed: 52, maxHp: 25, radius: 8, sight: 4 },
  queen: { speed: 36, maxHp: 40, radius: 10, sight: 3 },
};

/**
 * What an ant is doing beyond its current path. A plain move order leaves the
 * ant 'idle' with a path; tasks re-plan on their own (see tasks.ts).
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
  };
}

export function isMoving(ant: Ant): boolean {
  return ant.path.length > 0 || ant.moveTarget !== null;
}
