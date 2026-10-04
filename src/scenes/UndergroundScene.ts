import Phaser from 'phaser';
import { ART_SCALE, antKey } from '../art/manifest';
import { ANT_COST } from '../sim/economy';
import { Point } from '../sim/map';
import { findNest, nestCenter } from '../sim/state';
import {
  CHAMBER_CAPACITY,
  Chamber,
  ChamberKind,
  UNDERGROUND_DEPTH,
  UNDERGROUND_WIDTH,
  nestCapacity,
} from '../sim/underground';
import type { GameScene } from './GameScene';

const SKY = 70; // local units of sky drawn above the surface
const NAMES: Record<ChamberKind, string> = {
  entrance: 'Entrance',
  queen: 'Queen chamber',
  nursery: 'Nursery',
  food: 'Food store',
  living: 'Living chamber',
};
/** Ants within this many tiles of a nest count as "at home" (shown resting below). */
const HOME_RADIUS_TILES = 6;

/**
 * Cross-section of one nest, drawn live from the simulation. Purely a view:
 * the game keeps running underneath, and nothing here changes game state.
 */
export class UndergroundScene extends Phaser.Scene {
  private nestId = 0;
  private g!: Phaser.GameObjects.Graphics;
  private header!: Phaser.GameObjects.Text;
  private labels: Phaser.GameObjects.Text[] = [];
  private sprites: Phaser.GameObjects.Image[] = [];

  constructor() {
    super('Underground');
  }

  init(data: { nestId: number }): void {
    this.nestId = data.nestId;
    this.labels = [];
    this.sprites = [];
  }

  create(): void {
    this.g = this.add.graphics();
    this.header = this.add.text(16, 14, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 8, y: 6 },
    });
    const close = this.add
      .text(0, 14, ' Back to surface (U / Esc) ', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#444444',
        padding: { x: 8, y: 6 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => (this.scene.get('Game') as GameScene).closeUnderground());
    const place = () => close.setX(this.scale.width - 16);
    place();
    this.scale.on('resize', place);
    this.events.once('shutdown', () => this.scale.off('resize', place));
  }

  update(time: number): void {
    const game = this.scene.get('Game') as GameScene;
    const found = game.state ? findNest(game.state, this.nestId) : null;
    if (!found) {
      game.closeUnderground();
      return;
    }
    const { colony, nest } = found;
    const state = game.state;
    const u = nest.underground;

    // Fit the cross-section (plus a strip of sky) to the screen.
    const { width, height } = this.scale;
    const top = 60;
    const s = Math.min((width - 40) / UNDERGROUND_WIDTH, (height - top - 20) / (UNDERGROUND_DEPTH + SKY));
    const ox = (width - UNDERGROUND_WIDTH * s) / 2;
    const oy = top + SKY * s;
    const P = (x: number, y: number): Point => ({ x: ox + x * s, y: oy + y * s });

    const g = this.g;
    g.clear();
    g.fillStyle(0x111111).fillRect(0, 0, width, height);
    this.drawSoil(g, ox, oy, s);

    // Mound on the surface above the entrance.
    const entrance = u.chambers[0];
    const mound = P(entrance.x, 0);
    g.fillStyle(colony.id === 'black' ? 0x5a4632 : 0x7a3a2a).fillEllipse(mound.x, mound.y, 120 * s, 50 * s);

    // Tunnels first, then chambers on top.
    g.lineStyle(Math.max(4, 16 * s), 0x3b2616);
    for (const c of u.chambers) {
      if (c.parent === null) continue;
      const a = P(u.chambers[c.parent].x, u.chambers[c.parent].y);
      const b = P(c.x, c.y);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    g.lineBetween(mound.x, mound.y, P(entrance.x, entrance.y).x, P(entrance.x, entrance.y).y);
    if (u.dig) {
      const frac = u.dig.progress / u.dig.needed;
      const parent = u.chambers[u.dig.chamber.parent ?? 0];
      const a = P(parent.x, parent.y);
      const b = P(u.dig.chamber.x, u.dig.chamber.y);
      g.lineBetween(a.x, a.y, a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac);
      g.lineStyle(2, 0xc9a46b, 0.8).strokeEllipse(b.x, b.y, u.dig.chamber.r * 3 * s, u.dig.chamber.r * 2 * s);
    }
    for (const c of u.chambers) {
      const p = P(c.x, c.y);
      g.fillStyle(0x24160c).fillEllipse(p.x, p.y, c.r * 3 * s, c.r * 2 * s);
      g.lineStyle(2, 0x4a3020).strokeEllipse(p.x, p.y, c.r * 3 * s, c.r * 2 * s);
    }

    // Who's home: ants of this colony near this nest that aren't busy.
    const home = nestCenter(nest);
    const resting = state.ants.filter(
      (a) =>
        a.colony === colony.id &&
        a.type !== 'queen' &&
        a.task.kind === 'idle' &&
        Math.hypot(a.x - home.x, a.y - home.y) < HOME_RADIUS_TILES * 32,
    );

    let label = 0;
    let sprite = 0;
    const living = u.chambers.filter((c) => c.kind === 'living');
    const perLiving = Math.ceil(resting.length / Math.max(1, living.length));

    for (const c of u.chambers) {
      const p = P(c.x, c.y);
      let text = NAMES[c.kind];
      if (c.kind === 'queen') {
        this.placeSprite(sprite++, antKey(colony.id, 'queen'), p, 2.2 * s * 1.6 * ART_SCALE * 0.9, Math.sin(time / 900) * 0.3 - Math.PI / 2);
      } else if (c.kind === 'nursery') {
        nest.queue.forEach((type, i) => this.drawEgg(g, p, c, s, i, i === 0 ? nest.progress / ANT_COST[type].ticks : 0));
        text += nest.queue.length ? ` (${nest.queue.length} egg${nest.queue.length > 1 ? 's' : ''})` : ' (empty)';
      } else if (c.kind === 'food') {
        this.drawFood(g, p, c, s, colony.food);
        text += ` (${colony.food})`;
      } else if (c.kind === 'living') {
        const idx = living.indexOf(c);
        const here = resting.slice(idx * perLiving, (idx + 1) * perLiving).slice(0, CHAMBER_CAPACITY.living);
        here.forEach((ant, i) => {
          const a = i * 2.39996 + time / 3000;
          const rr = 0.8 * Math.sqrt((i + 0.5) / CHAMBER_CAPACITY.living);
          const q = { x: p.x + Math.cos(a) * c.r * 1.5 * s * rr, y: p.y + Math.sin(a) * c.r * s * rr };
          this.placeSprite(sprite++, antKey(colony.id, ant.type), q, s * 1.15 * ART_SCALE * 0.9, a + Math.PI / 2);
        });
        text += ` ${here.length}/${CHAMBER_CAPACITY.living}`;
      }
      if (c.kind !== 'entrance') this.placeLabel(label++, text, p.x, p.y + c.r * s + 4);
    }
    if (u.dig) {
      const c = u.dig.chamber;
      const p = P(c.x, c.y);
      this.placeLabel(label++, `Digging ${NAMES[c.kind].toLowerCase()} ${Math.floor((u.dig.progress / u.dig.needed) * 100)}%`, p.x, p.y + c.r * s + 4);
    }
    for (let i = label; i < this.labels.length; i++) this.labels[i].setVisible(false);
    for (let i = sprite; i < this.sprites.length; i++) this.sprites[i].setVisible(false);

    const index = colony.nests.indexOf(nest) + 1;
    const away = state.ants.filter((a) => a.colony === colony.id).length - resting.length;
    this.header.setText(
      `Underground: nest ${index} of ${colony.nests.length}   ${u.chambers.length - 1} chambers, houses ${nestCapacity(u)}   ` +
        `${resting.length} resting, ${away} out working`,
    );
  }

  /** Layered soil with a few stones, deterministic per nest. */
  private drawSoil(g: Phaser.GameObjects.Graphics, ox: number, oy: number, s: number): void {
    g.fillStyle(0x7fb2d9).fillRect(ox, oy - SKY * s, UNDERGROUND_WIDTH * s, SKY * s);
    const bands = [0x6b4a2e, 0x5e4028, 0x513722, 0x452e1c];
    const bandH = UNDERGROUND_DEPTH / bands.length;
    bands.forEach((c, i) => g.fillStyle(c).fillRect(ox, oy + i * bandH * s, UNDERGROUND_WIDTH * s, bandH * s + 1));
    g.fillStyle(0x4a7c3a).fillRect(ox, oy - 6 * s, UNDERGROUND_WIDTH * s, 12 * s);
    let seed = this.nestId * 9301 + 49297;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    g.fillStyle(0x7a6a5a, 0.6);
    for (let i = 0; i < 70; i++) {
      g.fillCircle(ox + rand() * UNDERGROUND_WIDTH * s, oy + (20 + rand() * (UNDERGROUND_DEPTH - 30)) * s, (2 + rand() * 5) * s);
    }
  }

  private drawEgg(g: Phaser.GameObjects.Graphics, p: Point, c: Chamber, s: number, i: number, growth: number): void {
    const x = p.x + (i - 2) * c.r * 0.45 * s;
    const y = p.y + ((i % 2) - 0.5) * c.r * 0.4 * s;
    const size = (8 + growth * 6) * s;
    g.fillStyle(0xf4efe0).fillEllipse(x, y, size * 1.3, size);
  }

  private drawFood(g: Phaser.GameObjects.Graphics, p: Point, c: Chamber, s: number, food: number): void {
    const n = Math.min(14, Math.ceil(food / 40));
    const colors = [0xe9d8a6, 0xc79a5a, 0xc2185b];
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      const rr = Math.sqrt((i + 0.5) / 14) * c.r * 0.8;
      g.fillStyle(colors[i % 3]).fillCircle(p.x + Math.cos(a) * rr * 1.4 * s, p.y + Math.sin(a) * rr * 0.7 * s + 6 * s, 5 * s);
    }
  }

  private placeLabel(i: number, text: string, x: number, y: number): void {
    if (!this.labels[i]) {
      this.labels[i] = this.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#f0e0c0' })
        .setOrigin(0.5, 0);
    }
    this.labels[i].setText(text).setPosition(x, y).setVisible(true);
  }

  private placeSprite(i: number, key: string, p: Point, scale: number, rotation: number): void {
    if (!this.sprites[i]) this.sprites[i] = this.add.image(0, 0, key, 0);
    this.sprites[i].setTexture(key, 0).setPosition(p.x, p.y).setScale(scale).setRotation(rotation).setVisible(true);
  }
}
