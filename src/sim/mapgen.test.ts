import { describe, expect, it } from 'vitest';
import { isWalkable } from './map';
import { createNewGame } from './state';

describe('createNewGame', () => {
  it('is deterministic for a given seed', () => {
    expect(JSON.stringify(createNewGame(12345))).toBe(JSON.stringify(createNewGame(12345)));
  });

  it('produces different maps for different seeds', () => {
    expect(createNewGame(1).map.tiles).not.toEqual(createNewGame(2).map.tiles);
  });

  it('places every nest on walkable ground', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { map, colonies } = createNewGame(seed);
      for (const c of colonies) expect(isWalkable(map, c.nests[0].tile.x, c.nests[0].tile.y)).toBe(true);
    }
  });
});
