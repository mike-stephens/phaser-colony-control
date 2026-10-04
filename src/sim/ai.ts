import { TILE_SIZE } from '../config';
import { Ant, AttackTarget, isMoving } from './ants';
import { gatherersOf, issueCommand } from './commands';
import { AI_PROFILES, AiProfile } from './difficulty';
import { ANT_COST, trainBlocker, upkeepDue } from './economy';
import { isExploredBy, isVisibleTo } from './fog';
import { foundBlocker } from './founding';
import { Point, isWalkable, tileCenter, worldToTile } from './map';
import { regionAt } from './regions';
import { Rng } from './rng';
import { Colony, GameState, Nest, nestCenter } from './state';

/** Most workers the AI puts on a single food source. */
const MAX_PER_SOURCE = 4;
/** Workers the AI aims for before it starts adding soldiers freely. */
const WORKER_TARGET = 20;
/** Enemies within this many tiles of any of its nests trigger a defence. */
const DEFENCE_RADIUS = 12;
/** Soldiers sent to look for the enemy nest when it hasn't been found yet. */
const SCOUT_PARTY = 3;
/** With a full wave waiting and no target, search with up to this many parties at once. */
const MAX_SEARCH_PARTIES = 4;
/** Expansion: food and workers the AI wants in hand before training a queen. */
const EXPAND_FOOD = 250;
const EXPAND_WORKERS = 20;
/** New nests go at least this far (tiles) from any known enemy nest. */
const EXPAND_ENEMY_DISTANCE = 30;

/**
 * Computer opponent. It only acts through issueCommand and only knows what
 * its own fog of war shows, the same as the player. Difficulty changes how
 * quickly it decides, when and how hard it attacks, how far it expands, and a
 * gathering bonus (see difficulty.ts).
 */
export function updateAi(state: GameState, rng: Rng): void {
  const profile = AI_PROFILES[state.difficulty];
  if (!state.rules.ai || state.tick % profile.thinkInterval !== 0) return;
  for (const colony of state.colonies) {
    if (!colony.isPlayer && !colony.eliminated && colony.nests.length > 0) think(state, colony, profile, rng);
  }
}

function think(state: GameState, colony: Colony, profile: AiProfile, rng: Rng): void {
  const openSlots = assignIdleWorkers(state, colony, rng);
  expand(state, colony, profile, rng);
  train(state, colony, profile, openSlots);
  if (!defend(state, colony)) attack(state, colony, profile, rng);
}

// ---------------------------------------------------------------- economy

/** Puts idle workers on known food or scouting; returns gatherer slots still open. */
function assignIdleWorkers(state: GameState, colony: Colony, rng: Rng): number {
  const idle = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'worker' && a.task.kind === 'idle' && !isMoving(a),
  );

  const home = colony.nests[0].tile;
  const homeRegion = regionAt(state.map, home.x, home.y);
  // Sources sorted by distance to whichever of our nests is closest.
  const nestDist = (p: Point) => Math.min(...colony.nests.map((n) => dist(nestCenter(n), p)));
  const known = state.food
    .filter((f) => {
      const tx = worldToTile(f.x);
      const ty = worldToTile(f.y);
      return isExploredBy(state, colony.id, tx, ty) && regionAt(state.map, tx, ty) === homeRegion;
    })
    .sort((a, b) => nestDist(a) - nestDist(b));

  let free = idle.length;
  let openSlots = 0;
  for (const food of known) {
    const current = gatherersOf(state, colony.id, food.id).length;
    const add = Math.min(free, MAX_PER_SOURCE - current);
    if (add > 0) {
      issueCommand(state, colony.id, { type: 'setGatherers', foodId: food.id, count: current + add });
      free -= add;
    }
    openSlots += Math.max(0, MAX_PER_SOURCE - current - Math.max(add, 0));
  }

  // Nothing known for the rest to gather: scout the nearest unexplored ground.
  const scouts = idle.filter((a) => a.task.kind === 'idle');
  if (scouts.length > 0) {
    const target = scoutTarget(state, colony, rng, 'nearest');
    if (target) issueCommand(state, colony.id, { type: 'explore', antIds: scouts.map((a) => a.id), target });
  }
  return openSlots;
}

/**
 * Grows the colony only as fast as its food supply allows: more workers while
 * there is food for them to gather, soldiers once the economy has slack.
 * Trains at whichever nest has the shortest queue.
 */
function train(state: GameState, colony: Colony, profile: AiProfile, openSlots: number): void {
  const nest = [...colony.nests].sort((a, b) => a.queue.length - b.queue.length)[0];
  if (nest.queue.length >= 2) return;
  const workers = count(state, colony, 'worker');
  const soldiers = count(state, colony, 'soldier');
  let type: 'worker' | 'soldier' | null = null;
  if (openSlots > 0 && (workers < WORKER_TARGET || soldiers * profile.workersPerSoldier >= workers)) {
    type = 'worker';
  } else if (workers >= profile.minWorkersForSoldiers && soldiers * profile.workersPerSoldier < workers) {
    type = 'soldier';
  }
  if (!type) return;
  // Keep meals in reserve so training never starves the colony; soldiers need more slack.
  const reserve = upkeepDue(state, colony.id) * (type === 'worker' ? 2 : 4);
  if (colony.food - ANT_COST[type].food < reserve) return;
  if (trainBlocker(state, colony, nest, type) === null) {
    issueCommand(state, colony.id, { type: 'train', antType: type, nestId: nest.id });
  }
}

/**
 * Founds new nests up to the difficulty's limit: trains a queen once the
 * economy is comfortable, then walks her to a known spot near food and away
 * from the enemy.
 */
function expand(state: GameState, colony: Colony, profile: AiProfile, rng: Rng): void {
  if (colony.nests.length >= profile.maxNests) return;
  const queens = state.ants.filter((a) => a.colony === colony.id && a.type === 'queen');
  const idleQueen = queens.find((q) => q.task.kind === 'idle' && !isMoving(q));
  if (idleQueen) {
    const site = expansionSite(state, colony, rng);
    if (site) issueCommand(state, colony.id, { type: 'found', antId: idleQueen.id, target: site });
    return;
  }
  const queenQueued = colony.nests.some((n) => n.queue.includes('queen'));
  if (queens.length > 0 || queenQueued) return;
  if (colony.food < EXPAND_FOOD || count(state, colony, 'worker') < EXPAND_WORKERS) return;
  const nest = colony.nests[0];
  if (trainBlocker(state, colony, nest, 'queen') === null) {
    issueCommand(state, colony.id, { type: 'train', antType: 'queen', nestId: nest.id });
  }
}

/** A legal, explored site with known food nearby, far from known enemy nests, as close to home as possible. */
function expansionSite(state: GameState, colony: Colony, rng: Rng): Point | null {
  const { map } = state;
  const home = colony.nests[0].tile;
  const enemyNests = state.colonies
    .filter((c) => c.id !== colony.id)
    .flatMap((c) => c.nests)
    .filter((n) => isExploredBy(state, colony.id, n.tile.x, n.tile.y));
  let best: Point | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 400; i++) {
    const x = rng.int(2, map.width - 3);
    const y = rng.int(2, map.height - 3);
    if (foundBlocker(state, colony.id, x, y) !== null) continue;
    if (enemyNests.some((n) => Math.hypot(n.tile.x - x, n.tile.y - y) < EXPAND_ENEMY_DISTANCE)) continue;
    const p = { x: tileCenter(x), y: tileCenter(y) };
    const foodNearby = state.food.some((f) => dist(f, p) < 8 * TILE_SIZE);
    if (!foodNearby) continue;
    const score = Math.hypot(home.x - x, home.y - y);
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------- military

/** Sends every soldier not already fighting at the intruder nearest any of its nests. Returns true if defending. */
function defend(state: GameState, colony: Colony): boolean {
  let intruder: AttackTarget | null = null;
  let best = DEFENCE_RADIUS * TILE_SIZE;
  const consider = (p: Point, target: AttackTarget) => {
    for (const nest of colony.nests) {
      const d = dist(p, nestCenter(nest));
      if (d < best && isVisibleTo(state, colony.id, worldToTile(p.x), worldToTile(p.y))) {
        intruder = target;
        best = d;
      }
    }
  };
  for (const a of state.ants) if (a.colony !== colony.id) consider(a, { ant: a.id });
  for (const c of state.creatures) consider(c, { creature: c.id });
  if (!intruder) return false;

  const defenders = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'soldier' && !(a.task.kind === 'attack' && 'ant' in a.task.target),
  );
  if (defenders.length > 0) {
    issueCommand(state, colony.id, { type: 'attack', antIds: defenders.map((a) => a.id), target: intruder });
  }
  return true;
}

/** Launches a wave at the nearest known enemy nest once enough soldiers are idle, scouting first if needed. */
function attack(state: GameState, colony: Colony, profile: AiProfile, rng: Rng): void {
  if (state.tick < profile.firstAttackTick) return;
  const idleSoldiers = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'soldier' && a.task.kind === 'idle' && !isMoving(a),
  );
  const home = nestCenter(colony.nests[0]);
  const known: Nest[] = state.colonies
    .filter((c) => c.id !== colony.id && !c.eliminated)
    .flatMap((c) => c.nests)
    .filter((n) => isExploredBy(state, colony.id, n.tile.x, n.tile.y))
    .sort((a, b) => dist(nestCenter(a), home) - dist(nestCenter(b), home));

  if (known.length > 0) {
    if (idleSoldiers.length < profile.waveSize) return;
    issueCommand(state, colony.id, {
      type: 'attack',
      antIds: idleSoldiers.map((a) => a.id),
      target: { nest: known[0].id },
    });
    return;
  }

  // No enemy nest found yet. Keep one party searching; once a whole wave is
  // waiting, fan out several parties in different directions to find it sooner.
  const parties = Math.ceil(
    state.ants.filter((a) => a.colony === colony.id && a.type === 'soldier' && a.task.kind === 'explore').length /
      SCOUT_PARTY,
  );
  const wanted = idleSoldiers.length >= profile.waveSize ? MAX_SEARCH_PARTIES : 1;
  for (let p = parties, i = 0; p < wanted && idleSoldiers.length - i >= SCOUT_PARTY; p++, i += SCOUT_PARTY) {
    const target = scoutTarget(state, colony, rng, 'far');
    if (!target) return;
    issueCommand(state, colony.id, {
      type: 'explore',
      antIds: idleSoldiers.slice(i, i + SCOUT_PARTY).map((a) => a.id),
      target,
    });
  }
}

// ---------------------------------------------------------------- helpers

/** Scouting searches start at least this far (tiles) from home. */
const FAR_SCOUT_DISTANCE = 30;

/**
 * Samples random tiles for an unexplored, reachable one: the nearest to the
 * main nest, or ('far') a random one well away from it, so successive parties
 * head off in different directions.
 */
function scoutTarget(state: GameState, colony: Colony, rng: Rng, prefer: 'nearest' | 'far'): Point | null {
  const { map } = state;
  const nest = colony.nests[0].tile;
  const home = regionAt(map, nest.x, nest.y);
  let best: Point | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 300; i++) {
    const x = rng.int(0, map.width - 1);
    const y = rng.int(0, map.height - 1);
    if (!isWalkable(map, x, y) || regionAt(map, x, y) !== home || isExploredBy(state, colony.id, x, y)) continue;
    const d = Math.hypot(x - nest.x, y - nest.y);
    if (prefer === 'far') {
      if (d >= FAR_SCOUT_DISTANCE) return { x: tileCenter(x), y: tileCenter(y) };
      continue;
    }
    const score = d;
    if (score < bestScore) {
      best = { x: tileCenter(x), y: tileCenter(y) };
      bestScore = score;
    }
  }
  return best;
}

function count(state: GameState, colony: Colony, type: Ant['type']): number {
  let n = 0;
  for (const a of state.ants) if (a.colony === colony.id && a.type === type) n++;
  return n;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
