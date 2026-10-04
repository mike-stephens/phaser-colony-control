import { Terrain } from '../sim/map';

/**
 * Ground art, painted per pixel onto canvases at ART_TILE px per tile.
 *
 * Grass is the base layer (a few variants, picked per tile). Every other
 * terrain is drawn on a "dual grid": a second grid offset by half a tile, so
 * each drawn tile sits where four map tiles meet and only needs to know
 * which of those four corners are that terrain (16 combinations). Shapes come
 * from a smooth field summed from the filled corners, so neighbouring tiles
 * join seamlessly with rounded, organic edges.
 */
export const ART_TILE = 64;
export const GRASS_VARIANTS = 4;
/** Terrains drawn as dual-grid overlays, bottom to top. */
export const OVERLAY_TERRAINS: Terrain[] = [Terrain.Dirt, Terrain.Water, Terrain.Rock, Terrain.Hole];

type RGB = [number, number, number];

/** Integer hash -> [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise (tileable over `period` px) in [0, 1). */
function valueNoise(x: number, y: number, cell: number, seed: number, period = ART_TILE): number {
  const cells = period / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function canvas(w: number, h: number): [HTMLCanvasElement, ImageData] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!.createImageData(w, h)];
}

function put(img: ImageData, x: number, y: number, rgb: RGB, a = 1): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = rgb[0];
  img.data[i + 1] = rgb[1];
  img.data[i + 2] = rgb[2];
  img.data[i + 3] = Math.round(a * 255);
}

/** Grass tileset: GRASS_VARIANTS tiles side by side. Noise is tileable so tiles meet without seams. */
export function grassTileset(): HTMLCanvasElement {
  const T = ART_TILE;
  const [c, img] = canvas(T * GRASS_VARIANTS, T);
  for (let v = 0; v < GRASS_VARIANTS; v++) {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const n = valueNoise(x, y, 16, 11) * 0.6 + valueNoise(x, y, 8, 12 + v) * 0.4;
        let col = mix([62, 112, 48], [96, 150, 66], n);
        // Short blades: bright or dark specks, varied per variant.
        const blade = hash(x, y, 100 + v);
        if (blade > 0.93) col = mix(col, [140, 190, 90], 0.6);
        else if (blade < 0.06) col = mix(col, [38, 78, 30], 0.6);
        put(img, v * T + x, y, col);
      }
    }
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/**
 * The 16 dual-grid tiles for one terrain, side by side. Tile index bits:
 * 8 = top-left corner, 4 = top-right, 2 = bottom-left, 1 = bottom-right.
 */
export function overlayTileset(terrain: Terrain): HTMLCanvasElement {
  const T = ART_TILE;
  const [c, img] = canvas(T * 16, T);
  for (let idx = 1; idx < 16; idx++) {
    const tl = idx & 8 ? 1 : 0;
    const tr = idx & 4 ? 1 : 0;
    const bl = idx & 2 ? 1 : 0;
    const br = idx & 1 ? 1 : 0;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        // Smoothed bilinear blend of the four corners: straight edges between
        // filled corners, rounded ones around lone corners. The threshold is
        // nudged by tileable noise so edges look natural, and since the noise
        // repeats every tile, neighbouring tiles still line up exactly.
        const u = smoothstep(0, 1, (x + 0.5) / T);
        const v = smoothstep(0, 1, (y + 0.5) / T);
        const f = (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
        const threshold = 0.5 + (valueNoise(x, y, 16, 300 + terrain) - 0.5) * 0.22;
        const px = paint(terrain, f, threshold, x, y);
        if (px) put(img, idx * T + x, y, px[0], px[1]);
      }
    }
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** Colour and alpha for a terrain at field strength f (>= threshold is inside). */
function paint(terrain: Terrain, f: number, t: number, x: number, y: number): [RGB, number] | null {
  const inside = smoothstep(t - 0.03, t + 0.03, f);
  const depth = clamp01((f - t) / 0.4); // 0 at the edge, 1 deep inside
  const n = valueNoise(x, y, 8, 21 + terrain);
  const speck = hash(x, y, 40 + terrain);

  switch (terrain) {
    case Terrain.Dirt: {
      if (inside <= 0) return null;
      let col = mix([126, 94, 58], [156, 120, 78], n);
      if (speck > 0.94) col = mix(col, [90, 66, 40], 0.7);
      if (speck < 0.03) col = mix(col, [190, 170, 140], 0.6);
      return [col, inside];
    }
    case Terrain.Water: {
      // A sandy shoreline just outside the water's edge.
      const shore = smoothstep(t - 0.14, t - 0.03, f) * (1 - inside);
      if (inside <= 0 && shore <= 0) return null;
      const ripple = valueNoise(x, y, 16, 77);
      let water = mix([70, 132, 190], [34, 82, 140], depth);
      if (ripple > 0.62 && depth > 0.15) water = mix(water, [140, 190, 230], (ripple - 0.62) * 1.6);
      const edgeFoam = 1 - smoothstep(0, 0.12, depth);
      water = mix(water, [200, 228, 240], edgeFoam * 0.35);
      const sand: RGB = mix([196, 176, 122], [214, 196, 146], n);
      return inside > 0 ? [mix(sand, water, inside), Math.max(inside, shore)] : [sand, shore];
    }
    case Terrain.Rock: {
      if (inside <= 0) return null;
      // Rounded boulders: darker toward the edges, mottled inside, a dark outline.
      const mottle = valueNoise(x, y, 16, 91) * 0.6 + valueNoise(x, y, 8, 92) * 0.4;
      let col = mix([104, 101, 97], [176, 171, 162], clamp01(0.25 + depth * 0.55 + (mottle - 0.5) * 0.5));
      if (speck > 0.95) col = mix(col, [70, 68, 64], 0.6);
      col = mix(col, [58, 56, 52], (1 - smoothstep(0, 0.15, depth)) * 0.55);
      return [col, inside];
    }
    case Terrain.Hole: {
      // Dark pit fading up to an earthy rim.
      const rim = smoothstep(t - 0.08, t, f);
      if (rim <= 0) return null;
      const col = mix([96, 72, 48], [14, 10, 7], smoothstep(0, 0.5, depth));
      return [col, rim];
    }
    default:
      return null;
  }
}
