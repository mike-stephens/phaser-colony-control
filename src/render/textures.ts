import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import type { AntType } from '../sim/ants';
import { Terrain } from '../sim/map';
import type { ColonyId } from '../sim/state';

/**
 * Placeholder art generated at runtime. When real sprites arrive, load them
 * under the same texture keys and delete the matching generator here.
 */

export const TERRAIN_TEXTURE = 'terrain';

// Tileset frame order must match the Terrain enum values.
const TERRAIN_COLORS: Record<Terrain, number> = {
  [Terrain.Grass]: 0x4a7c3a,
  [Terrain.Dirt]: 0x8b6b43,
  [Terrain.Water]: 0x3a6ea5,
  [Terrain.Rock]: 0x7a7a7a,
  [Terrain.Hole]: 0x231a12,
};

const COLONY_FILL: Record<ColonyId, number> = { black: 0x141414, red: 0xb83224 };
const COLONY_EDGE: Record<ColonyId, number> = { black: 0x6a6a6a, red: 0x5e140d };

export const SPIDER_TEXTURE = 'spider';

export function antTextureKey(colony: ColonyId, type: AntType): string {
  return `ant-${colony}-${type}`;
}

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TERRAIN_TEXTURE)) return;
  generateTerrain(scene);
  for (const colony of ['black', 'red'] as const) {
    for (const type of ['worker', 'soldier', 'queen'] as const) {
      generateAnt(scene, colony, type);
    }
  }
  generateSpider(scene);
}

/** Spider facing +x: two body segments and eight bent legs. */
function generateSpider(scene: Phaser.Scene): void {
  const size = 44;
  const c = size / 2;
  const g = scene.make.graphics({}, false);
  g.lineStyle(2, 0x2a1d33);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const ox = c - 3 + i * 3;
      const kneeX = c - 10 + i * 8;
      g.beginPath();
      g.moveTo(ox, c);
      g.lineTo(kneeX, c + side * 12);
      g.lineTo(kneeX + (i < 2 ? -6 : 6), c + side * 20);
      g.strokePath();
    }
  }
  g.fillStyle(0x3d2a4d);
  g.lineStyle(1, 0x7a5c8f);
  g.fillEllipse(c - 6, c, 18, 15);
  g.strokeEllipse(c - 6, c, 18, 15);
  g.fillCircle(c + 6, c, 6);
  g.strokeCircle(c + 6, c, 6);
  g.fillStyle(0xd94a4a);
  g.fillCircle(c + 9, c - 2, 1.2);
  g.fillCircle(c + 9, c + 2, 1.2);
  g.generateTexture(SPIDER_TEXTURE, size, size);
  g.destroy();
}

function generateTerrain(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  const terrains = Object.values(TERRAIN_COLORS);
  terrains.forEach((color, i) => {
    g.fillStyle(color);
    g.fillRect(i * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
  });
  g.generateTexture(TERRAIN_TEXTURE, terrains.length * TILE_SIZE, TILE_SIZE);
  g.destroy();
}

const ANT_SHAPE: Record<AntType, { scale: number; head: number; abdomen: number }> = {
  worker: { scale: 1, head: 2.2, abdomen: 1 },
  soldier: { scale: 1.25, head: 3.2, abdomen: 1 },
  queen: { scale: 1.5, head: 2.4, abdomen: 1.5 },
};

/** Draws an ant facing +x (rotation 0), centred in its texture. */
function generateAnt(scene: Phaser.Scene, colony: ColonyId, type: AntType): void {
  const { scale: s, head, abdomen } = ANT_SHAPE[type];
  const w = Math.ceil(26 * s);
  const h = Math.ceil(18 * s);
  const cx = w / 2;
  const cy = h / 2;
  const fill = COLONY_FILL[colony];
  const edge = COLONY_EDGE[colony];
  const g = scene.make.graphics({}, false);

  // Legs: three pairs from the thorax.
  g.lineStyle(1.2, fill);
  for (const ox of [-2, 0, 2]) {
    g.lineBetween(cx + ox * s, cy, cx + (ox * 2 - 1) * s, cy - 7 * s);
    g.lineBetween(cx + ox * s, cy, cx + (ox * 2 - 1) * s, cy + 7 * s);
  }
  // Antennae.
  g.lineBetween(cx + 6 * s, cy, cx + 10 * s, cy - 4 * s);
  g.lineBetween(cx + 6 * s, cy, cx + 10 * s, cy + 4 * s);
  if (type === 'soldier') {
    g.lineStyle(1.6, fill);
    g.lineBetween(cx + 7 * s, cy - 1.5 * s, cx + 10 * s, cy - 0.5 * s);
    g.lineBetween(cx + 7 * s, cy + 1.5 * s, cx + 10 * s, cy + 0.5 * s);
  }

  g.fillStyle(fill);
  g.lineStyle(1, edge);
  g.fillEllipse(cx - 5 * s * abdomen, cy, 8 * s * abdomen, 6 * s * Math.sqrt(abdomen));
  g.strokeEllipse(cx - 5 * s * abdomen, cy, 8 * s * abdomen, 6 * s * Math.sqrt(abdomen));
  g.fillEllipse(cx, cy, 5 * s, 3.4 * s);
  g.fillCircle(cx + 4.5 * s, cy, head * s);
  g.strokeCircle(cx + 4.5 * s, cy, head * s);

  g.generateTexture(antTextureKey(colony, type), w, h);
  g.destroy();
}
