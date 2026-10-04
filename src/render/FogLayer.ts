import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { visibleTiles } from '../sim/fog';
import type { ColonyId, GameState } from '../sim/state';
import { DEPTH } from './depths';

const FOG_TEXTURE = 'fog';
const UNEXPLORED_ALPHA = 255;
const EXPLORED_ALPHA = 130;
const FOG_RGB = [10, 12, 9] as const;

/**
 * Fog of war drawn as a one-pixel-per-tile canvas stretched over the world.
 * Linear filtering on the stretch gives soft edges for free.
 */
export class FogLayer {
  private texture: Phaser.Textures.CanvasTexture;
  private pixels: ImageData;
  private lastTick = -1;

  constructor(scene: Phaser.Scene, width: number, height: number) {
    if (scene.textures.exists(FOG_TEXTURE)) scene.textures.remove(FOG_TEXTURE);
    this.texture = scene.textures.createCanvas(FOG_TEXTURE, width, height)!;
    this.pixels = this.texture.context.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      this.pixels.data[i * 4] = FOG_RGB[0];
      this.pixels.data[i * 4 + 1] = FOG_RGB[1];
      this.pixels.data[i * 4 + 2] = FOG_RGB[2];
    }
    scene.add.image(0, 0, FOG_TEXTURE).setOrigin(0).setScale(TILE_SIZE).setDepth(DEPTH.fog);
  }

  update(state: GameState, colony: ColonyId): void {
    if (state.tick === this.lastTick) return;
    this.lastTick = state.tick;
    const visible = visibleTiles(state, colony);
    const explored = state.fog[colony];
    const data = this.pixels.data;
    for (let i = 0; i < visible.length; i++) {
      data[i * 4 + 3] = visible[i] ? 0 : explored[i] ? EXPLORED_ALPHA : UNEXPLORED_ALPHA;
    }
    this.texture.context.putImageData(this.pixels, 0, 0);
    this.texture.refresh();
  }
}
