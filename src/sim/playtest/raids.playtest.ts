/**
 * Opt-in playtest (not part of `npm test`; run with `npm run playtest`).
 *
 * A scripted "sensible human" plays black through the normal command
 * interface: gathers, trains workers then soldiers, scouts with a worker, and
 * sends 12+ soldiers at the nearest known red nest, either as a direct raid
 * (right-clicking the nest) or as an attack-move onto it. It reports each
 * attack wave's outcome, which is the thing to watch after combat or AI
 * balance changes. Takes about half a minute.
 */
import { it } from 'vitest';
import { isMoving } from '../ants';
import { gatherersOf, issueCommand } from '../commands';
import { Difficulty } from '../difficulty';
import { ANT_COST, trainBlocker, upkeepDue } from '../economy';
import { isExploredBy } from '../fog';
import { isWalkable, tileCenter, worldToTile } from '../map';
import { regionAt } from '../regions';
import { stepSimulation } from '../simulation';
import { GameState, createNewGame, getColony, nestCenter } from '../state';

/** A scripted "sensible human" playing black through the normal command interface. */
type Strategy = 'raid' | 'attackMove';
let STRATEGY: Strategy = 'raid';

function playerThink(s: GameState, seedRng: () => number, log: (m: string) => void, raid: RaidTracker) {
  const black = getColony(s, 'black');
  if (black.nests.length === 0) return;
  const home = black.nests[0];
  const mine = s.ants.filter((a) => a.colony === 'black');
  const workers = mine.filter((a) => a.type === 'worker');
  const soldiers = mine.filter((a) => a.type === 'soldier');
  const region = regionAt(s.map, home.tile.x, home.tile.y);

  // 1. Economy: idle workers onto the nearest known food, 4 per source.
  const idle = workers.filter((a) => a.task.kind === 'idle' && !isMoving(a) && a.id !== raid.scoutId);
  const hc = nestCenter(home);
  const known = s.food
    .filter((f) => isExploredBy(s, 'black', worldToTile(f.x), worldToTile(f.y)) && regionAt(s.map, worldToTile(f.x), worldToTile(f.y)) === region)
    .sort((a, b) => Math.hypot(a.x - hc.x, a.y - hc.y) - Math.hypot(b.x - hc.x, b.y - hc.y));
  let free = idle.length;
  for (const f of known) {
    if (free <= 0) break;
    const cur = gatherersOf(s, 'black', f.id).length;
    const add = Math.min(free, 4 - cur);
    if (add > 0) {
      issueCommand(s, 'black', { type: 'setGatherers', foodId: f.id, count: cur + add });
      free -= add;
    }
  }

  // 2. Scouting: one worker keeps exploring far-off unexplored ground until the red nest is found.
  const knownNests = getColony(s, 'red').nests
    .filter((n) => isExploredBy(s, 'black', n.tile.x, n.tile.y))
    .sort((a, b) => Math.hypot(a.tile.x - home.tile.x, a.tile.y - home.tile.y) - Math.hypot(b.tile.x - home.tile.x, b.tile.y - home.tile.y));
  const enemyNest = knownNests[0];
  const allFound = getColony(s, 'red').nests.every((n) => isExploredBy(s, 'black', n.tile.x, n.tile.y));
  if (!allFound) {
    let scout = s.ants.find((a) => a.id === raid.scoutId);
    if (!scout) {
      scout = workers.find((a) => a.task.kind !== 'explore') ?? workers[0];
      if (scout) raid.scoutId = scout.id;
    }
    if (scout && (scout.task.kind !== 'explore' || !isMoving(scout))) {
      for (let i = 0; i < 400; i++) {
        const x = Math.floor(seedRng() * s.map.width);
        const y = Math.floor(seedRng() * s.map.height);
        if (!isWalkable(s.map, x, y) || regionAt(s.map, x, y) !== region || isExploredBy(s, 'black', x, y)) continue;
        if (Math.hypot(x - home.tile.x, y - home.tile.y) < 30) continue;
        issueCommand(s, 'black', { type: 'explore', antIds: [scout.id], target: { x: tileCenter(x), y: tileCenter(y) } });
        break;
      }
    }
  }
  if (enemyNest && raid.foundAt < 0) raid.foundAt = s.tick;

  // 3. Training: workers up to 16, then soldiers, keeping two meals in reserve.
  if (home.queue.length < 2) {
    const type = workers.length < 16 ? 'worker' : 'soldier';
    if (black.food - ANT_COST[type].food >= upkeepDue(s, 'black') * 2 && trainBlocker(s, black, home, type) === null) {
      issueCommand(s, 'black', { type: 'train', antType: type, nestId: home.id });
    }
  }

  // 4. Attack: once the nest is known and 12 soldiers aren't already raiding, send them all at it
  //    (exactly what right-clicking the nest does).
  if (enemyNest) {
    const sent = new Set(raid.waves.flatMap((w) => w.ids));
    const available = soldiers.filter((a) => !sent.has(a.id) || a.task.kind === 'idle');
    if (available.length >= 12) {
      if (STRATEGY === 'raid') {
        issueCommand(s, 'black', { type: 'attack', antIds: available.map((a) => a.id), target: { nest: enemyNest.id } });
      } else {
        issueCommand(s, 'black', { type: 'attackMove', antIds: available.map((a) => a.id), target: nestCenter(enemyNest) });
      }
      raid.waves.push({ tick: s.tick, ids: available.map((a) => a.id), nestId: enemyNest.id, hpAtStart: enemyNest.hp });
      log(`  wave ${raid.waves.length}: ${available.length} soldiers sent at the red nest at ${(s.tick / 1200).toFixed(1)} min`);
      void sent;
    }
  }
}

interface RaidTracker {
  scoutId: number;
  foundAt: number;
  waves: { tick: number; ids: number[]; nestId: number; hpAtStart: number; arrived?: number; fell?: number; lostBy?: number }[];
  onNest: number;
  onAnts: number;
  onOther: number;
}

function play(seed: number, difficulty: Difficulty) {
  const s = createNewGame(seed, difficulty);
  let r = seed * 7919 + 1;
  const rng = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const raid: RaidTracker = { scoutId: -1, foundAt: -1, waves: [], onNest: 0, onAnts: 0, onOther: 0 };
  const MAX = 20 * 60 * 30;
  while (s.tick < MAX && !s.winner) {
    if (s.tick % 40 === 0) playerThink(s, rng, () => {}, raid);
    stepSimulation(s);
    for (const w of raid.waves) {
      const nest = s.colonies.flatMap((c) => c.nests).find((n) => n.id === w.nestId);
      const alive = s.ants.filter((a) => w.ids.includes(a.id));
      if (nest && w.arrived === undefined) {
        const c = nestCenter(nest);
        if (alive.some((a) => Math.hypot(a.x - c.x, a.y - c.y) < 2 * 32)) w.arrived = s.tick;
      }
      if (!nest && w.fell === undefined && w.lostBy === undefined) w.fell = s.tick;
      if (alive.length === 0 && w.fell === undefined && w.lostBy === undefined) w.lostBy = s.tick;
    }
  }
  const waves = raid.waves.map((w, i) => {
    const sec = (t?: number) => (t === undefined ? '-' : `${Math.round((t - w.tick) / 20)}s`);
    const outcome = w.fell !== undefined ? `NEST FELL ${sec(w.fell)} after the order` : w.lostBy !== undefined ? `wiped out ${sec(w.lostBy)} after the order` : 'unfinished';
    return `    wave ${i + 1} at ${(w.tick / 1200).toFixed(1)}m: ${w.ids.length} soldiers, reached nest ${sec(w.arrived)}, ${outcome}`;
  });
  return [
    `${difficulty} seed ${seed}: winner ${s.winner ?? 'none'} at ${(s.tick / 1200).toFixed(1)} min, first red nest found ${raid.foundAt < 0 ? 'never' : (raid.foundAt / 1200).toFixed(1) + ' min'}, waves sent ${raid.waves.length}`,
    ...waves,
  ].join('\n');
}

it('raid playthroughs', () => {
  const out: string[] = [];
  for (const strategy of ['raid', 'attackMove'] as const) {
    STRATEGY = strategy;
    out.push(`=== strategy: ${strategy} ===`);
    for (const d of ['medium', 'hard'] as const) for (let seed = 1; seed <= 6; seed++) out.push(play(seed, d));
  }
  // Write straight to stdout: the test runner hides console.log from passing tests.
  (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout.write(out.join('\n') + '\n');
}, 1800000);
