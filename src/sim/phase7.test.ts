import { describe, expect, it } from 'vitest';
import { createAnt } from './ants';
import { issueCommand } from './commands';
import { updateFog } from './fog';
import { foundBlocker } from './founding';
import { isWalkable, tileCenter } from './map';
import { stepSimulation } from './simulation';
import { GameState, MIN_NEST_SPACING, NEW_NEST_HP, createNewGame, getColony } from './state';
import { CHAMBER_CAPACITY, colonyCapacity, nestCapacity } from './underground';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSimulation(state);
};
const quietGame = (seed = 5) => {
  const state = createNewGame(seed);
  state.rules = { upkeep: false, ai: false, foodRegrowth: false, wildlife: false };
  return state;
};

/** Reveals the whole map for black, so founding sites aren't blocked by fog. */
function revealAll(state: GameState) {
  state.fog.black.fill(1);
  updateFog(state);
}

/** A tile black may found a nest on, as close as possible to `near` tiles from home. */
function foundingSite(state: GameState, near = MIN_NEST_SPACING + 2) {
  const home = getColony(state, 'black').nests[0].tile;
  for (let r = near; r < 60; r++) {
    for (let a = 0; a < 32; a++) {
      const x = Math.round(home.x + Math.cos((a / 32) * Math.PI * 2) * r);
      const y = Math.round(home.y + Math.sin((a / 32) * Math.PI * 2) * r);
      if (foundBlocker(state, 'black', x, y) === null) return { x, y };
    }
  }
  throw new Error('no site');
}

describe('underground', () => {
  it('starts with a queen chamber, nursery, food store and one living chamber', () => {
    const state = quietGame();
    const nest = getColony(state, 'black').nests[0];
    const kinds = nest.underground.chambers.map((c) => c.kind).sort();
    expect(kinds).toEqual(['entrance', 'food', 'living', 'nursery', 'queen']);
    expect(nestCapacity(nest.underground)).toBe(35);
  });

  it('digs new chambers automatically as the colony fills up', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    black.food = 100_000;
    const before = colonyCapacity(black);
    // Keep the nest's queue topped up with workers for a few minutes.
    for (let t = 0; t < 20 * 60 * 4; t++) {
      if (black.nests[0].queue.length < 5) issueCommand(state, 'black', { type: 'train', antType: 'worker' });
      stepSimulation(state);
    }
    expect(colonyCapacity(black)).toBeGreaterThan(before);
    expect(state.ants.filter((a) => a.colony === 'black').length).toBeGreaterThan(before - 5);
    // No chambers overlap.
    const ch = black.nests[0].underground.chambers;
    for (let i = 0; i < ch.length; i++) {
      for (let j = i + 1; j < ch.length; j++) {
        expect(Math.hypot((ch[i].x - ch[j].x) / 1.5, ch[i].y - ch[j].y)).toBeGreaterThan(ch[i].r + ch[j].r);
      }
    }
  });

  it('a full colony cannot queue more ants until it digs', () => {
    const state = quietGame();
    const black = getColony(state, 'black');
    black.food = 10_000;
    const home = black.nests[0];
    while (state.ants.filter((a) => a.colony === 'black').length < colonyCapacity(black)) {
      state.ants.push(createAnt(state.nextId++, 'black', 'worker', { x: tileCenter(home.tile.x), y: tileCenter(home.tile.y) }));
    }
    issueCommand(state, 'black', { type: 'train', antType: 'worker' });
    expect(home.queue).toHaveLength(0);
    expect(home.underground.dig).toBeNull();
    run(state, 1);
    expect(home.underground.dig).not.toBeNull();
  });
});

describe('founding nests', () => {
  it('a queen walks to a valid site and becomes a new nest', () => {
    const state = quietGame();
    revealAll(state);
    const black = getColony(state, 'black');
    const home = black.nests[0];
    const queen = createAnt(state.nextId++, 'black', 'queen', { x: tileCenter(home.tile.x) + 40, y: tileCenter(home.tile.y) });
    state.ants.push(queen);
    const site = foundingSite(state);

    issueCommand(state, 'black', { type: 'found', antId: queen.id, target: { x: tileCenter(site.x), y: tileCenter(site.y) } });
    expect(queen.task.kind).toBe('found');
    run(state, 20 * 60);

    expect(black.nests).toHaveLength(2);
    const nest = black.nests[1];
    expect(nest.tile).toEqual(site);
    expect(nest.hp).toBeGreaterThanOrEqual(NEW_NEST_HP);
    expect(nest.underground.chambers.map((c) => c.kind)).toEqual(['entrance', 'queen']);
    expect(colonyCapacity(black)).toBe(35 + CHAMBER_CAPACITY.queen);
    expect(state.ants.includes(queen)).toBe(false);
    expect(black.stats.losses).toBe(0);
  });

  it('rejects sites near any nest, unexplored ground and blocked tiles', () => {
    const state = quietGame();
    const home = getColony(state, 'black').nests[0].tile;
    const red = getColony(state, 'red').nests[0].tile;
    expect(foundBlocker(state, 'black', home.x + 5, home.y)).toBe('Too close to a nest');
    expect(foundBlocker(state, 'black', red.x + 20, red.y)).not.toBeNull();
    revealAll(state);
    let rock = { x: -1, y: -1 };
    for (let i = 0; i < state.map.tiles.length && rock.x < 0; i++) {
      if (!isWalkable(state.map, i % state.map.width, Math.floor(i / state.map.width))) {
        rock = { x: i % state.map.width, y: Math.floor(i / state.map.width) };
      }
    }
    expect(foundBlocker(state, 'black', rock.x, rock.y)).toBe('Not open ground');
  });

  it('workers drop food at the nearest nest', () => {
    const state = quietGame();
    revealAll(state);
    const black = getColony(state, 'black');
    const site = foundingSite(state);
    black.nests.push({ ...black.nests[0], id: state.nextId++, tile: site, queue: [], rally: null });
    const worker = createAnt(state.nextId++, 'black', 'worker', { x: tileCenter(site.x) + 10, y: tileCenter(site.y) });
    worker.carrying = 5;
    state.ants.push(worker);
    const before = black.food;
    run(state, 2);
    expect(black.food).toBe(before + 5);
  });

  it('losing one nest is survivable; losing the last one is not', () => {
    const state = quietGame();
    revealAll(state);
    const black = getColony(state, 'black');
    const site = foundingSite(state);
    black.nests.push({ ...black.nests[0], id: state.nextId++, tile: site, queue: [], rally: null });

    black.nests[0].hp = 0;
    run(state, 1);
    expect(black.eliminated).toBe(false);
    expect(black.nests).toHaveLength(1);
    expect(state.ruins).toHaveLength(1);

    black.nests[0].hp = 0;
    run(state, 1);
    expect(black.eliminated).toBe(true);
    expect(state.winner).toBe('red');
  });
});

describe('AI expansion', () => {
  it('hard AI founds extra nests on its own', () => {
    const state = createNewGame(5, 'hard');
    getColony(state, 'black').food = 1e6;
    run(state, 20 * 60 * 9);
    expect(getColony(state, 'red').nests.length).toBeGreaterThan(1);
  }, 60_000);

  it('easy AI never expands', () => {
    const state = createNewGame(5, 'easy');
    getColony(state, 'black').food = 1e6;
    run(state, 20 * 60 * 10);
    expect(getColony(state, 'red').nests).toHaveLength(1);
  }, 60_000);
});
