import Phaser from 'phaser';
import type { AntType } from '../sim/ants';
import type { GameScene } from './GameScene';

const HELP =
  'Left-drag/click: select   Right-click (two-finger click, Ctrl+click): move\n' +
  'Swipe/wheel, WASD, right-drag: pan   Pinch, Ctrl+wheel, Q/E: zoom   Esc: deselect / menu';

/**
 * Screen-space overlay. Runs as its own scene so its camera never zooms or
 * scrolls with the world.
 */
export class HudScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;

  constructor() {
    super('Hud');
  }

  create(): void {
    const style = {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    };
    this.status = this.add.text(10, 10, '', style);
    this.help = this.add.text(10, 0, HELP, style).setOrigin(0, 1);
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  update(): void {
    const game = this.scene.get('Game') as GameScene;
    if (!game.state) return;
    const counts: Record<AntType, number> = { worker: 0, soldier: 0, queen: 0 };
    for (const ant of game.state.ants) {
      if (game.selection.selected.has(ant.id)) counts[ant.type]++;
    }
    const total = counts.worker + counts.soldier + counts.queen;
    const detail = total > 0 ? ` (${counts.worker} workers, ${counts.soldier} soldiers)` : '';
    this.status.setText(`Seed ${game.state.seed}   Selected: ${total}${detail}`);
  }

  private layout(): void {
    this.help.setY(this.scale.height - 10);
  }
}
