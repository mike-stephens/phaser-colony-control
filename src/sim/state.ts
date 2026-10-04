import { MAP_HEIGHT, MAP_WIDTH } from '../config';
import { Ant, AntType, createAnt } from './ants';
import { updateFog } from './fog';
import { Food } from './food';
import { formationSlots } from './formation';
import { GameMap, Point, TilePos, tileCenter } from './map';
import { generateWorld } from './mapgen';
import { regionAt } from './regions';

export type ColonyId = 'black' | 'red';

export interface Colony {
  id: ColonyId;
  isPlayer: boolean;
  nest: TilePos;
  food: number;
}

/**
 * The complete, serializable game state. Rendering reads from this; nothing
 * in here may reference Phaser objects. Save/load = JSON of this object.
 */
export interface GameState {
  version: 1;
  seed: number;
  /** Simulation RNG position, so a loaded game continues the same sequence. */
  rngState: number;
  tick: number;
  map: GameMap;
  colonies: Colony[];
  ants: Ant[];
  food: Food[];
  /** Per-colony explored grid (1 = seen at least once), row-major like map.tiles. */
  fog: Record<ColonyId, number[]>;
  /** Next id for any entity (ants, food, ...). */
  nextId: number;
}

const STARTING_ANTS: Record<AntType, number> = { worker: 10, soldier: 5, queen: 0 };

export function createNewGame(seed: number): GameState {
  const { map, nestSites, foodSites } = generateWorld(seed, MAP_WIDTH, MAP_HEIGHT);
  const tileCount = map.width * map.height;
  const state: GameState = {
    version: 1,
    seed,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    map,
    colonies: [
      { id: 'black', isPlayer: true, nest: nestSites[0], food: 50 },
      { id: 'red', isPlayer: false, nest: nestSites[1], food: 50 },
    ],
    ants: [],
    food: [],
    fog: { black: new Array(tileCount).fill(0), red: new Array(tileCount).fill(0) },
    nextId: 1,
  };
  for (const site of foodSites) {
    state.food.push({
      id: state.nextId++,
      kind: site.kind,
      x: tileCenter(site.tile.x),
      y: tileCenter(site.tile.y),
      amount: site.amount,
      max: site.amount,
    });
  }
  for (const colony of state.colonies) spawnStartingAnts(state, colony);
  updateFog(state);
  return state;
}

export function getColony(state: GameState, id: ColonyId): Colony {
  return state.colonies.find((c) => c.id === id)!;
}

/** World-space centre of a colony's nest entrance. */
export function nestPoint(state: GameState, id: ColonyId): Point {
  const { nest } = getColony(state, id);
  return { x: tileCenter(nest.x), y: tileCenter(nest.y) };
}

function spawnStartingAnts(state: GameState, colony: Colony): void {
  const types = (Object.keys(STARTING_ANTS) as AntType[]).flatMap((t) =>
    Array<AntType>(STARTING_ANTS[t]).fill(t),
  );
  const nest = nestPoint(state, colony.id);
  const region = regionAt(state.map, colony.nest.x, colony.nest.y);
  // Skip the innermost slots so ants stand around the nest mound, not on it.
  const slots = formationSlots(state.map, nest, types.length + 7, region).slice(7);
  types.forEach((type, i) => {
    const ant = createAnt(state.nextId++, colony.id, type, slots[i] ?? nest);
    ant.angle = Math.atan2(ant.y - nest.y, ant.x - nest.x);
    state.ants.push(ant);
  });
}
