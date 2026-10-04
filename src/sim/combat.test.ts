import { describe, expect, it } from 'vitest';
import { ANT_STATS, createAnt } from './ants';
import { issueCommand } from './commands';
import { updateFog } from './fog';
import { stepSimulation } from './simulation';
import { ColonyId, GameState, NEST_MAX_HP, createNewGame, getColony, nestPoint } from './state';
import { Difficulty } from './difficulty';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSimulation(state);
};
const quietGame = (seed = 5) => {
  const state = createNewGame(seed);
  state.rules = { upkeep: false, ai: false, foodRegrowth: false, wildlife: false };
  return state;
};
const own = (state: GameState, colony: ColonyId, type?: string) =>
  state.ants.filter((a) => a.colony === colony && (!type || a.type === type));

/** Drops an ant of `colony` a few pixels beside a point. */
function spawn(state: GameState, colony: ColonyId, type: 'worker' | 'soldier', at: { x: number; y: number }) {
  const ant = createAnt(state.nextId++, colony, type, at);
  state.ants.push(ant);
  updateFog(state);
  return ant;
}

describe('fighting', () => {
  it('an ordered soldier kills a worker and gets the kill', () => {
    const state = quietGame();
    const soldier = own(state, 'black', 'soldier')[0];
    const victim = spawn(state, 'red', 'worker', { x: soldier.x + 20, y: soldier.y });

    issueCommand(state, 'black', { type: 'attack', antIds: [soldier.id], target: { ant: victim.id } });
    // 10 HP at 4 per bite, one bite per second: dead within ~3 s.
    run(state, 20 * 4);

    expect(state.ants.includes(victim)).toBe(false);
    expect(getColony(state, 'black').stats.kills).toBe(1);
    expect(getColony(state, 'red').stats.losses).toBe(1);
    expect(soldier.task.kind).toBe('idle');
  });

  it('idle soldiers attack enemies that wander into range', () => {
    const state = quietGame();
    const soldier = own(state, 'black', 'soldier')[0];
    const intruder = spawn(state, 'red', 'worker', { x: soldier.x + 3 * 32, y: soldier.y });
    run(state, 20 * 6);
    expect(state.ants.includes(intruder)).toBe(false);
  });

  it('bitten idle workers fight back', () => {
    const state = quietGame();
    const worker = own(state, 'black', 'worker')[0];
    const enemy = spawn(state, 'red', 'worker', { x: worker.x + 14, y: worker.y });
    issueCommand(state, 'red', { type: 'attack', antIds: [enemy.id], target: { ant: worker.id } });
    run(state, 20 * 2);
    expect(worker.task.kind === 'attack' || enemy.hp < ANT_STATS.worker.maxHp).toBe(true);
  });

  it('cannot target enemies hidden in the fog', () => {
    const state = quietGame();
    const soldier = own(state, 'black', 'soldier')[0];
    const hidden = own(state, 'red')[0];
    issueCommand(state, 'black', { type: 'attack', antIds: [soldier.id], target: { ant: hidden.id } });
    expect(soldier.task.kind).toBe('idle');
  });

  it('self-started chases give up and return past the leash', () => {
    const state = quietGame();
    const soldier = own(state, 'black', 'soldier')[0];
    const home = { x: soldier.x, y: soldier.y };
    const runner = spawn(state, 'red', 'soldier', { x: soldier.x + 3 * 32, y: soldier.y });
    runner.hp = 1000; // too tough to kill quickly
    run(state, 10);
    expect(soldier.task.kind).toBe('attack');
    // The runner flees under a move order (so it won't turn and fight); the
    // soldier follows until the leash snaps, then walks back.
    issueCommand(state, 'red', {
      type: 'move',
      antIds: [runner.id],
      target: { x: runner.x + 25 * 32, y: runner.y },
    });
    run(state, 20 * 25);
    expect(soldier.task.kind).toBe('idle');
    expect(Math.hypot(soldier.x - home.x, soldier.y - home.y)).toBeLessThan(32);
  });
});

describe('nests and victory', () => {
  it('raiders destroy a discovered nest and win the game', () => {
    const state = quietGame();
    const red = getColony(state, 'red');
    const target = nestPoint(state, 'red');
    // Reveal the red nest and park a black strike force next to it.
    const raiders = Array.from({ length: 12 }, (_, i) =>
      spawn(state, 'black', 'soldier', { x: target.x + 40 + (i % 4) * 6, y: target.y + 40 + Math.floor(i / 4) * 6 }),
    );
    // Red's own ants are elsewhere doing nothing; keep them out of it.
    for (const a of own(state, 'red')) a.hp = 1e6;
    for (const a of own(state, 'red')) a.x = a.prevX = target.x - 30 * 32 > 0 ? target.x - 30 * 32 : target.x + 30 * 32;
    updateFog(state);

    issueCommand(state, 'black', { type: 'attack', antIds: raiders.map((a) => a.id), target: { nest: 'red' } });
    run(state, 20 * 30);

    expect(red.nestHp).toBeLessThan(NEST_MAX_HP);
    run(state, 20 * 60);
    expect(red.eliminated).toBe(true);
    expect(own(state, 'red')).toHaveLength(0);
    expect(state.winner).toBe('black');
    // The game freezes once decided.
    const tick = state.tick;
    run(state, 10);
    expect(state.tick).toBe(tick);
  });

  it('cannot raid a nest that has not been found', () => {
    const state = quietGame();
    const soldiers = own(state, 'black', 'soldier');
    issueCommand(state, 'black', { type: 'attack', antIds: soldiers.map((a) => a.id), target: { nest: 'red' } });
    expect(soldiers.every((a) => a.task.kind === 'idle')).toBe(true);
  });

  it('a colony with no ants and no food is eliminated', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    black.food = 5;
    for (const a of own(state, 'black')) a.hp = 0;
    run(state, 1);
    expect(black.eliminated).toBe(true);
    expect(state.winner).toBe('red');
  });

  it('a nest knocked to zero falls even if it was last bitten long ago', () => {
    const state = quietGame();
    const red = getColony(state, 'red');
    red.nestHp = 0;
    run(state, 1);
    expect(red.eliminated).toBe(true);
    expect(state.winner).toBe('black');
  });

  it('damaged nests regenerate after a quiet spell', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    black.nestHp = 500;
    black.lastNestHitTick = 0;
    run(state, 20 * 30);
    expect(black.nestHp).toBeGreaterThan(500);
  });
});

describe('AI aggression by difficulty', () => {
  /** Black just sits at home (well fed) while red plays normally. */
  function siege(difficulty: Difficulty, minutes: number, seed = 4) {
    const state = createNewGame(seed, difficulty);
    getColony(state, 'black').food = 1e6;
    let firstHit = -1;
    for (let t = 0; t < 20 * 60 * minutes; t++) {
      stepSimulation(state);
      const black = getColony(state, 'black');
      if (firstHit < 0 && (black.nestHp < NEST_MAX_HP || black.stats.losses > 0)) firstHit = state.tick;
      if (state.winner) break;
    }
    return { state, firstHitMinutes: firstHit < 0 ? Infinity : firstHit / (20 * 60) };
  }

  it('hard attacks early and can win against a passive player', () => {
    const { state, firstHitMinutes } = siege('hard', 16);
    expect(firstHitMinutes).toBeGreaterThanOrEqual(4);
    expect(firstHitMinutes).toBeLessThan(12);
    expect(getColony(state, 'black').stats.losses).toBeGreaterThan(0);
  }, 60_000);

  it('easy leaves the player alone for the first 10 minutes', () => {
    const { firstHitMinutes } = siege('easy', 10);
    expect(firstHitMinutes).toBe(Infinity);
  }, 60_000);
});
