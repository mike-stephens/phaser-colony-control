import { describe, expect, it } from 'vitest';
import { issueCommand } from './commands';
import { isWalkableWorld } from './map';
import { stepSimulation } from './simulation';
import { createNewGame } from './state';

describe('starting ants', () => {
  it('spawns both colonies on walkable ground', () => {
    for (let seed = 0; seed < 20; seed++) {
      const state = createNewGame(seed);
      expect(state.ants.filter((a) => a.colony === 'black')).toHaveLength(15);
      expect(state.ants.filter((a) => a.colony === 'red')).toHaveLength(15);
      for (const a of state.ants) expect(isWalkableWorld(state.map, a.x, a.y)).toBe(true);
    }
  });
});

describe('move command', () => {
  it('walks the group to the enemy nest without crossing obstacles', () => {
    const state = createNewGame(12345);
    const black = state.ants.filter((a) => a.colony === 'black');
    const red = state.colonies.find((c) => c.id === 'red')!;
    const target = { x: (red.nest.x + 0.5) * 32, y: (red.nest.y + 0.5) * 32 };

    issueCommand(state, 'black', { type: 'move', antIds: black.map((a) => a.id), target });
    for (let i = 0; i < 20 * 300; i++) {
      stepSimulation(state);
      for (const a of black) expect(isWalkableWorld(state.map, a.x, a.y)).toBe(true);
      if (black.every((a) => a.path.length === 0 && !a.moveTarget)) break;
    }

    for (const a of black) expect(Math.hypot(a.x - target.x, a.y - target.y)).toBeLessThan(120);
  });

  it('ignores ants that belong to another colony', () => {
    const state = createNewGame(1);
    const red = state.ants.filter((a) => a.colony === 'red');
    issueCommand(state, 'black', { type: 'move', antIds: red.map((a) => a.id), target: { x: 100, y: 100 } });
    expect(red.every((a) => a.moveTarget === null)).toBe(true);
  });
});
