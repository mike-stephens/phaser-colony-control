import { MAX_UNITS_PER_COLONY } from '../config';
import { Rng } from './rng';
import type { Colony, GameState, Nest } from './state';

/**
 * The nest below ground: chambers joined by tunnels, in a 2D cross-section.
 * For now it grows on its own (see updateDigging); later the player could
 * choose what to dig. Coordinates are abstract: x 0..UNDERGROUND_WIDTH,
 * y 0 (surface) ..UNDERGROUND_DEPTH.
 */
export type ChamberKind = 'entrance' | 'queen' | 'nursery' | 'food' | 'living';

export interface Chamber {
  kind: ChamberKind;
  x: number;
  y: number;
  /** Radius (the chamber is drawn as a 1.5:1 ellipse). */
  r: number;
  /** Index of the chamber this one's tunnel connects to; null for the entrance. */
  parent: number | null;
}

export interface Underground {
  chambers: Chamber[];
  /** The chamber being dug right now, if any. */
  dig: { chamber: Chamber; progress: number; needed: number } | null;
}

export const UNDERGROUND_WIDTH = 1000;
export const UNDERGROUND_DEPTH = 640;
/** Ants each chamber kind houses. */
export const CHAMBER_CAPACITY: Record<ChamberKind, number> = {
  entrance: 0,
  queen: 10,
  nursery: 5,
  food: 5,
  living: 15,
};
const CHAMBER_RADIUS: Record<ChamberKind, number> = { entrance: 18, queen: 46, nursery: 34, food: 36, living: 40 };
export const MAX_CHAMBERS = 9;
/** Digging starts once the colony is within this many ants of its capacity. */
const DIG_THRESHOLD = 3;
/** What gets dug next, cycling. Mostly living space, with stores and nurseries mixed in. */
const DIG_ORDER: ChamberKind[] = ['living', 'living', 'food', 'living', 'nursery', 'living'];

/** A brand-new underground: the starting nest gets a few rooms, a newly founded one just a queen chamber. */
export function newUnderground(rng: Rng, starter: boolean): Underground {
  const u: Underground = {
    chambers: [{ kind: 'entrance', x: UNDERGROUND_WIDTH / 2, y: 30, r: CHAMBER_RADIUS.entrance, parent: null }],
    dig: null,
  };
  const kinds: ChamberKind[] = starter ? ['queen', 'nursery', 'food', 'living'] : ['queen'];
  for (const kind of kinds) {
    const c = placeChamber(u, kind, rng);
    if (c) u.chambers.push(c);
  }
  return u;
}

export function nestCapacity(u: Underground): number {
  return u.chambers.reduce((n, c) => n + CHAMBER_CAPACITY[c.kind], 0);
}

/** How many ants the colony can house across all its nests (never above the hard cap). */
export function colonyCapacity(colony: Colony): number {
  return Math.min(
    MAX_UNITS_PER_COLONY,
    colony.nests.reduce((n, nest) => n + nestCapacity(nest.underground), 0),
  );
}

/** When a colony is nearly full, each of its nests digs a new chamber. */
export function updateDigging(state: GameState, rng: Rng): void {
  for (const colony of state.colonies) {
    if (colony.eliminated) continue;
    let ants = 0;
    for (const a of state.ants) if (a.colony === colony.id) ants++;
    const queued = colony.nests.reduce((n, nest) => n + nest.queue.length, 0);
    const capacity = colonyCapacity(colony);
    const crowded = ants + queued >= capacity - DIG_THRESHOLD && capacity < MAX_UNITS_PER_COLONY;
    for (const nest of colony.nests) digAt(nest, crowded, rng);
  }
}

function digAt(nest: Nest, crowded: boolean, rng: Rng): void {
  const u = nest.underground;
  if (!u.dig) {
    if (!crowded || u.chambers.length >= MAX_CHAMBERS) return;
    const kind = DIG_ORDER[(u.chambers.length - 1) % DIG_ORDER.length];
    const chamber = placeChamber(u, kind, rng);
    if (!chamber) return;
    u.dig = { chamber, progress: 0, needed: 300 + 60 * u.chambers.length };
  }
  // A dig in progress always finishes, even if the crowding eased meanwhile.
  if (++u.dig.progress >= u.dig.needed) {
    u.chambers.push(u.dig.chamber);
    u.dig = null;
  }
}

/** Finds room for a new chamber hanging off an existing one, below the surface and clear of the others. */
function placeChamber(u: Underground, kind: ChamberKind, rng: Rng): Chamber | null {
  const r = CHAMBER_RADIUS[kind];
  for (let attempt = 0; attempt < 60; attempt++) {
    const parentIdx = rng.int(0, u.chambers.length - 1);
    const parent = u.chambers[parentIdx];
    // Mostly downward and sideways: ants dig down and out.
    const angle = Math.PI * (0.1 + rng.next() * 0.8);
    const len = parent.r + r + 40 + rng.next() * 70;
    const x = parent.x + Math.cos(angle) * len * 1.4;
    const y = parent.y + Math.sin(angle) * len;
    if (x < r * 1.5 + 20 || x > UNDERGROUND_WIDTH - r * 1.5 - 20) continue;
    if (y < 110 || y > UNDERGROUND_DEPTH - r - 20) continue;
    const clear = u.chambers.every((c) => Math.hypot((c.x - x) / 1.5, c.y - y) > c.r + r + 22);
    if (clear) return { kind, x, y, r, parent: parentIdx };
  }
  return null;
}
