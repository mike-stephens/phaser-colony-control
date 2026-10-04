import type { AntType } from '../sim/ants';
import type { FoodKind } from '../sim/food';
import { Terrain } from '../sim/map';
import type { ColonyId } from '../sim/state';
import { antSvg, spiderSvg } from './insects';
import { foodSvg, nestSvg, pebblePileSvg, ruinSvg, wallSvg } from './objects';
import { OVERLAY_TERRAINS, grassTileset, overlayTileset } from './terrain';

/**
 * Every texture the game uses. Sprites are drawn at 2x their on-screen size
 * (ART_SCALE = 0.5) so they stay crisp when zoomed in.
 *
 * To use your own art for any entry, put the image in `public/assets/` and
 * add it to ART_OVERRIDES below, e.g.
 *     'ant-black-worker': 'assets/ant-black-worker.png',
 * The image must match the entry's frame size (and, for animated entries,
 * have `frames` frames side by side). Anything not overridden uses the
 * built-in art.
 */
export const ART_OVERRIDES: Partial<Record<string, string>> = {
  // 'spider': 'assets/spider.png',
};

/** Display scale for sprites (art is authored at 2x). */
export const ART_SCALE = 0.5;
/** Ground tiles are painted at 64 px for 32 px map tiles. */
export const ART_TILE_RATIO = 0.5;

export interface ArtSpec {
  key: string;
  /** Size of one frame in pixels. */
  width: number;
  height: number;
  /** Frames laid out left to right (1 for a still image). */
  frames: number;
  /** Built-in art: an SVG per frame, or a ready-made canvas (terrain). */
  svg?: (frame: number) => string;
  canvas?: () => HTMLCanvasElement;
}

export const antKey = (colony: ColonyId, type: AntType) => `ant-${colony}-${type}`;
export const foodKey = (kind: FoodKind) => `food-${kind}`;
export const wallKey = (colony: ColonyId) => `wall-${colony}`;
export const nestKey = (colony: ColonyId) => `nest-${colony}`;
export const overlayKey = (t: Terrain) => `terrain-${Terrain[t].toLowerCase()}`;
export const SPIDER = 'spider';
export const PEBBLES = 'pebbles';
export const RUIN = 'ruin';
export const GRASS = 'terrain-grass';
/** Walk animation key for an animated texture. */
export const walkAnim = (key: string) => `${key}-walk`;

const ANT_WIDTH: Record<AntType, number> = { worker: 60, soldier: 74, queen: 96 };

function buildManifest(): ArtSpec[] {
  const specs: ArtSpec[] = [];
  for (const colony of ['black', 'red'] as const) {
    for (const type of ['worker', 'soldier', 'queen'] as const) {
      const w = ANT_WIDTH[type];
      const h = Math.round(w * 0.7);
      specs.push({ key: antKey(colony, type), width: w, height: h, frames: 3, svg: (f) => antSvg(colony, type, f, w, h) });
    }
    specs.push({ key: wallKey(colony), width: 64, height: 64, frames: 1, svg: () => wallSvg(colony, 64) });
    specs.push({ key: nestKey(colony), width: 104, height: 104, frames: 1, svg: () => nestSvg(colony, 104) });
  }
  specs.push({ key: SPIDER, width: 96, height: 96, frames: 2, svg: (f) => spiderSvg(f, 96) });
  for (const kind of ['crumbs', 'seeds', 'berries', 'carcass'] as const) {
    specs.push({ key: foodKey(kind), width: 64, height: 64, frames: 1, svg: () => foodSvg(kind, 64) });
  }
  specs.push({ key: PEBBLES, width: 64, height: 64, frames: 1, svg: () => pebblePileSvg(64) });
  specs.push({ key: RUIN, width: 104, height: 104, frames: 1, svg: () => ruinSvg(104) });
  specs.push({ key: GRASS, width: 64, height: 64, frames: 4, canvas: grassTileset });
  for (const t of OVERLAY_TERRAINS) {
    specs.push({ key: overlayKey(t), width: 64, height: 64, frames: 16, canvas: () => overlayTileset(t) });
  }
  return specs;
}

export const ART: ArtSpec[] = buildManifest();
