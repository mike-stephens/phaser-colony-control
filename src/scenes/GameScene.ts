import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { Terrain } from '../sim/map';
import { GameState, createNewGame } from '../sim/state';

// Placeholder colours until real tile art exists.
const TERRAIN_COLORS: Record<Terrain, number> = {
  [Terrain.Grass]: 0x4a7c3a,
  [Terrain.Dirt]: 0x8b6b43,
  [Terrain.Water]: 0x3a6ea5,
  [Terrain.Rock]: 0x7a7a7a,
  [Terrain.Hole]: 0x231a12,
};

const COLONY_COLORS = { black: 0x111111, red: 0xc0392b } as const;

const PAN_SPEED = 800; // screen px per second
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('Game');
  }

  init(data: { seed: number }): void {
    this.state = createNewGame(data.seed);
  }

  create(): void {
    this.drawMap();
    this.drawNests();
    this.setupCamera();
    this.setupInput();

    this.add
      .text(10, 10, `Seed: ${this.state.seed}   WASD/arrows or right-drag: pan   Wheel: zoom   Esc: menu`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 6, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  update(_time: number, delta: number): void {
    const cam = this.cameras.main;
    const step = (PAN_SPEED * delta) / 1000 / cam.zoom;
    const k = this.keys;
    if (k.left.isDown || k.a.isDown) cam.scrollX -= step;
    if (k.right.isDown || k.d.isDown) cam.scrollX += step;
    if (k.up.isDown || k.w.isDown) cam.scrollY -= step;
    if (k.down.isDown || k.s.isDown) cam.scrollY += step;
  }

  private drawMap(): void {
    const { map } = this.state;
    const g = this.add.graphics();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle(TERRAIN_COLORS[map.tiles[y * map.width + x]]);
        g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private drawNests(): void {
    for (const colony of this.state.colonies) {
      const cx = (colony.nest.x + 0.5) * TILE_SIZE;
      const cy = (colony.nest.y + 0.5) * TILE_SIZE;
      this.add.circle(cx, cy, TILE_SIZE * 0.8, COLONY_COLORS[colony.id]).setStrokeStyle(3, 0xffffff);
    }
  }

  private setupCamera(): void {
    const { map } = this.state;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);
    const player = this.state.colonies.find((c) => c.isPlayer)!;
    cam.centerOn((player.nest.x + 0.5) * TILE_SIZE, (player.nest.y + 0.5) * TILE_SIZE);
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey('UP'),
      down: kb.addKey('DOWN'),
      left: kb.addKey('LEFT'),
      right: kb.addKey('RIGHT'),
      w: kb.addKey('W'),
      a: kb.addKey('A'),
      s: kb.addKey('S'),
      d: kb.addKey('D'),
    };
    kb.on('keydown-ESC', () => this.scene.start('Menu'));

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM));
    });

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
  }
}
