import { TILE_SIZE } from '../config';
import { Ant, AttackTarget, isMoving } from './ants';
import { gatherersOf, issueCommand } from './commands';
import { AI_PROFILES, AiProfile } from './difficulty';
import { ANT_COST, trainBlocker, upkeepDue } from './economy';
import { isExploredBy, isVisibleTo } from './fog';
import { Point, isWalkable, tileCenter, worldToTile } from './map';
import { regionAt } from './regions';
import { Rng } from './rng';
import { Colony, GameState, nestPoint } from './state';

/** Most workers the AI puts on a single food source. */
const MAX_PER_SOURCE = 4;
/** Workers the AI aims for before it starts adding soldiers freely. */
const WORKER_TARGET = 20;
/** Enemies within this many tiles of the nest trigger a defence. */
const DEFENCE_RADIUS = 12;
/** Soldiers sent to look for the enemy nest when it hasn't been found yet. */
const SCOUT_PARTY = 3;

/**
 * Computer opponent. It only acts through issueCommand and only knows what
 * its own fog of war shows, the same as the player. Difficulty changes how
 * quickly it decides, when and how hard it attacks, and a gathering bonus
 * (see difficulty.ts).
 */
export function updateAi(state: GameState, rng: Rng): void {
  const profile = AI_PROFILES[state.difficulty];
  if (!state.rules.ai || state.tick % profile.thinkInterval !== 0) return;
  for (const colony of state.colonies) {
    if (!colony.isPlayer && !colony.eliminated) think(state, colony, profile, rng);
  }
}

function think(state: GameState, colony: Colony, profile: AiProfile, rng: Rng): void {
  const openSlots = assignIdleWorkers(state, colony, rng);
  train(state, colony, profile, openSlots);
  if (!defend(state, colony)) attack(state, colony, profile, rng);
}

// ---------------------------------------------------------------- economy

/** Puts idle workers on known food or scouting; returns gatherer slots still open. */
function assignIdleWorkers(state: GameState, colony: Colony, rng: Rng): number {
  const idle = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'worker' && a.task.kind === 'idle' && !isMoving(a),
  );

  const nest = nestPoint(state, colony.id);
  const homeRegion = regionAt(state.map, colony.nest.x, colony.nest.y);
  const known = state.food
    .filter((f) => {
      const tx = worldToTile(f.x);
      const ty = worldToTile(f.y);
      return isExploredBy(state, colony.id, tx, ty) && regionAt(state.map, tx, ty) === homeRegion;
    })
    .sort((a, b) => Math.hypot(a.x - nest.x, a.y - nest.y) - Math.hypot(b.x - nest.x, b.y - nest.y));

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
 */
function train(state: GameState, colony: Colony, profile: AiProfile, openSlots: number): void {
  if (colony.queue.length >= 2) return;
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
  if (trainBlocker(state, colony, type) === null) {
    issueCommand(state, colony.id, { type: 'train', antType: type });
  }
}

// ---------------------------------------------------------------- military

/** Sends every soldier not already fighting at the intruder nearest the nest. Returns true if defending. */
function defend(state: GameState, colony: Colony): boolean {
  const nest = nestPoint(state, colony.id);
  let intruder: AttackTarget | null = null;
  let best = DEFENCE_RADIUS * TILE_SIZE;
  const consider = (p: Point, target: AttackTarget) => {
    const d = Math.hypot(p.x - nest.x, p.y - nest.y);
    if (d < best && isVisibleTo(state, colony.id, worldToTile(p.x), worldToTile(p.y))) {
      intruder = target;
      best = d;
    }
  };
  for (const a of state.ants) if (a.colony !== colony.id) consider(a, { ant: a.id });
  for (const c of state.creatures) consider(c, { creature: c.id });
  if (!intruder) return false;

  const defenders = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'soldier' && !(a.task.kind === 'attack' && 'ant' in a.task.target),
  );
  if (defenders.length > 0) {
    issueCommand(state, colony.id, {
      type: 'attack',
      antIds: defenders.map((a) => a.id),
      target: intruder,
    });
  }
  return true;
}

/** Launches a wave at the enemy nest once enough soldiers are idle, scouting for it first if needed. */
function attack(state: GameState, colony: Colony, profile: AiProfile, rng: Rng): void {
  if (state.tick < profile.firstAttackTick) return;
  const idleSoldiers = state.ants.filter(
    (a) => a.colony === colony.id && a.type === 'soldier' && a.task.kind === 'idle' && !isMoving(a),
  );
  const enemy = state.colonies.find(
    (c) => c.id !== colony.id && !c.eliminated && isExploredBy(state, colony.id, c.nest.x, c.nest.y),
  );

  if (enemy) {
    if (idleSoldiers.length < profile.waveSize) return;
    issueCommand(state, colony.id, {
      type: 'attack',
      antIds: idleSoldiers.map((a) => a.id),
      target: { nest: enemy.id },
    });
    return;
  }

  // Enemy nest not found yet: keep a small party searching the far side of the map.
  const searching = state.ants.some((a) => a.colony === colony.id && a.type === 'soldier' && a.task.kind === 'explore');
  if (searching || idleSoldiers.length < SCOUT_PARTY) return;
  const target = scoutTarget(state, colony, rng, 'farthest');
  if (target) {
    issueCommand(state, colony.id, {
      type: 'explore',
      antIds: idleSoldiers.slice(0, SCOUT_PARTY).map((a) => a.id),
      target,
    });
  }
}

// ---------------------------------------------------------------- helpers

/** Samples random tiles and returns an unexplored, reachable one nearest to / farthest from the nest. */
function scoutTarget(state: GameState, colony: Colony, rng: Rng, prefer: 'nearest' | 'farthest'): Point | null {
  const { map } = state;
  const home = regionAt(map, colony.nest.x, colony.nest.y);
  let best: Point | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 300; i++) {
    const x = rng.int(0, map.width - 1);
    const y = rng.int(0, map.height - 1);
    if (!isWalkable(map, x, y) || regionAt(map, x, y) !== home || isExploredBy(state, colony.id, x, y)) continue;
    const d = Math.hypot(x - colony.nest.x, y - colony.nest.y);
    const score = prefer === 'nearest' ? d : -d;
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
