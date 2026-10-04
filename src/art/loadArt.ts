import Phaser from 'phaser';
import { ART, ART_OVERRIDES, ArtSpec, SPIDER, walkAnim } from './manifest';

/** Queues any override images on the scene's loader (call from preload()). */
export function queueOverrides(scene: Phaser.Scene): void {
  for (const spec of ART) {
    const path = ART_OVERRIDES[spec.key];
    if (!path) continue;
    if (spec.frames > 1) {
      scene.load.spritesheet(spec.key, path, { frameWidth: spec.width, frameHeight: spec.height });
    } else {
      scene.load.image(spec.key, path);
    }
  }
}

/**
 * Creates every texture that wasn't supplied as an override, then the walk
 * animations. Overrides that failed to load fall back to built-in art.
 */
export async function buildArt(scene: Phaser.Scene, onProgress?: (done: number, total: number) => void): Promise<void> {
  const missing = ART.filter((s) => !scene.textures.exists(s.key));
  let done = 0;
  await Promise.all(
    missing.map(async (spec) => {
      const source = spec.canvas ? spec.canvas() : await rasterize(spec);
      const texture = scene.textures.addCanvas(spec.key, source)!;
      // Frames are numbered 0..n-1 left to right, like a loaded spritesheet.
      if (spec.frames > 1) {
        for (let f = 0; f < spec.frames; f++) texture.add(f, 0, f * spec.width, 0, spec.width, spec.height);
      }
      onProgress?.(++done, missing.length);
    }),
  );
  createAnimations(scene);
}

/** Draws each SVG frame into one strip canvas. */
async function rasterize(spec: ArtSpec): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = spec.width * spec.frames;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d')!;
  for (let f = 0; f < spec.frames; f++) {
    const img = await svgImage(spec.svg!(f));
    ctx.drawImage(img, f * spec.width, 0, spec.width, spec.height);
  }
  return canvas;
}

function svgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render built-in SVG art'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function createAnimations(scene: Phaser.Scene): void {
  for (const spec of ART) {
    if (!spec.key.startsWith('ant-') && spec.key !== SPIDER) continue;
    const key = walkAnim(spec.key);
    if (scene.anims.exists(key)) continue;
    const available = scene.textures.get(spec.key).frameTotal - 1; // minus the __BASE frame
    // Ants: stand, stride A, stand, stride B. Spiders: alternate two poses.
    const order = spec.key === SPIDER ? [0, 1] : [1, 0, 2, 0];
    const frames = order.filter((f) => f < available).map((frame) => ({ key: spec.key, frame }));
    if (frames.length < 2) continue;
    scene.anims.create({ key, frames, frameRate: spec.key === SPIDER ? 8 : 12, repeat: -1 });
  }
}
