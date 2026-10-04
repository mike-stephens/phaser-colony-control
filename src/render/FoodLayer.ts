import Phaser from 'phaser';
import { ART_SCALE, foodKey } from '../art/manifest';
import { Food, foodRadius } from '../sim/food';
import { DEPTH } from './depths';

const SELECTED_COLOR = 0xffe14d;
/** Food radius (world px) at which the 64 px art is shown at ART_SCALE. */
const ART_RADIUS = 16;

/** Food sources; each shrinks as it is used up. */
export class FoodLayer {
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private highlight: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene) {
    this.highlight = scene.add.graphics().setDepth(DEPTH.overlay);
  }

  sync(foods: readonly Food[], selectedId: number | null, zoom: number): void {
    const alive = new Set<number>();
    this.highlight.clear();
    for (const food of foods) {
      alive.add(food.id);
      let sprite = this.sprites.get(food.id);
      if (!sprite) {
        // Each source gets a fixed random turn so piles don't all look identical.
        sprite = this.scene.add.image(food.x, food.y, foodKey(food.kind)).setDepth(DEPTH.food);
        sprite.setRotation(((food.id * 2654435761) % 628) / 100);
        this.sprites.set(food.id, sprite);
      }
      sprite.setScale((ART_SCALE * foodRadius(food)) / ART_RADIUS);
      if (food.id === selectedId) {
        this.highlight.lineStyle(2 / zoom, SELECTED_COLOR);
        this.highlight.strokeCircle(food.x, food.y, foodRadius(food) + 5);
      }
    }
    for (const [id, sprite] of this.sprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }
}
