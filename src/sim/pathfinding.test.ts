import { describe, expect, it } from 'vitest';
import { GameMap, Terrain, isWalkable } from './map';
import { findPath, hasLineOfSight } from './pathfinding';

/** Builds a map from rows of characters: '.' grass, '#' rock, '~' water. */
function mapFrom(rows: string[]): GameMap {
  const chars: Record<string, Terrain> = { '.': Terrain.Grass, '#': Terrain.Rock, '~': Terrain.Water };
  return {
    width: rows[0].length,
    height: rows.length,
    tiles: rows.flatMap((r) => [...r].map((c) => chars[c])),
  };
}

describe('findPath', () => {
  it('routes around obstacles', () => {
    const map = mapFrom([
      '.....',
      '.###.',
      '.#...',
      '.#.#.',
      '.....',
    ]);
    const { tiles } = findPath(map, { x: 0, y: 4 }, { x: 2, y: 2 });
    expect(tiles).not.toBeNull();
    expect(tiles![0]).toEqual({ x: 0, y: 4 });
    expect(tiles![tiles!.length - 1]).toEqual({ x: 2, y: 2 });
    for (const t of tiles!) expect(isWalkable(map, t.x, t.y)).toBe(true);
  });

  it('never cuts diagonally between two blocked corners', () => {
    const map = mapFrom([
      '.#',
      '#.',
    ]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 }).tiles).toBeNull();
  });

  it('returns null for unreachable or unwalkable goals without searching', () => {
    const map = mapFrom([
      '..~..',
      '..~..',
      '..~..',
    ]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual({ tiles: null, expanded: 0 });
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 1 })).toEqual({ tiles: null, expanded: 0 });
  });
});

describe('hasLineOfSight', () => {
  const map = mapFrom([
    '....',
    '.#..',
    '....',
  ]);

  it('is blocked by an obstacle on the line', () => {
    expect(hasLineOfSight(map, { x: 16, y: 48 }, { x: 112, y: 48 }, 0)).toBe(false);
  });

  it('is clear along an open row', () => {
    expect(hasLineOfSight(map, { x: 16, y: 16 }, { x: 112, y: 16 }, 4)).toBe(true);
  });
});
