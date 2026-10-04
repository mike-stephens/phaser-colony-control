import type { Point } from './map';
import type { ColonyId } from './state';

export type AntType = 'worker' | 'soldier' | 'queen';

export interface AntStats {
  /** World pixels per second. */
  speed: number;
  maxHp: number;
  /** Body radius in world pixels, used for selection and path clearance. */
  radius: number;
}

export const ANT_STATS: Record<AntType, AntStats> = {
  worker: { speed: 64, maxHp: 10, radius: 6 },
  soldier: { speed: 52, maxHp: 25, radius: 8 },
  queen: { speed: 36, maxHp: 40, radius: 10 },
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
    path: [],
    moveTarget: null,
  };
}
