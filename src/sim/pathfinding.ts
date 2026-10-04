import { GameMap, Point, TilePos, isWalkable, isWalkableWorld } from './map';
import { regionAt } from './regions';

export interface PathResult {
  /** Tiles from start to goal inclusive, or null when unreachable. */
  tiles: TilePos[] | null;
  /** Nodes expanded; callers use this to budget pathfinding work per tick. */
  expanded: number;
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** A* over the tile grid with 8-way movement and no diagonal corner-cutting. */
export function findPath(map: GameMap, start: TilePos, goal: TilePos): PathResult {
  if (!isWalkable(map, start.x, start.y) || !isWalkable(map, goal.x, goal.y)) {
    return { tiles: null, expanded: 0 };
  }
  if (regionAt(map, start.x, start.y) !== regionAt(map, goal.x, goal.y)) {
    return { tiles: null, expanded: 0 };
  }

  const { width } = map;
  const size = width * map.height;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();

  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  gScore[startIdx] = 0;
  open.push(startIdx, octile(start.x, start.y, goal.x, goal.y));
  let expanded = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    if (current === goalIdx) return { tiles: reconstruct(cameFrom, current, width), expanded };
    closed[current] = 1;
    expanded++;

    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, cx + dx, cy) || !isWalkable(map, cx, cy + dy))) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      const g = gScore[current] + cost;
      if (g < gScore[ni]) {
        gScore[ni] = g;
        cameFrom[ni] = current;
        open.push(ni, g + octile(nx, ny, goal.x, goal.y));
      }
    }
  }
  return { tiles: null, expanded };
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function reconstruct(cameFrom: Int32Array, end: number, width: number): TilePos[] {
  const path: TilePos[] = [];
  for (let i = end; i !== -1; i = cameFrom[i]) {
    path.push({ x: i % width, y: Math.floor(i / width) });
  }
  return path.reverse();
}

/**
 * True when a body of the given radius can travel in a straight line from a
 * to b without touching unwalkable tiles. Samples the centre line and both
 * edges of the swept body every few pixels.
 */
export function hasLineOfSight(map: GameMap, a: Point, b: Point, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return isWalkableWorld(map, a.x, a.y);
  const nx = (-dy / len) * radius;
  const ny = (dx / len) * radius;
  const steps = Math.ceil(len / 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    if (
      !isWalkableWorld(map, px, py) ||
      !isWalkableWorld(map, px + nx, py + ny) ||
      !isWalkableWorld(map, px - nx, py - ny)
    ) {
      return false;
    }
  }
  return true;
}

/** Removes waypoints that can be skipped with a straight line ("string pulling"). */
export function smoothPath(map: GameMap, points: Point[], radius: number): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let j = points.length - 1; j > anchor + 1; j--) {
      if (hasLineOfSight(map, points[anchor], points[j], radius)) {
        next = j;
        break;
      }
    }
    out.push(points[next]);
    anchor = next;
  }
  return out;
}

class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, prio: number): void {
    const { items, prios } = this;
    let i = items.length;
    items.push(item);
    prios.push(prio);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prios[parent] <= prio) break;
      items[i] = items[parent];
      prios[i] = prios[parent];
      i = parent;
    }
    items[i] = item;
    prios[i] = prio;
  }

  pop(): number {
    const { items, prios } = this;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastPrio = prios.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && prios[r] < prios[l] ? r : l;
        if (prios[c] >= lastPrio) break;
        items[i] = items[c];
        prios[i] = prios[c];
        i = c;
      }
      items[i] = lastItem;
      prios[i] = lastPrio;
    }
    return top;
  }
}
