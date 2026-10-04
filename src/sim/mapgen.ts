import { Rng } from './rng';
import { GameMap, Terrain, TilePos, inBounds, isWalkable } from './map';

export interface GeneratedWorld {
  map: GameMap;
  /** Nest locations, one per colony. Index 0 is the player. */
  nestSites: TilePos[];
}

/**
 * Builds a random backyard from a seed. Placeholder algorithm: scattered
 * blobs of dirt, water, rock and holes on grass. Swap for noise-based
 * generation later without changing the GeneratedWorld contract.
 */
export function generateWorld(seed: number, width: number, height: number): GeneratedWorld {
  const rng = new Rng(seed);
  const map: GameMap = { width, height, tiles: new Array(width * height).fill(Terrain.Grass) };

  const area = width * height;
  scatterBlobs(map, rng, Terrain.Dirt, Math.round(area / 900), 3, 7);
  scatterBlobs(map, rng, Terrain.Water, Math.round(area / 2500), 3, 6);
  scatterBlobs(map, rng, Terrain.Rock, Math.round(area / 1200), 1, 3);
  scatterBlobs(map, rng, Terrain.Hole, Math.round(area / 4000), 1, 2);

  const nestSites = pickNestSites(map, rng, 2);
  for (const site of nestSites) {
    paintCircle(map, site.x, site.y, 4, Terrain.Dirt);
  }

  return { map, nestSites };
}

function scatterBlobs(
  map: GameMap,
  rng: Rng,
  terrain: Terrain,
  count: number,
  minRadius: number,
  maxRadius: number,
): void {
  for (let i = 0; i < count; i++) {
    const cx = rng.int(0, map.width - 1);
    const cy = rng.int(0, map.height - 1);
    // A few overlapping circles per blob gives irregular shapes.
    const lobes = rng.int(1, 4);
    for (let l = 0; l < lobes; l++) {
      const ox = cx + rng.int(-maxRadius, maxRadius);
      const oy = cy + rng.int(-maxRadius, maxRadius);
      paintCircle(map, ox, oy, rng.int(minRadius, maxRadius), terrain);
    }
  }
}

function paintCircle(map: GameMap, cx: number, cy: number, r: number, terrain: Terrain): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (inBounds(map, x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        map.tiles[y * map.width + x] = terrain;
      }
    }
  }
}

/** Picks walkable sites away from the edges and as far apart as practical. */
function pickNestSites(map: GameMap, rng: Rng, count: number): TilePos[] {
  const margin = 10;
  const minSeparation = Math.min(map.width, map.height) * 0.5;
  const sites: TilePos[] = [];

  for (let attempt = 0; attempt < 5000 && sites.length < count; attempt++) {
    const candidate = {
      x: rng.int(margin, map.width - 1 - margin),
      y: rng.int(margin, map.height - 1 - margin),
    };
    if (!isWalkable(map, candidate.x, candidate.y)) continue;
    const farEnough = sites.every(
      (s) => Math.hypot(s.x - candidate.x, s.y - candidate.y) >= minSeparation,
    );
    if (farEnough) sites.push(candidate);
  }

  // Fallback for pathological maps: opposite corners (nest painting clears them).
  while (sites.length < count) {
    sites.push(
      sites.length === 0
        ? { x: margin, y: margin }
        : { x: map.width - 1 - margin, y: map.height - 1 - margin },
    );
  }
  return sites;
}
