import Phaser from 'phaser';
import { AI_PROFILES, Difficulty } from '../sim/difficulty';
import { randomSeed } from '../sim/rng';

const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: 'easy', label: 'Easy', blurb: 'Red attacks late in small groups' },
  { id: 'medium', label: 'Medium', blurb: 'A fair fight' },
  { id: 'hard', label: 'Hard', blurb: 'Early, large attacks' },
];

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    // Dev shortcut: ?seed=123[&difficulty=hard] skips the menu and starts that exact map.
    const params = new URLSearchParams(window.location.search);
    const seedParam = params.get('seed');
    if (seedParam !== null && !Number.isNaN(Number(seedParam))) {
      const d = params.get('difficulty');
      const difficulty: Difficulty = d === 'easy' || d === 'hard' ? d : 'medium';
      this.scene.start('Game', { seed: Number(seedParam) >>> 0, difficulty });
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
      .text(cx, height * 0.25, 'COLONY CONTROL', { fontFamily: 'monospace', fontSize: '48px', color: '#e8e8e8' })
      .setOrigin(0.5);
    this.add
      .text(cx, height * 0.25 + 48, 'Lead the black ants. Destroy the red nest.', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#999999',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, height * 0.45, 'New game', { fontFamily: 'monospace', fontSize: '20px', color: '#cccccc' })
      .setOrigin(0.5);
    const spacing = Math.min(220, (width - 40) / 3);
    DIFFICULTIES.forEach((d, i) => {
      const x = cx + (i - 1) * spacing;
      const y = height * 0.45 + 50;
      this.makeButton(x, y, d.label, true, () =>
        this.scene.start('Game', { seed: randomSeed(), difficulty: d.id }),
      );
      const bonus = AI_PROFILES[d.id].gatherMultiplier;
      const note = bonus === 1 ? '' : `\nRed gathers ${bonus}x food`;
      this.add
        .text(x, y + 36, d.blurb + note, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#888888',
          align: 'center',
          wordWrap: { width: spacing - 16 },
        })
        .setOrigin(0.5, 0);
    });

    this.makeButton(cx, height * 0.75, 'Load Game (coming soon)', false, () => {});
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
