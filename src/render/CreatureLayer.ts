import Phaser from 'phaser';
import { ART_SCALE, SPIDER } from '../art/manifest';
import { CREATURE_STATS, Creature } from '../sim/wildlife';
import { animateWalk } from './AntLayer';
import { DEPTH } from './depths';

/** Wild creatures: animated sprite per creature, health bar when hurt, hidden in the fog. */
export class CreatureLayer {
  private sprites = new Map<number, Phaser.GameObjects.Sprite>();
  private bars: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene) {
    this.bars = scene.add.graphics().setDepth(DEPTH.carried);
  }

  sync(creatures: Creature[], alpha: number, tick: number, isShown: (c: Creature) => boolean): void {
    const alive = new Set<number>();
    this.bars.clear();
    for (const c of creatures) {
      alive.add(c.id);
      let sprite = this.sprites.get(c.id);
      if (!sprite) {
        sprite = this.scene.add.sprite(c.x, c.y, SPIDER, 0).setScale(ART_SCALE).setDepth(DEPTH.creatures);
        this.sprites.set(c.id, sprite);
      }
      const shown = isShown(c);
      sprite.setVisible(shown);
      if (!shown) continue;

      const x = c.prevX + (c.x - c.prevX) * alpha;
      const y = c.prevY + (c.y - c.prevY) * alpha;
      const since = tick - c.lastAttackTick;
      const lunge = c.lastAttackTick >= 0 && since < 4 ? (4 - since) * 1.5 : 0;
      sprite.setPosition(x + Math.cos(c.angle) * lunge, y + Math.sin(c.angle) * lunge).setRotation(c.angle);
      animateWalk(sprite, c.x !== c.prevX || c.y !== c.prevY);

      const stats = CREATURE_STATS[c.kind];
      if (c.hp < stats.maxHp) {
        const frac = Math.max(0, c.hp / stats.maxHp);
        const w = 34;
        const top = y - stats.radius - 12;
        this.bars.fillStyle(0x000000, 0.7).fillRect(x - w / 2 - 1, top - 1, w + 2, 5);
        this.bars.fillStyle(0xd94a4a).fillRect(x - w / 2, top, w * frac, 3);
      }
    }
    for (const [id, sprite] of this.sprites) {
      if (alive.has(id)) continue;
      this.sprites.delete(id);
      sprite.anims.stop();
      this.scene.tweens.add({ targets: sprite, alpha: 0, duration: 900, onComplete: () => sprite.destroy() });
    }
  }
}
