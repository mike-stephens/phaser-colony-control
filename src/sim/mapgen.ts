import { Rng } from './rng';
import { FOOD_AMOUNTS, FoodKind } from './food';
import { GameMap, Terrain, TilePos, inBounds, isWalkable } from './map';

export interface FoodSite {
  tile: TilePos;
  kind: FoodKind;
  amount: number;
}

export interface PebbleSite {
  tile: TilePos;
  amount: number;
}

export interface GeneratedWorld {
  map: GameMap;
  /** Nest locations, one per colony. Index 0 is the player. */
  nestSites: TilePos[];
  foodSites: FoodSite[];
  pebbleSites: PebbleSite[];
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

  const foodSites = placeFood(map, rng, nestSites);
  const pebbleSites = placePebbles(map, rng, nestSites, foodSites.map((f) => f.tile));
  return { map, nestSites, foodSites, pebbleSites };
}

/**
 * Pebble piles: one guaranteed in view of each nest, the rest scattered
 * beside rocks (where pebbles would naturally collect).
 */
function placePebbles(map: GameMap, rng: Rng, nests: TilePos[], taken: TilePos[]): PebbleSite[] {
  const sites: PebbleSite[] = [];
  const used = () => [...taken, ...sites.map((s) => s.tile)];
  const clear = (t: TilePos) =>
    isWalkable(map, t.x, t.y) && used().every((u) => Math.hypot(u.x - t.x, u.y - t.y) >= 3);

  for (const nest of nests) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const a = rng.next() * Math.PI * 2;
      const r = rng.int(4, 6);
      const t = { x: Math.round(nest.x + Math.cos(a) * r), y: Math.round(nest.y + Math.sin(a) * r) };
      if (clear(t)) {
        sites.push({ tile: t, amount: rng.int(40, 60) });
        break;
      }
    }
  }

  const target = sites.length + Math.round((map.width * map.height) / 900);
  for (let attempt = 0; attempt < 4000 && sites.length < target; attempt++) {
    const t = { x: rng.int(2, map.width - 3), y: rng.int(2, map.height - 3) };
    const besideRock = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
      ([dx, dy]) => inBounds(map, t.x + dx, t.y + dy) && map.tiles[(t.y + dy) * map.width + t.x + dx] === Terrain.Rock,
    );
    if (besideRock && clear(t) && nests.every((n) => Math.hypot(n.x - t.x, n.y - t.y) >= 8)) {
      sites.push({ tile: t, amount: rng.int(25, 50) });
    }
  }
  return sites;
}

const FOOD_KINDS: FoodKind[] = ['crumbs', 'seeds', 'berries'];
/** Food sources guaranteed close to each nest, so neither side starts starved. */
const STARTER_FOOD_PER_NEST = 2;

function placeFood(map: GameMap, rng: Rng, nests: TilePos[]): FoodSite[] {
  const sites: FoodSite[] = [];
  const dist = (a: TilePos, b: TilePos) => Math.hypot(a.x - b.x, a.y - b.y);
  const open = (t: TilePos) =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => isWalkable(map, t.x + dx, t.y + dy));
  const add = (tile: TilePos, kind: FoodKind) => {
    const [min, max] = FOOD_AMOUNTS[kind];
    sites.push({ tile, kind, amount: rng.int(min, max) });
  };

  for (const nest of nests) {
    let placed = 0;
    for (let attempt = 0; attempt < 500 && placed < STARTER_FOOD_PER_NEST; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      // Within NEST_SIGHT so the player can see their first food from the start.
      const r = rng.int(5, 7);
      const tile = { x: Math.round(nest.x + Math.cos(angle) * r), y: Math.round(nest.y + Math.sin(angle) * r) };
      if (open(tile) && sites.every((s) => dist(s.tile, tile) >= 4)) {
        add(tile, placed === 0 ? 'crumbs' : 'seeds');
        placed++;
      }
    }
  }

  const target = sites.length + foodSourceTarget(map);
  for (let attempt = 0; attempt < 200 && sites.length < target; attempt++) {
    const tile = findFoodSpot(map, rng, nests, sites.map((s) => s.tile));
    if (tile) add(tile, rng.pick(FOOD_KINDS));
  }
  return sites;
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

/** Roughly how many food sources a map of this size should hold away from the nests. */
export function foodSourceTarget(map: GameMap): number {
  return Math.round((map.width * map.height) / 600);
}

/**
 * A random open tile away from nests and existing food, or null if a few tries
 * fail. Shared by map generation and food regrowth during play.
 */
export function findFoodSpot(map: GameMap, rng: Rng, nests: TilePos[], existing: TilePos[]): TilePos | null {
  const dist = (a: TilePos, b: TilePos) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let attempt = 0; attempt < 25; attempt++) {
    const tile = { x: rng.int(2, map.width - 3), y: rng.int(2, map.height - 3) };
    const open = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) =>
      isWalkable(map, tile.x + dx, tile.y + dy),
    );
    if (open && nests.every((n) => dist(n, tile) >= 10) && existing.every((e) => dist(e, tile) >= 6)) {
      return tile;
    }
  }
  return null;
}

export function randomFoodKind(rng: Rng): FoodKind {
  return rng.pick(FOOD_KINDS);
}
