import { GameMap, inBounds, isWalkable } from './map';

/**
 * Connected walkable regions. Two tiles share a region id when an ant can walk
 * between them; unwalkable tiles are -1. Used to reject unreachable move
 * targets without running a full A* search.
 *
 * Derived data, cached per map object. Call invalidateRegions() after any
 * change to map.tiles (e.g. when walls are built).
 */
const cache = new WeakMap<GameMap, Int32Array>();

export function getRegions(map: GameMap): Int32Array {
  let regions = cache.get(map);
  if (!regions) {
    regions = computeRegions(map);
    cache.set(map, regions);
  }
  return regions;
}

export function regionAt(map: GameMap, x: number, y: number): number {
  return inBounds(map, x, y) ? getRegions(map)[y * map.width + x] : -1;
}

export function invalidateRegions(map: GameMap): void {
  cache.delete(map);
}

// Pathfinding forbids diagonal corner-cutting, so 4-connectivity matches it exactly.
function computeRegions(map: GameMap): Int32Array {
  const { width, height } = map;
  const regions = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  let next = 0;

  for (let start = 0; start < regions.length; start++) {
    if (regions[start] !== -1 || !isWalkable(map, start % width, Math.floor(start / width))) continue;
    regions[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const ni = ny * width + nx;
        if (isWalkable(map, nx, ny) && regions[ni] === -1) {
          regions[ni] = next;
          stack.push(ni);
        }
      }
    }
    next++;
  }
  return regions;
}
