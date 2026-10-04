import { MAP_HEIGHT, MAP_WIDTH } from '../config';
import { Ant, AntType, createAnt } from './ants';
import { formationSlots } from './formation';
import { GameMap, TilePos, tileCenter } from './map';
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
  tick: number;
  map: GameMap;
  colonies: Colony[];
  ants: Ant[];
  nextAntId: number;
}

const STARTING_ANTS: Record<AntType, number> = { worker: 10, soldier: 5, queen: 0 };

export function createNewGame(seed: number): GameState {
  const { map, nestSites } = generateWorld(seed, MAP_WIDTH, MAP_HEIGHT);
  const state: GameState = {
    version: 1,
    seed,
    tick: 0,
    map,
    colonies: [
      { id: 'black', isPlayer: true, nest: nestSites[0], food: 50 },
      { id: 'red', isPlayer: false, nest: nestSites[1], food: 50 },
    ],
    ants: [],
    nextAntId: 1,
  };
  for (const colony of state.colonies) spawnStartingAnts(state, colony);
  return state;
}

function spawnStartingAnts(state: GameState, colony: Colony): void {
  const types = (Object.keys(STARTING_ANTS) as AntType[]).flatMap((t) =>
    Array<AntType>(STARTING_ANTS[t]).fill(t),
  );
  const nest = { x: tileCenter(colony.nest.x), y: tileCenter(colony.nest.y) };
  const region = regionAt(state.map, colony.nest.x, colony.nest.y);
  // Skip the innermost slots so ants stand around the nest mound, not on it.
  const slots = formationSlots(state.map, nest, types.length + 7, region).slice(7);
  types.forEach((type, i) => {
    const ant = createAnt(state.nextAntId++, colony.id, type, slots[i] ?? nest);
    ant.angle = Math.atan2(ant.y - nest.y, ant.x - nest.x);
    state.ants.push(ant);
  });
}
