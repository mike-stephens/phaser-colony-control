import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import type { GameState, ColonyId } from '../sim/state';
import { PebblePile, WALL_HP, WALL_PEBBLES } from '../sim/walls';
import { DEPTH } from './depths';

const STONE = { black: 0x8a8a8a, red: 0x9a7a72 } as const;
const STONE_EDGE = { black: 0x3a3a3a, red: 0x5a2a22 } as const;

/**
 * Walls, wall plans and pebble piles. Cheap enough to redraw every frame:
 * there are at most a few hundred of each.
 */
export class WallLayer {
  private g: Phaser.GameObjects.Graphics;
  private piles: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.walls);
    this.piles = scene.add.graphics().setDepth(DEPTH.food);
  }

  sync(state: GameState, viewer: ColonyId, isExplored: (tx: number, ty: number) => boolean, showPlans: boolean): void {
    const { g } = this;
    const w = state.map.width;
    g.clear();
    for (const wall of Object.values(state.walls)) {
      const tx = wall.tile % w;
      const ty = Math.floor(wall.tile / w);
      if (!isExplored(tx, ty)) continue;
      const x = tx * TILE_SIZE;
      const y = ty * TILE_SIZE;
      if (wall.built) {
        // A heap of pebbles: base block plus a few stones, darker as it gets chewed.
        const health = wall.hp / WALL_HP;
        g.fillStyle(STONE[wall.owner], 0.55 + 0.45 * health).fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.fillStyle(STONE_EDGE[wall.owner], 0.8);
        for (const [ox, oy, r] of [[9, 10, 5], [22, 9, 4], [15, 21, 6], [25, 23, 4]]) g.fillCircle(x + ox, y + oy, r);
        g.lineStyle(1, STONE_EDGE[wall.owner]).strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      } else if (wall.owner === viewer && showPlans) {
        g.lineStyle(1.5, 0xffe14d, 0.9).strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        g.fillStyle(0xffe14d, 0.12 + 0.25 * (wall.pebbles / WALL_PEBBLES)).fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
      }
    }

    this.piles.clear();
    for (const p of state.pebbles) this.drawPile(p);
  }

  private drawPile(p: PebblePile): void {
    const g = this.piles;
    const n = Math.max(1, Math.ceil((p.amount / p.max) * 5));
    const spots = [[0, 0, 5], [-7, 3, 4], [6, 4, 4], [-3, -6, 4], [5, -5, 3]];
    g.fillStyle(0x6e6e6e).lineStyle(1, 0x3c3c3c);
    for (const [ox, oy, r] of spots.slice(0, n)) {
      g.fillCircle(p.x + ox, p.y + oy, r);
      g.strokeCircle(p.x + ox, p.y + oy, r);
    }
  }
}
