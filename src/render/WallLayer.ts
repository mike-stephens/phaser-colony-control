import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { ART_SCALE, PEBBLES, wallKey } from '../art/manifest';
import type { ColonyId, GameState } from '../sim/state';
import { WALL_HP, WALL_PEBBLES } from '../sim/walls';
import { DEPTH } from './depths';

/** Built walls and pebble piles as sprites; unfinished wall plans as outlines. */
export class WallLayer {
  private plans: Phaser.GameObjects.Graphics;
  private walls = new Map<number, Phaser.GameObjects.Image>();
  private piles = new Map<number, Phaser.GameObjects.Image>();

  constructor(private scene: Phaser.Scene) {
    this.plans = scene.add.graphics().setDepth(DEPTH.walls);
  }

  sync(state: GameState, viewer: ColonyId, isExplored: (tx: number, ty: number) => boolean, showPlans: boolean): void {
    const w = state.map.width;
    this.plans.clear();
    const builtNow = new Set<number>();

    for (const wall of Object.values(state.walls)) {
      const tx = wall.tile % w;
      const ty = Math.floor(wall.tile / w);
      if (!isExplored(tx, ty)) continue;
      const x = tx * TILE_SIZE;
      const y = ty * TILE_SIZE;
      if (wall.built) {
        builtNow.add(wall.tile);
        let img = this.walls.get(wall.tile);
        if (!img) {
          img = this.scene.add
            .image(x + TILE_SIZE / 2, y + TILE_SIZE / 2, wallKey(wall.owner))
            .setScale(ART_SCALE)
            .setDepth(DEPTH.walls);
          this.walls.set(wall.tile, img);
        }
        // Chewed walls darken.
        const health = Math.max(0, wall.hp / WALL_HP);
        const shade = Math.round(120 + 135 * health);
        img.setTint((shade << 16) | (shade << 8) | shade);
      } else if (wall.owner === viewer && showPlans) {
        this.plans.lineStyle(1.5, 0xffe14d, 0.9).strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        this.plans
          .fillStyle(0xffe14d, 0.12 + 0.25 * (wall.pebbles / WALL_PEBBLES))
          .fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
      }
    }
    for (const [tile, img] of this.walls) {
      if (!builtNow.has(tile)) {
        img.destroy();
        this.walls.delete(tile);
      }
    }

    const pilesNow = new Set<number>();
    for (const p of state.pebbles) {
      pilesNow.add(p.id);
      let img = this.piles.get(p.id);
      if (!img) {
        img = this.scene.add.image(p.x, p.y, PEBBLES).setDepth(DEPTH.food);
        img.setRotation(((p.id * 2654435761) % 628) / 100);
        this.piles.set(p.id, img);
      }
      img.setScale(ART_SCALE * (0.55 + 0.45 * (p.amount / p.max)));
    }
    for (const [id, img] of this.piles) {
      if (!pilesNow.has(id)) {
        img.destroy();
        this.piles.delete(id);
      }
    }
  }
}
