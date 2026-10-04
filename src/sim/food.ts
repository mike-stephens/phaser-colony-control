import type { Point } from './map';

export type FoodKind = 'crumbs' | 'seeds' | 'berries' | 'carcass';

export interface Food {
  id: number;
  kind: FoodKind;
  /** World position (centre of a walkable tile). */
  x: number;
  y: number;
  amount: number;
  max: number;
}

/** Food units a worker carries per trip. */
export const CARRY_CAPACITY = 5;
/** Ticks a worker spends picking up a load. */
export const HARVEST_TICKS = 20;

export const FOOD_AMOUNTS: Record<FoodKind, [min: number, max: number]> = {
  crumbs: [80, 150],
  seeds: [150, 250],
  berries: [250, 400],
  carcass: [120, 120],
};

/** Display/hit radius in world pixels; shrinks as the source is used up. */
export function foodRadius(food: Food): number {
  return 6 + 10 * Math.sqrt(food.amount / food.max);
}

/** The food source under a world point, if any. */
export function findFoodAt(foods: readonly Food[], p: Point, slop: number): Food | null {
  let best: Food | null = null;
  let bestDist = Infinity;
  for (const f of foods) {
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    if (d <= foodRadius(f) + slop && d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}
