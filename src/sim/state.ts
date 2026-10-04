import { MAP_HEIGHT, MAP_WIDTH } from '../config';
import { TILE_SIZE } from '../config';
import { Ant, AntType, createAnt } from './ants';
import { Difficulty } from './difficulty';
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
  /** Ants waiting to hatch, in order. Food is paid when queued. */
  queue: AntType[];
  /** Ticks spent growing queue[0]. */
  progress: number;
  /** Where new ants walk after hatching; null = just outside the nest. */
  rally: Point | null;
  /** True when the colony couldn't feed every ant at the last meal. */
  starving: boolean;
  nestHp: number;
  /** Tick the nest was last bitten; regeneration waits a while after this. */
  lastNestHitTick: number;
  /** Tick any of this colony's ants was last bitten (drives the "under attack" alert). */
  lastAntHitTick: number;
  /** Out of the game: nest destroyed, or no ants and no way to make more. */
  eliminated: boolean;
  stats: ColonyStats;
}

export interface ColonyStats {
  trained: number;
  gathered: number;
  kills: number;
  losses: number;
}

export const NEST_MAX_HP = 1000;
/** Radius of the nest mound in world pixels (for clicks, bites and drawing). */
export const NEST_RADIUS = TILE_SIZE * 0.8;

/** Toggles for whole systems; tests and future sandbox modes switch these off. */
export interface Rules {
  upkeep: boolean;
  ai: boolean;
  foodRegrowth: boolean;
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
  rules: Rules;
  difficulty: Difficulty;
  /** Set when only one colony is left standing. */
  winner: ColonyId | null;
}

const STARTING_ANTS: Record<AntType, number> = { worker: 10, soldier: 5, queen: 0 };
export const STARTING_FOOD = 100;

export function createNewGame(seed: number, difficulty: Difficulty = 'medium'): GameState {
  const { map, nestSites, foodSites } = generateWorld(seed, MAP_WIDTH, MAP_HEIGHT);
  const tileCount = map.width * map.height;
  const state: GameState = {
    version: 1,
    seed,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    map,
    colonies: [newColony('black', true, nestSites[0]), newColony('red', false, nestSites[1])],
    ants: [],
    food: [],
    fog: { black: new Array(tileCount).fill(0), red: new Array(tileCount).fill(0) },
    nextId: 1,
    rules: { upkeep: true, ai: true, foodRegrowth: true },
    difficulty,
    winner: null,
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

function newColony(id: ColonyId, isPlayer: boolean, nest: TilePos): Colony {
  return {
    id,
    isPlayer,
    nest,
    food: STARTING_FOOD,
    queue: [],
    progress: 0,
    rally: null,
    starving: false,
    nestHp: NEST_MAX_HP,
    lastNestHitTick: -1_000_000,
    lastAntHitTick: -1_000_000,
    eliminated: false,
    stats: { trained: 0, gathered: 0, kills: 0, losses: 0 },
  };
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
