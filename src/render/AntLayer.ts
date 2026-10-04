import Phaser from 'phaser';
import { ANT_STATS, Ant } from '../sim/ants';
import { DEPTH } from './depths';
import { antTextureKey } from './textures';

const SELECTION_COLOR = 0x7dff6a;
const CARRIED_COLOR = 0xf3e2b0;
const HP_GOOD = 0x6ad04a;
const HP_LOW = 0xe04a3a;

/** Keeps one sprite per ant in sync with the simulation. */
export class AntLayer {
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private rings: Phaser.GameObjects.Graphics;
  private carried: Phaser.GameObjects.Graphics;
  private hpBars: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene) {
    this.rings = scene.add.graphics().setDepth(DEPTH.selectionRings);
    this.carried = scene.add.graphics().setDepth(DEPTH.carried);
    this.hpBars = scene.add.graphics().setDepth(DEPTH.carried);
  }

  /**
   * `alpha` is how far we are between the previous and current tick (0..1).
   * Ants for which `isShown` is false (e.g. enemies in the fog) are hidden.
   */
  sync(ants: Ant[], alpha: number, selected: ReadonlySet<number>, isShown: (ant: Ant) => boolean): void {
    const alive = new Set<number>();
    this.rings.clear();
    this.rings.lineStyle(1.5, SELECTION_COLOR);
    this.carried.clear();
    this.carried.fillStyle(CARRIED_COLOR);
    this.hpBars.clear();

    for (const ant of ants) {
      alive.add(ant.id);
      let sprite = this.sprites.get(ant.id);
      if (!sprite) {
        sprite = this.scene.add.image(ant.x, ant.y, antTextureKey(ant.colony, ant.type)).setDepth(DEPTH.ants);
        this.sprites.set(ant.id, sprite);
      }
      const shown = isShown(ant);
      sprite.setVisible(shown);
      if (!shown) continue;

      const x = ant.prevX + (ant.x - ant.prevX) * alpha;
      const y = ant.prevY + (ant.y - ant.prevY) * alpha;
      sprite.setPosition(x, y).setRotation(ant.angle);

      if (ant.carrying > 0) {
        const reach = ANT_STATS[ant.type].radius + 3;
        this.carried.fillCircle(x + Math.cos(ant.angle) * reach, y + Math.sin(ant.angle) * reach, 3);
      }
      const stats = ANT_STATS[ant.type];
      if (ant.hp < stats.maxHp) {
        // Health bar only on hurt ants, so a healthy colony stays uncluttered.
        const frac = Math.max(0, ant.hp / stats.maxHp);
        const w = stats.radius * 2.4;
        const top = y - stats.radius - 7;
        this.hpBars.fillStyle(0x000000, 0.7).fillRect(x - w / 2 - 1, top - 1, w + 2, 4);
        this.hpBars.fillStyle(frac > 0.5 ? HP_GOOD : HP_LOW).fillRect(x - w / 2, top, w * frac, 2);
      }
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
