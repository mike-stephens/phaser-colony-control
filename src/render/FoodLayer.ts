import Phaser from 'phaser';
import { Food, FoodKind, foodRadius } from '../sim/food';
import { DEPTH } from './depths';

// Placeholder look per kind until real food sprites exist.
const FOOD_COLORS: Record<FoodKind, { fill: number; edge: number }> = {
  crumbs: { fill: 0xe9d8a6, edge: 0xa88d4f },
  seeds: { fill: 0xc79a5a, edge: 0x7a5426 },
  berries: { fill: 0xc2185b, edge: 0x6d0d33 },
  carcass: { fill: 0x6b4f7a, edge: 0x2a1d33 },
};
const SELECTED_COLOR = 0xffe14d;

export class FoodLayer {
  private shapes = new Map<number, Phaser.GameObjects.Arc>();
  private highlight: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene) {
    this.highlight = scene.add.graphics().setDepth(DEPTH.overlay);
  }

  sync(foods: readonly Food[], selectedId: number | null, zoom: number): void {
    const alive = new Set<number>();
    this.highlight.clear();
    for (const food of foods) {
      alive.add(food.id);
      let shape = this.shapes.get(food.id);
      if (!shape) {
        const c = FOOD_COLORS[food.kind];
        shape = this.scene.add.circle(food.x, food.y, foodRadius(food), c.fill).setStrokeStyle(2, c.edge);
        shape.setDepth(DEPTH.food);
        this.shapes.set(food.id, shape);
      }
      shape.setRadius(foodRadius(food));
      if (food.id === selectedId) {
        this.highlight.lineStyle(2 / zoom, SELECTED_COLOR);
        this.highlight.strokeCircle(food.x, food.y, foodRadius(food) + 5);
      }
    }
    for (const [id, shape] of this.shapes) {
      if (!alive.has(id)) {
        shape.destroy();
        this.shapes.delete(id);
      }
    }
  }
}
