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

/**
 * A* over the tile grid with 8-way movement and no diagonal corner-cutting.
 * `extraCost(tileIndex)` adds a per-tile penalty (e.g. chewing through walls).
 */
export function findPath(
  map: GameMap,
  start: TilePos,
  goal: TilePos,
  extraCost?: (tile: number) => number,
): PathResult {
  if (!isWalkable(map, start.x, start.y) || !isWalkable(map, goal.x, goal.y)) {
    return { tiles: null, expanded: 0 };
  }
  if (regionAt(map, start.x, start.y) !== regionAt(map, goal.x, goal.y)) {
    return { tiles: null, expanded: 0 };
  }

  const { width } = map;
  const { gScore, cameFrom, opened, closed, gen } = scratchFor(width * map.height);
  const open = new MinHeap();
  // Scratch arrays are shared between searches; a slot only counts as set
  // when its stamp matches this search's generation.
  const g = (i: number) => (opened[i] === gen ? gScore[i] : Infinity);

  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  gScore[startIdx] = 0;
  cameFrom[startIdx] = -1;
  opened[startIdx] = gen;
  open.push(startIdx, octile(start.x, start.y, goal.x, goal.y));
  let expanded = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current] === gen) continue;
    if (current === goalIdx) return { tiles: reconstruct(cameFrom, current, width), expanded };
    closed[current] = gen;
    expanded++;

    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, cx + dx, cy) || !isWalkable(map, cx, cy + dy))) continue;
      const ni = ny * width + nx;
      if (closed[ni] === gen) continue;
      const tentative = gScore[current] + cost + (extraCost ? extraCost(ni) : 0);
      if (tentative < g(ni)) {
        gScore[ni] = tentative;
        cameFrom[ni] = current;
        opened[ni] = gen;
        open.push(ni, tentative + octile(nx, ny, goal.x, goal.y));
      }
    }
  }
  return { tiles: null, expanded };
}

interface Scratch {
  gScore: Float64Array;
  cameFrom: Int32Array;
  opened: Uint32Array;
  closed: Uint32Array;
  gen: number;
}
let scratch: Scratch | null = null;

/** Reusable search arrays, so pathfinding doesn't allocate (and trigger GC) per request. */
function scratchFor(size: number): Scratch {
  if (!scratch || scratch.gScore.length !== size || scratch.gen >= 0xfffffff0) {
    scratch = {
      gScore: new Float64Array(size),
      cameFrom: new Int32Array(size),
      opened: new Uint32Array(size),
      closed: new Uint32Array(size),
      gen: 0,
    };
  }
  scratch.gen++;
  return scratch;
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
export function hasLineOfSight(
  map: GameMap,
  a: Point,
  b: Point,
  radius: number,
  blocked?: (px: number, py: number) => boolean,
): boolean {
  const open = (px: number, py: number) => isWalkableWorld(map, px, py) && !blocked?.(px, py);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return open(a.x, a.y);
  const nx = (-dy / len) * radius;
  const ny = (dx / len) * radius;
  const steps = Math.ceil(len / 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    if (!open(px, py) || !open(px + nx, py + ny) || !open(px - nx, py - ny)) {
      return false;
    }
  }
  return true;
}

/** How many waypoints ahead smoothing looks for a shortcut; bounds its cost on long paths. */
const SMOOTH_LOOKAHEAD = 10;

/** Removes waypoints that can be skipped with a straight line ("string pulling"). */
export function smoothPath(
  map: GameMap,
  points: Point[],
  radius: number,
  blocked?: (px: number, py: number) => boolean,
): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let j = Math.min(points.length - 1, anchor + SMOOTH_LOOKAHEAD); j > anchor + 1; j--) {
      if (hasLineOfSight(map, points[anchor], points[j], radius, blocked)) {
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
