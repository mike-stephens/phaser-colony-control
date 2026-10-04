import { MAP_HEIGHT, MAP_WIDTH } from '../config';
import { GameMap, TilePos } from './map';
import { generateWorld } from './mapgen';

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
}

export function createNewGame(seed: number): GameState {
  const { map, nestSites } = generateWorld(seed, MAP_WIDTH, MAP_HEIGHT);
  return {
    version: 1,
    seed,
    tick: 0,
    map,
    colonies: [
      { id: 'black', isPlayer: true, nest: nestSites[0], food: 50 },
      { id: 'red', isPlayer: false, nest: nestSites[1], food: 50 },
    ],
  };
}
