import Phaser from 'phaser';
import { ANT_STATS, Ant } from '../sim/ants';
import { antTextureKey } from './textures';

const DEPTH_RINGS = 2;
const DEPTH_ANTS = 3;
const SELECTION_COLOR = 0x7dff6a;

/** Keeps one sprite per ant in sync with the simulation. */
export class AntLayer {
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private rings: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene) {
    this.rings = scene.add.graphics().setDepth(DEPTH_RINGS);
  }

  /** `alpha` is how far we are between the previous and current tick (0..1). */
  sync(ants: Ant[], alpha: number, selected: ReadonlySet<number>): void {
    const alive = new Set<number>();
    this.rings.clear();
    this.rings.lineStyle(1.5, SELECTION_COLOR);

    for (const ant of ants) {
      alive.add(ant.id);
      let sprite = this.sprites.get(ant.id);
      if (!sprite) {
        sprite = this.scene.add.image(ant.x, ant.y, antTextureKey(ant.colony, ant.type)).setDepth(DEPTH_ANTS);
        this.sprites.set(ant.id, sprite);
      }
      const x = ant.prevX + (ant.x - ant.prevX) * alpha;
      const y = ant.prevY + (ant.y - ant.prevY) * alpha;
      sprite.setPosition(x, y).setRotation(ant.angle);

      if (selected.has(ant.id)) {
        this.rings.strokeCircle(x, y, ANT_STATS[ant.type].radius + 4);
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
