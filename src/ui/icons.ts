import Phaser from 'phaser';

/** Simple line icons for command buttons that have no sprite of their own. */
export const ICON_SIZE = 40;

type Painter = (g: Phaser.GameObjects.Graphics, s: number) => void;

const LINE = 0xf2ead8;

const ICONS: Record<string, Painter> = {
  'icon-move': (g, s) => {
    g.lineStyle(4, LINE).lineBetween(s * 0.2, s / 2, s * 0.78, s / 2);
    g.fillStyle(LINE).fillTriangle(s * 0.82, s / 2, s * 0.6, s * 0.3, s * 0.6, s * 0.7);
  },
  'icon-stop': (g, s) => {
    g.fillStyle(0xd94a4a).fillRect(s * 0.25, s * 0.25, s * 0.5, s * 0.5);
  },
  'icon-attack': (g, s) => {
    g.lineStyle(4, LINE);
    g.lineBetween(s * 0.22, s * 0.22, s * 0.78, s * 0.78);
    g.lineBetween(s * 0.78, s * 0.22, s * 0.22, s * 0.78);
    g.lineStyle(4, 0xd94a4a);
    g.lineBetween(s * 0.16, s * 0.34, s * 0.34, s * 0.16);
    g.lineBetween(s * 0.66, s * 0.16, s * 0.84, s * 0.34);
  },
  'icon-explore': (g, s) => {
    g.lineStyle(4, LINE).strokeCircle(s * 0.42, s * 0.42, s * 0.2);
    g.lineStyle(5, LINE).lineBetween(s * 0.57, s * 0.57, s * 0.8, s * 0.8);
  },
  'icon-rally': (g, s) => {
    g.lineStyle(3, LINE).lineBetween(s * 0.32, s * 0.18, s * 0.32, s * 0.85);
    g.fillStyle(0xffe14d).fillTriangle(s * 0.34, s * 0.18, s * 0.78, s * 0.32, s * 0.34, s * 0.46);
  },
  'icon-plus': (g, s) => {
    g.lineStyle(6, 0x7dff6a);
    g.lineBetween(s * 0.25, s / 2, s * 0.75, s / 2);
    g.lineBetween(s / 2, s * 0.25, s / 2, s * 0.75);
  },
  'icon-minus': (g, s) => {
    g.lineStyle(6, 0xff8a6a).lineBetween(s * 0.25, s / 2, s * 0.75, s / 2);
  },
  'icon-cancel': (g, s) => {
    g.lineStyle(5, 0xd94a4a);
    g.lineBetween(s * 0.27, s * 0.27, s * 0.73, s * 0.73);
    g.lineBetween(s * 0.73, s * 0.27, s * 0.27, s * 0.73);
  },
  'icon-done': (g, s) => {
    g.lineStyle(5, 0x7dff6a);
    g.lineBetween(s * 0.22, s * 0.52, s * 0.42, s * 0.72);
    g.lineBetween(s * 0.42, s * 0.72, s * 0.8, s * 0.28);
  },
  'icon-underground': (g, s) => {
    g.fillStyle(0x6b4a2e).fillRect(s * 0.12, s * 0.3, s * 0.76, s * 0.55);
    g.fillStyle(0x4a7c3a).fillRect(s * 0.12, s * 0.26, s * 0.76, s * 0.06);
    g.fillStyle(0x1c120a).fillEllipse(s * 0.38, s * 0.55, s * 0.24, s * 0.16).fillEllipse(s * 0.66, s * 0.72, s * 0.2, s * 0.13);
    g.lineStyle(3, 0x1c120a).lineBetween(s * 0.5, s * 0.3, s * 0.4, s * 0.5).lineBetween(s * 0.44, s * 0.6, s * 0.62, s * 0.7);
  },
};

export function makeIcons(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  for (const [key, paint] of Object.entries(ICONS)) {
    if (scene.textures.exists(key)) continue;
    g.clear();
    paint(g, ICON_SIZE);
    g.generateTexture(key, ICON_SIZE, ICON_SIZE);
  }
  g.destroy();
}
