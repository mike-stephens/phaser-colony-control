import { GameMap, Point, TilePos, inBounds, isWalkableWorld, tileCenter, worldToTile } from './map';
import { regionAt } from './regions';

/** Distance between neighbouring ants in a formation, in world pixels. */
const SLOT_SPACING = 16;
/** Clearance kept between a slot and unwalkable terrain. */
const SLOT_CLEARANCE = 6;
const MAX_RINGS = 30;

/**
 * Returns `count` standing positions packed in rings around `target`, all
 * inside `region`. Nearest-to-target first. If the target itself is not in the
 * region (e.g. the player clicked on a pond), the rings are centred on the
 * nearest tile that is.
 */
export function formationSlots(map: GameMap, target: Point, count: number, region: number): Point[] {
  const centreTile = nearestTileInRegion(map, { x: worldToTile(target.x), y: worldToTile(target.y) }, region);
  if (!centreTile) return [];

  const centre =
    regionAt(map, worldToTile(target.x), worldToTile(target.y)) === region
      ? target
      : { x: tileCenter(centreTile.x), y: tileCenter(centreTile.y) };

  const slots: Point[] = [];
  for (let ring = 0; ring <= MAX_RINGS && slots.length < count; ring++) {
    const radius = ring * SLOT_SPACING;
    const around = ring === 0 ? 1 : Math.floor((2 * Math.PI * ring * SLOT_SPACING) / SLOT_SPACING);
    for (let k = 0; k < around && slots.length < count; k++) {
      const a = (k / around) * 2 * Math.PI + ring * 0.5;
      const p = { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius };
      if (isGoodSlot(map, p, region)) slots.push(p);
    }
  }
  return slots;
}

function isGoodSlot(map: GameMap, p: Point, region: number): boolean {
  const c = SLOT_CLEARANCE;
  return (
    regionAt(map, worldToTile(p.x), worldToTile(p.y)) === region &&
    isWalkableWorld(map, p.x + c, p.y) &&
    isWalkableWorld(map, p.x - c, p.y) &&
    isWalkableWorld(map, p.x, p.y + c) &&
    isWalkableWorld(map, p.x, p.y - c)
  );
}

/** Breadth-first search outward from `from` for the closest tile in `region`. */
export function nearestTileInRegion(map: GameMap, from: TilePos, region: number): TilePos | null {
  const start = {
    x: Math.min(Math.max(from.x, 0), map.width - 1),
    y: Math.min(Math.max(from.y, 0), map.height - 1),
  };
  const seen = new Uint8Array(map.width * map.height);
  const queue: TilePos[] = [start];
  seen[start.y * map.width + start.x] = 1;
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    if (regionAt(map, t.x, t.y) === region) return t;
    for (const [nx, ny] of [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]]) {
      if (inBounds(map, nx, ny) && !seen[ny * map.width + nx]) {
        seen[ny * map.width + nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return null;
}

