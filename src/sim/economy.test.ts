import { describe, expect, it } from 'vitest';
import { gatherersOf, issueCommand } from './commands';
import { isExploredBy, isVisibleTo } from './fog';
import { worldToTile } from './map';
import { stepSimulation } from './simulation';
import { GameState, createNewGame, getColony, nestPoint } from './state';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSimulation(state);
};
/** A game with upkeep and AI switched off, so food totals are exact. */
const quietGame = (seed: number) => {
  const state = createNewGame(seed);
  state.rules = { upkeep: false, ai: false, foodRegrowth: false, wildlife: false };
  return state;
};
const workersOf = (state: GameState) => state.ants.filter((a) => a.colony === 'black' && a.type === 'worker');

/** The closest food source to the black nest; mapgen guarantees one nearby. */
function nearestFood(state: GameState) {
  const nest = nestPoint(state, 'black');
  return [...state.food].sort(
    (a, b) => Math.hypot(a.x - nest.x, a.y - nest.y) - Math.hypot(b.x - nest.x, b.y - nest.y),
  )[0];
}

describe('map generation', () => {
  it('places starter food near each nest and food elsewhere', () => {
    for (let seed = 0; seed < 20; seed++) {
      const state = createNewGame(seed);
      expect(state.food.length).toBeGreaterThan(10);
      for (const colony of state.colonies) {
        const nest = nestPoint(state, colony.id);
        const near = state.food.filter((f) => Math.hypot(f.x - nest.x, f.y - nest.y) <= 8 * 32);
        expect(near.length).toBeGreaterThanOrEqual(1);
        for (const f of near) expect(isExploredBy(state, colony.id, worldToTile(f.x), worldToTile(f.y))).toBe(true);
      }
    }
  });
});

describe('fog of war', () => {
  it('starts with only the area around each nest explored', () => {
    const state = createNewGame(7);
    const black = getColony(state, 'black').nest;
    const red = getColony(state, 'red').nest;
    expect(isExploredBy(state, 'black', black.x, black.y)).toBe(true);
    expect(isExploredBy(state, 'black', red.x, red.y)).toBe(false);
    expect(isVisibleTo(state, 'red', red.x, red.y)).toBe(true);
  });

  it('explore orders reveal the target area', () => {
    const state = createNewGame(7);
    const nest = getColony(state, 'black').nest;
    const target = { x: (nest.x + 14) * 32, y: nest.y * 32 };
    const tx = worldToTile(target.x);
    const ty = worldToTile(target.y);
    const before = isExploredBy(state, 'black', tx, ty);

    issueCommand(state, 'black', { type: 'explore', antIds: workersOf(state).map((a) => a.id), target });
    run(state, 20 * 60);

    expect(before).toBe(false);
    let explored = 0;
    let total = 0;
    for (let y = ty - 5; y <= ty + 5; y++) {
      for (let x = tx - 5; x <= tx + 5; x++) {
        total++;
        if (isExploredBy(state, 'black', x, y)) explored++;
      }
    }
    expect(explored / total).toBeGreaterThan(0.8);
    // Explorers go idle once there is nothing left to uncover.
    expect(workersOf(state).every((a) => a.task.kind === 'idle')).toBe(true);
  });
});

describe('gathering', () => {
  it('moves food from a source into the colony store', () => {
    const state = quietGame(3);
    const food = nearestFood(state);
    const startAmount = food.amount;
    const startStore = getColony(state, 'black').food;

    issueCommand(state, 'black', { type: 'setGatherers', foodId: food.id, count: 3 });
    expect(gatherersOf(state, 'black', food.id)).toHaveLength(3);
    run(state, 20 * 45);

    const gathered = startAmount - (state.food.find((f) => f.id === food.id)?.amount ?? 0);
    const inHand = workersOf(state).reduce((sum, a) => sum + a.carrying, 0);
    expect(gathered).toBeGreaterThan(0);
    expect(getColony(state, 'black').food - startStore + inHand).toBe(gathered);
  });

  it('setGatherers lowers the count and sends the extras home', () => {
    const state = createNewGame(3);
    const food = nearestFood(state);
    issueCommand(state, 'black', { type: 'setGatherers', foodId: food.id, count: 5 });
    issueCommand(state, 'black', { type: 'setGatherers', foodId: food.id, count: 2 });
    expect(gatherersOf(state, 'black', food.id)).toHaveLength(2);
    expect(workersOf(state).filter((a) => a.task.kind === 'idle')).toHaveLength(8);
  });

  it('refuses to gather food the colony has never seen', () => {
    const state = createNewGame(3);
    const hidden = state.food.find((f) => !isExploredBy(state, 'black', worldToTile(f.x), worldToTile(f.y)))!;
    issueCommand(state, 'black', { type: 'setGatherers', foodId: hidden.id, count: 3 });
    expect(gatherersOf(state, 'black', hidden.id)).toHaveLength(0);
  });

  it('removes a source when it is used up and stops its gatherers', () => {
    const state = quietGame(3);
    const food = nearestFood(state);
    food.amount = 10;
    food.max = 10;
    // Make sure no other known source is close enough to switch to.
    state.food = [food];
    issueCommand(state, 'black', { type: 'setGatherers', foodId: food.id, count: 4 });
    run(state, 20 * 60);
    expect(state.food).toHaveLength(0);
    expect(getColony(state, 'black').food).toBe(110);
    expect(workersOf(state).every((a) => a.task.kind === 'idle' && a.carrying === 0)).toBe(true);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed and orders', () => {
    const play = () => {
      const state = createNewGame(99);
      issueCommand(state, 'black', {
        type: 'explore',
        antIds: workersOf(state).map((a) => a.id),
        target: { x: 2000, y: 2000 },
      });
      run(state, 400);
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });
});
