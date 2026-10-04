import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { visibleTiles } from '../sim/fog';
import { Terrain } from '../sim/map';
import type { GameScene } from '../scenes/GameScene';

const TEXTURE = 'minimap';
const TERRAIN_RGB: Record<Terrain, [number, number, number]> = {
  [Terrain.Grass]: [74, 124, 58],
  [Terrain.Dirt]: [139, 107, 67],
  [Terrain.Water]: [58, 110, 165],
  [Terrain.Rock]: [140, 138, 132],
  [Terrain.Hole]: [30, 22, 16],
};
/** Redraw the terrain/fog image every this many ticks (it changes slowly). */
const REDRAW_TICKS = 5;
const ALERT_TICKS = 60;

/**
 * Whole-map overview: terrain under the fog of war, ants, nests, food and the
 * camera's view. Left-click or drag moves the camera; right-click orders the
 * selection to that spot.
 */
export class Minimap {
  private image: Phaser.GameObjects.Image;
  private dots: Phaser.GameObjects.Graphics;
  private zone: Phaser.GameObjects.Zone;
  private texture: Phaser.Textures.CanvasTexture;
  private pixels: ImageData;
  private lastTick = -Infinity;
  private x = 0;
  private y = 0;
  private size = 160;
  private dragging = false;

  constructor(
    scene: Phaser.Scene,
    private game: () => GameScene,
    mapWidth: number,
    mapHeight: number,
  ) {
    if (scene.textures.exists(TEXTURE)) scene.textures.remove(TEXTURE);
    this.texture = scene.textures.createCanvas(TEXTURE, mapWidth, mapHeight)!;
    this.pixels = this.texture.context.createImageData(mapWidth, mapHeight);
    this.image = scene.add.image(0, 0, TEXTURE).setOrigin(0);
    this.dots = scene.add.graphics();
    this.zone = scene.add.zone(0, 0, 10, 10).setOrigin(0).setInteractive({ useHandCursor: true });
    this.zone.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.zone.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging && p.leftButtonDown()) this.lookAt(p);
    });
    scene.input.on('pointerup', () => (this.dragging = false));
  }

  layout(x: number, y: number, size: number): void {
    this.x = x;
    this.y = y;
    this.size = size;
    this.image.setPosition(x, y).setDisplaySize(size, size);
    this.zone.setPosition(x, y).setSize(size, size);
    if (this.zone.input) this.zone.input.hitArea.setTo(0, 0, size, size);
  }

  update(time: number): void {
    const game = this.game();
    const { state, player } = game;
    const { map } = state;
    const scale = this.size / (map.width * TILE_SIZE);
    const toMini = (wx: number, wy: number) => ({ x: this.x + wx * scale, y: this.y + wy * scale });

    if (state.tick - this.lastTick >= REDRAW_TICKS || state.tick < this.lastTick) {
      this.lastTick = state.tick;
      const visible = visibleTiles(state, player.id);
      const explored = state.fog[player.id];
      const data = this.pixels.data;
      for (let i = 0; i < map.tiles.length; i++) {
        const [r, g, b] = TERRAIN_RGB[map.tiles[i] as Terrain];
        const shade = visible[i] ? 1 : explored[i] ? 0.5 : 0;
        data[i * 4] = r * shade;
        data[i * 4 + 1] = g * shade;
        data[i * 4 + 2] = b * shade;
        data[i * 4 + 3] = 255;
      }
      this.texture.context.putImageData(this.pixels, 0, 0);
      this.texture.refresh();
    }

    const g = this.dots;
    g.clear();
    const vis = (wx: number, wy: number) =>
      visibleTiles(state, player.id)[Math.floor(wy / TILE_SIZE) * map.width + Math.floor(wx / TILE_SIZE)] === 1;
    const explored = (wx: number, wy: number) =>
      state.fog[player.id][Math.floor(wy / TILE_SIZE) * map.width + Math.floor(wx / TILE_SIZE)] === 1;

    g.fillStyle(0xffe14d);
    for (const f of state.food) {
      if (!explored(f.x, f.y)) continue;
      const m = toMini(f.x, f.y);
      g.fillRect(m.x - 1, m.y - 1, 2, 2);
    }
    for (const r of state.ruins) {
      const m = toMini((r.tile.x + 0.5) * TILE_SIZE, (r.tile.y + 0.5) * TILE_SIZE);
      g.fillStyle(0x777777).fillRect(m.x - 2, m.y - 2, 5, 5);
    }
    for (const colony of state.colonies) {
      const own = colony.id === player.id;
      for (const nest of colony.nests) {
        const wx = (nest.tile.x + 0.5) * TILE_SIZE;
        const wy = (nest.tile.y + 0.5) * TILE_SIZE;
        if (!own && !explored(wx, wy)) continue;
        const m = toMini(wx, wy);
        g.fillStyle(own ? 0x7dff6a : 0xff4d4d).fillRect(m.x - 3, m.y - 3, 7, 7);
        g.lineStyle(1, 0x000000).strokeRect(m.x - 3, m.y - 3, 7, 7);
        // Pulsing ring on a nest that's under attack.
        if (own && state.tick - nest.lastHitTick < ALERT_TICKS) {
          const pulse = 6 + ((time / 60) % 10);
          g.lineStyle(2, 0xff4d4d, 1 - (pulse - 6) / 10).strokeCircle(m.x, m.y, pulse);
        }
      }
    }
    for (const a of state.ants) {
      const own = a.colony === player.id;
      if (!own && !vis(a.x, a.y)) continue;
      const m = toMini(a.x, a.y);
      g.fillStyle(own ? 0xd8ffd0 : 0xff6a5a).fillRect(m.x - 1, m.y - 1, 2, 2);
    }
    g.fillStyle(0xc77dff);
    for (const c of state.creatures) {
      if (!vis(c.x, c.y)) continue;
      const m = toMini(c.x, c.y);
      g.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
    }

    const view = game.view;
    const tl = toMini(view.x, view.y);
    g.lineStyle(1, 0xffffff, 0.9).strokeRect(tl.x, tl.y, view.width * scale, view.height * scale);
  }

  private worldAt(p: Phaser.Input.Pointer) {
    const { map } = this.game().state;
    const scale = (map.width * TILE_SIZE) / this.size;
    return {
      x: Phaser.Math.Clamp((p.x - this.x) * scale, 0, map.width * TILE_SIZE - 1),
      y: Phaser.Math.Clamp((p.y - this.y) * scale, 0, map.height * TILE_SIZE - 1),
    };
  }

  private lookAt(p: Phaser.Input.Pointer): void {
    this.game().centerOn(this.worldAt(p));
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const ev = p.event as MouseEvent;
    if (p.rightButtonDown() || (p.leftButtonDown() && ev.ctrlKey)) {
      this.game().orderAt(this.worldAt(p));
      return;
    }
    this.dragging = true;
    this.lookAt(p);
  }
}
