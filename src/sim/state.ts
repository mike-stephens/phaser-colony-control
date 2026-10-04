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
import { Rng } from './rng';
import { Underground, newUnderground } from './underground';
import { PebblePile, Wall } from './walls';
import { Creature } from './wildlife';

export type ColonyId = 'black' | 'red';

/** One nest mound. A colony starts with one and can found more with queens. */
export interface Nest {
  id: number;
  tile: TilePos;
  hp: number;
  /** Tick the nest was last bitten; regeneration waits a while after this. */
  lastHitTick: number;
  /** Ants waiting to hatch here, in order. Food is paid when queued. */
  queue: AntType[];
  /** Ticks spent growing queue[0]. */
  progress: number;
  /** Where new ants walk after hatching; null = just outside the nest. */
  rally: Point | null;
  underground: Underground;
}

export interface Colony {
  id: ColonyId;
  isPlayer: boolean;
  /** Surviving nests; nests[0] is the main one (the oldest still standing). */
  nests: Nest[];
  /** Shared food store for all of the colony's nests. */
  food: number;
  /** True when the colony couldn't feed every ant at the last meal. */
  starving: boolean;
  /** Tick any of this colony's ants was last bitten (drives the "under attack" alert). */
  lastAntHitTick: number;
  /** Out of the game: every nest destroyed, or no ants and no way to make more. */
  eliminated: boolean;
  stats: ColonyStats;
}

/** Where a destroyed nest stood (drawn as rubble). */
export interface Ruin {
  colony: ColonyId;
  tile: TilePos;
}

export interface ColonyStats {
  trained: number;
  gathered: number;
  kills: number;
  losses: number;
}

export const NEST_MAX_HP = 1000;
/** A freshly founded nest starts fragile and regenerates up to NEST_MAX_HP. */
export const NEW_NEST_HP = 400;
/** New nests must be at least this many tiles from any other nest. */
export const MIN_NEST_SPACING = 15;
export const MAX_NESTS = 4;
/** Radius of the nest mound in world pixels (for clicks, bites and drawing). */
export const NEST_RADIUS = TILE_SIZE * 0.8;

/** Toggles for whole systems; tests and future sandbox modes switch these off. */
export interface Rules {
  upkeep: boolean;
  ai: boolean;
  foodRegrowth: boolean;
  wildlife: boolean;
}

/** Bump whenever GameState's shape changes; older saves are rejected. */
export const STATE_VERSION = 3;

/**
 * The complete, serializable game state. Rendering reads from this; nothing
 * in here may reference Phaser objects. Save/load = JSON of this object.
 */
export interface GameState {
  version: typeof STATE_VERSION;
  seed: number;
  /** Simulation RNG position, so a loaded game continues the same sequence. */
  rngState: number;
  tick: number;
  map: GameMap;
  colonies: Colony[];
  ants: Ant[];
  food: Food[];
  pebbles: PebblePile[];
  /** Walls and wall plans, keyed by tile index. */
  walls: Record<number, Wall>;
  creatures: Creature[];
  ruins: Ruin[];
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
  const { map, nestSites, foodSites, pebbleSites } = generateWorld(seed, MAP_WIDTH, MAP_HEIGHT);
  const tileCount = map.width * map.height;
  const state: GameState = {
    version: STATE_VERSION,
    seed,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    map,
    colonies: [],
    ants: [],
    food: [],
    pebbles: [],
    walls: {},
    creatures: [],
    ruins: [],
    fog: { black: new Array(tileCount).fill(0), red: new Array(tileCount).fill(0) },
    nextId: 1,
    rules: { upkeep: true, ai: true, foodRegrowth: true, wildlife: true },
    difficulty,
    winner: null,
  };
  // Undergrounds are laid out with their own seeded RNG so the surface map is unaffected.
  const digRng = new Rng(seed ^ 0x51ed270b);
  state.colonies = [
    newColony(state, 'black', true, nestSites[0], digRng),
    newColony(state, 'red', false, nestSites[1], digRng),
  ];
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
  for (const site of pebbleSites) {
    state.pebbles.push({
      id: state.nextId++,
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

function newColony(state: GameState, id: ColonyId, isPlayer: boolean, tile: TilePos, rng: Rng): Colony {
  return {
    id,
    isPlayer,
    nests: [createNest(state.nextId++, tile, NEST_MAX_HP, newUnderground(rng, true))],
    food: STARTING_FOOD,
    starving: false,
    lastAntHitTick: -1_000_000,
    eliminated: false,
    stats: { trained: 0, gathered: 0, kills: 0, losses: 0 },
  };
}

export function createNest(id: number, tile: TilePos, hp: number, underground: Underground): Nest {
  return { id, tile: { ...tile }, hp, lastHitTick: -1_000_000, queue: [], progress: 0, rally: null, underground };
}

export function getColony(state: GameState, id: ColonyId): Colony {
  return state.colonies.find((c) => c.id === id)!;
}

/** World-space centre of a nest mound. */
export function nestCenter(nest: Nest): Point {
  return { x: tileCenter(nest.tile.x), y: tileCenter(nest.tile.y) };
}

/** Centre of a colony's main nest (its oldest surviving one). */
export function nestPoint(state: GameState, id: ColonyId): Point {
  return nestCenter(getColony(state, id).nests[0]);
}

export function mainNest(state: GameState, id: ColonyId): Nest | undefined {
  return getColony(state, id).nests[0];
}

/** Looks a nest up by id across all colonies. */
export function findNest(state: GameState, nestId: number): { colony: Colony; nest: Nest } | null {
  for (const colony of state.colonies) {
    const nest = colony.nests.find((n) => n.id === nestId);
    if (nest) return { colony, nest };
  }
  return null;
}

/** The colony's nest closest to a point (where workers drop off food, hatchlings rally, ...). */
export function nearestNest(state: GameState, id: ColonyId, p: Point): Nest | null {
  let best: Nest | null = null;
  let bestDist = Infinity;
  for (const nest of getColony(state, id).nests) {
    const c = nestCenter(nest);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestDist) {
      best = nest;
      bestDist = d;
    }
  }
  return best;
}

export function allNests(state: GameState): { colony: Colony; nest: Nest }[] {
  return state.colonies.flatMap((colony) => colony.nests.map((nest) => ({ colony, nest })));
}

function spawnStartingAnts(state: GameState, colony: Colony): void {
  const types = (Object.keys(STARTING_ANTS) as AntType[]).flatMap((t) =>
    Array<AntType>(STARTING_ANTS[t]).fill(t),
  );
  const nest = nestPoint(state, colony.id);
  const region = regionAt(state.map, colony.nests[0].tile.x, colony.nests[0].tile.y);
  // Skip the innermost slots so ants stand around the nest mound, not on it.
  const slots = formationSlots(state.map, nest, types.length + 7, region).slice(7);
  types.forEach((type, i) => {
    const ant = createAnt(state.nextId++, colony.id, type, slots[i] ?? nest);
    ant.angle = Math.atan2(ant.y - nest.y, ant.x - nest.x);
    state.ants.push(ant);
  });
}
