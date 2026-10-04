import { describe, expect, it } from 'vitest';
import { createAnt } from './ants';
import { buildersOf, issueCommand } from './commands';
import { updateFog } from './fog';
import { TilePos, isWalkable, tileCenter } from './map';
import { stepSimulation } from './simulation';
import { GameState, createNewGame, getColony, nestPoint } from './state';
import { WALL_PEBBLES, wallPlanBlocker } from './walls';
import { CREATURE_STATS } from './wildlife';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSimulation(state);
};
const quietGame = (seed = 5) => {
  const state = createNewGame(seed);
  state.rules = { upkeep: false, ai: false, foodRegrowth: false, wildlife: false };
  return state;
};
const tileIdx = (state: GameState, t: TilePos) => t.y * state.map.width + t.x;

/** An open 7x7 patch (all walkable, nothing on it) at least `minDist` tiles from both nests. */
function openPatch(state: GameState, minDist: number): TilePos {
  const { map } = state;
  for (let y = 5; y < map.height - 5; y++) {
    for (let x = 5; x < map.width - 5; x++) {
      if (state.colonies.some((c) => Math.hypot(c.nests[0].tile.x - x, c.nests[0].tile.y - y) < minDist)) continue;
      let ok = true;
      for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) ok = isWalkable(map, x + dx, y + dy);
      if (ok) return { x, y };
    }
  }
  throw new Error('no open patch');
}

/** Builds (instantly) a wall ring around `c` owned by `owner`, with optional gap. */
function ring(state: GameState, c: TilePos, owner: 'black' | 'red', hp: number, gap?: TilePos) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const t = { x: c.x + dx, y: c.y + dy };
      if (gap && gap.x === t.x && gap.y === t.y) continue;
      const tile = tileIdx(state, t);
      state.walls[tile] = { tile, owner, built: true, pebbles: WALL_PEBBLES, hp };
    }
  }
}

describe('wall planning', () => {
  it('rejects unexplored ground, nest entrances and blocked tiles', () => {
    const state = quietGame();
    const nest = getColony(state, 'black').nests[0].tile;
    const red = getColony(state, 'red').nests[0].tile;
    expect(wallPlanBlocker(state, 'black', nest.x + 1, nest.y)).toBe('Too close to a nest');
    expect(wallPlanBlocker(state, 'black', red.x + 5, red.y)).toBe('Unexplored');
    expect(wallPlanBlocker(state, 'black', nest.x + 4, nest.y)).toBeNull();
    issueCommand(state, 'black', { type: 'planWalls', tiles: [{ x: nest.x + 1, y: nest.y }, { x: nest.x + 4, y: nest.y }] });
    expect(Object.keys(state.walls)).toHaveLength(1);
  });
});

describe('building walls', () => {
  it('builders haul pebbles from a known pile and finish the plans', () => {
    const state = quietGame();
    const nest = getColony(state, 'black').nests[0].tile;
    const plans = [{ x: nest.x + 4, y: nest.y }, { x: nest.x + 4, y: nest.y + 1 }].filter(
      (t) => wallPlanBlocker(state, 'black', t.x, t.y) === null,
    );
    expect(plans.length).toBeGreaterThan(0);
    const pebblesBefore = state.pebbles.reduce((n, p) => n + p.amount, 0);

    issueCommand(state, 'black', { type: 'planWalls', tiles: plans });
    issueCommand(state, 'black', { type: 'setBuilders', count: 3 });
    expect(buildersOf(state, 'black')).toHaveLength(3);
    run(state, 20 * 60);

    for (const t of plans) expect(state.walls[tileIdx(state, t)].built).toBe(true);
    const used = pebblesBefore - state.pebbles.reduce((n, p) => n + p.amount, 0);
    const inHand = state.ants.filter((a) => a.pebble).length;
    expect(used - inHand).toBe(plans.length * WALL_PEBBLES);
  });
});

describe('walls and movement', () => {
  it("a colony's own ants walk straight through its walls", () => {
    const state = quietGame();
    const c = openPatch(state, 12);
    ring(state, c, 'black', 300);
    const ant = createAnt(state.nextId++, 'black', 'worker', { x: tileCenter(c.x), y: tileCenter(c.y) });
    state.ants.push(ant);
    updateFog(state);
    const out = { x: tileCenter(c.x + 3), y: tileCenter(c.y) };
    issueCommand(state, 'black', { type: 'move', antIds: [ant.id], target: out });
    run(state, 20 * 4);
    expect(Math.hypot(ant.x - out.x, ant.y - out.y)).toBeLessThan(4);
    expect(Object.values(state.walls).every((w) => w.hp === 300)).toBe(true);
  });

  it('enemies take a gap when there is one', () => {
    const state = quietGame();
    const c = openPatch(state, 12);
    ring(state, c, 'black', 300, { x: c.x - 1, y: c.y });
    const ant = createAnt(state.nextId++, 'red', 'worker', { x: tileCenter(c.x), y: tileCenter(c.y) });
    state.ants.push(ant);
    updateFog(state);
    const out = { x: tileCenter(c.x + 3), y: tileCenter(c.y) };
    issueCommand(state, 'red', { type: 'move', antIds: [ant.id], target: out });
    run(state, 20 * 6);
    expect(Math.hypot(ant.x - out.x, ant.y - out.y)).toBeLessThan(4);
    expect(Object.values(state.walls).every((w) => w.hp === 300)).toBe(true);
  });

  it('fully walled-in enemies chew their way out', () => {
    const state = quietGame();
    const c = openPatch(state, 12);
    ring(state, c, 'black', 20);
    const ant = createAnt(state.nextId++, 'red', 'soldier', { x: tileCenter(c.x), y: tileCenter(c.y) });
    state.ants.push(ant);
    updateFog(state);
    const out = { x: tileCenter(c.x + 3), y: tileCenter(c.y) };
    issueCommand(state, 'red', { type: 'move', antIds: [ant.id], target: out });
    run(state, 20 * 10);
    expect(Object.keys(state.walls)).toHaveLength(7);
    expect(Math.hypot(ant.x - out.x, ant.y - out.y)).toBeLessThan(4);
  });
});

describe('spiders', () => {
  it('appear after a few minutes, well away from both nests', () => {
    const state = quietGame();
    state.rules.wildlife = true;
    run(state, 20 * 60 * 3 + 1);
    expect(state.creatures.length).toBeGreaterThan(0);
    for (const s of state.creatures) {
      for (const colony of state.colonies) {
        const n = nestPoint(state, colony.id);
        expect(Math.hypot(s.x - n.x, s.y - n.y)).toBeGreaterThan(20 * 32);
      }
    }
  });

  it('hunt nearby ants, and leave a carcass when soldiers kill them', () => {
    const state = quietGame();
    state.rules.wildlife = true;
    const c = openPatch(state, 25);
    const lair = { x: tileCenter(c.x), y: tileCenter(c.y) };
    state.creatures.push({
      id: state.nextId++, kind: 'spider', ...lair, prevX: lair.x, prevY: lair.y, angle: 0,
      hp: CREATURE_STATS.spider.maxHp, path: [], moveTarget: null, blockedWall: null, cooldown: 0,
      lastAttackTick: -1, lair, prey: null, lastAttacker: null, restTimer: 0,
    });
    const victim = createAnt(state.nextId++, 'black', 'worker', { x: lair.x + 60, y: lair.y });
    state.ants.push(victim);
    run(state, 20 * 6);
    expect(state.ants.includes(victim)).toBe(false);

    const squad = Array.from({ length: 6 }, (_, i) => {
      const a = createAnt(state.nextId++, 'black', 'soldier', { x: lair.x + 50, y: lair.y - 20 + i * 8 });
      state.ants.push(a);
      return a;
    });
    updateFog(state);
    const spider = state.creatures[0];
    issueCommand(state, 'black', { type: 'attack', antIds: squad.map((a) => a.id), target: { creature: spider.id } });
    run(state, 20 * 15);
    expect(state.creatures).toHaveLength(0);
    expect(state.food.some((f) => f.kind === 'carcass')).toBe(true);
    expect(getColony(state, 'black').stats.kills).toBe(1);
  });
});

describe('save and load', () => {
  it('a JSON round-trip continues exactly like the original game', () => {
    const state = createNewGame(21, 'hard');
    const nest = getColony(state, 'black').nests[0].tile;
    issueCommand(state, 'black', { type: 'planWalls', tiles: [{ x: nest.x + 4, y: nest.y }, { x: nest.x + 4, y: nest.y - 1 }] });
    issueCommand(state, 'black', { type: 'setBuilders', count: 2 });
    run(state, 20 * 60 * 4);

    const loaded: GameState = JSON.parse(JSON.stringify(state));
    run(state, 20 * 60 * 3);
    run(loaded, 20 * 60 * 3);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(state));
  }, 60_000);
});
