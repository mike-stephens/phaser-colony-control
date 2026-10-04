import { describe, expect, it } from 'vitest';
import { issueCommand } from './commands';
import { ANT_COST, POPULATION_CAP, UPKEEP_INTERVAL_TICKS, upkeepDue } from './economy';
import { createAnt } from './ants';
import { stepSimulation } from './simulation';
import { GameState, STARTING_FOOD, createNewGame, getColony, nestPoint } from './state';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSimulation(state);
};
const quietGame = (seed = 5) => {
  const state = createNewGame(seed);
  state.rules = { upkeep: false, ai: false, foodRegrowth: false };
  return state;
};
const count = (state: GameState, colony: 'black' | 'red', type?: string) =>
  state.ants.filter((a) => a.colony === colony && (!type || a.type === type)).length;

describe('training', () => {
  it('charges food up front and hatches the ant after its training time', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    issueCommand(state, 'black', { type: 'train', antType: 'worker' });
    expect(black.food).toBe(STARTING_FOOD - ANT_COST.worker.food);
    expect(black.queue).toEqual(['worker']);

    run(state, ANT_COST.worker.ticks);
    expect(count(state, 'black', 'worker')).toBe(10);
    run(state, 2);
    expect(count(state, 'black', 'worker')).toBe(11);
    expect(black.queue).toEqual([]);

    const hatchling = state.ants[state.ants.length - 1];
    const nest = nestPoint(state, 'black');
    expect(Math.hypot(hatchling.x - nest.x, hatchling.y - nest.y)).toBeLessThan(40);
  });

  it('walks hatchlings to the rally point', () => {
    const state = quietGame();
    const nest = nestPoint(state, 'black');
    const rally = { x: nest.x + 100, y: nest.y };
    issueCommand(state, 'black', { type: 'setRally', target: rally });
    issueCommand(state, 'black', { type: 'train', antType: 'worker' });
    run(state, ANT_COST.worker.ticks + 20 * 5);
    const hatchling = state.ants[state.ants.length - 1];
    expect(Math.hypot(hatchling.x - rally.x, hatchling.y - rally.y)).toBeLessThan(2);
  });

  it('refuses orders it cannot afford and refunds cancellations', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    black.food = 50;
    issueCommand(state, 'black', { type: 'train', antType: 'queen' });
    expect(black.queue).toEqual([]);
    expect(black.food).toBe(50);

    issueCommand(state, 'black', { type: 'train', antType: 'soldier' });
    issueCommand(state, 'black', { type: 'train', antType: 'worker' });
    expect(black.food).toBe(15);
    issueCommand(state, 'black', { type: 'cancelTraining', index: 0 });
    expect(black.queue).toEqual(['worker']);
    expect(black.food).toBe(40);
  });

  it('respects the population cap', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    black.food = 10_000;
    while (count(state, 'black') < POPULATION_CAP - 1) {
      state.ants.push(createAnt(state.nextId++, 'black', 'worker', nestPoint(state, 'black')));
    }
    issueCommand(state, 'black', { type: 'train', antType: 'worker' });
    issueCommand(state, 'black', { type: 'train', antType: 'worker' });
    expect(black.queue).toHaveLength(1);
  });
});

describe('upkeep', () => {
  it('feeds every ant from the store each interval', () => {
    const state = quietGame();
    state.rules.upkeep = true;
    const black = getColony(state, 'black');
    const due = upkeepDue(state, 'black');
    expect(due).toBe(10 * 1 + 5 * 2);
    run(state, UPKEEP_INTERVAL_TICKS);
    expect(black.food).toBe(STARTING_FOOD - due);
    expect(black.starving).toBe(false);
  });

  it('starves unfed ants to death after three missed meals, soldiers first', () => {
    const state = quietGame();
    state.rules.upkeep = true;
    const black = getColony(state, 'black');
    black.food = 10; // enough for the 10 workers, nothing for soldiers

    run(state, UPKEEP_INTERVAL_TICKS);
    expect(black.starving).toBe(true);
    expect(count(state, 'black', 'soldier')).toBe(5);
    expect(count(state, 'black', 'worker')).toBe(10);

    black.food = 1000;
    run(state, UPKEEP_INTERVAL_TICKS);
    expect(black.starving).toBe(false);

    black.food = 0;
    run(state, UPKEEP_INTERVAL_TICKS * 4);
    expect(count(state, 'black')).toBe(0);
  });
});

describe('AI economy', () => {
  it('keeps the red colony fed and growing on its own', () => {
    const state = createNewGame(11);
    const red = getColony(state, 'red');
    run(state, 20 * 60 * 4); // four minutes
    expect(red.starving).toBe(false);
    expect(count(state, 'red')).toBeGreaterThan(15);
    expect(state.ants.some((a) => a.colony === 'red' && a.task.kind === 'gather')).toBe(true);
  });
});
