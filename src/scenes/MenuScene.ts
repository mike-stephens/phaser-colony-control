import Phaser from 'phaser';
import { randomSeed } from '../sim/rng';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    // Dev shortcut: ?seed=123 skips the menu and starts that exact map.
    const seedParam = new URLSearchParams(window.location.search).get('seed');
    if (seedParam !== null && !Number.isNaN(Number(seedParam))) {
      this.scene.start('Game', { seed: Number(seedParam) >>> 0 });
      return;
    }

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private layout(): void {
    this.children.removeAll(true);
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add
      .text(cx, height * 0.3, 'COLONY CONTROL', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#e8e8e8',
      })
      .setOrigin(0.5);

    this.makeButton(cx, height * 0.5, 'New Game', true, () => {
      this.scene.start('Game', { seed: randomSeed() });
    });
    this.makeButton(cx, height * 0.5 + 64, 'Load Game (coming soon)', false, () => {});
  }

  private makeButton(x: number, y: number, label: string, enabled: boolean, onClick: () => void): void {
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: enabled ? '#ffffff' : '#666666',
        backgroundColor: '#333333',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5);

    if (!enabled) return;
    text.setInteractive({ useHandCursor: true });
    text.on('pointerover', () => text.setBackgroundColor('#555555'));
    text.on('pointerout', () => text.setBackgroundColor('#333333'));
    text.on('pointerdown', onClick);
  }
}
