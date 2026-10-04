import Phaser from 'phaser';
import type { AntType } from '../sim/ants';
import { gatherersOf } from '../sim/commands';
import type { FoodKind } from '../sim/food';
import type { GameScene } from './GameScene';

const HELP =
  'Left-click/drag: select ants or food   Right-click (two-finger, Ctrl+click): move / explore fog / gather\n' +
  'Swipe/wheel, WASD, right-drag: pan   Pinch, Ctrl+wheel, Q/E: zoom   Esc: deselect / menu';

const FOOD_NAMES: Record<FoodKind, string> = { crumbs: 'Bread crumbs', seeds: 'Seeds', berries: 'Berries' };

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffffff',
  backgroundColor: '#000000aa',
  padding: { x: 6, y: 4 },
};

/**
 * Screen-space overlay. Runs as its own scene so its camera never zooms or
 * scrolls with the world.
 */
export class HudScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private foodPanel!: Phaser.GameObjects.Container;
  private foodInfo!: Phaser.GameObjects.Text;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.status = this.add.text(10, 10, '', TEXT_STYLE);
    this.help = this.add.text(10, 0, HELP, TEXT_STYLE).setOrigin(0, 1);
    this.createFoodPanel();
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  /** Lets the game scene ignore clicks that land on HUD controls. */
  isOverUi(sx: number, sy: number): boolean {
    return this.foodPanel?.visible === true && this.foodPanel.getBounds().contains(sx, sy);
  }

  update(): void {
    const game = this.scene.get('Game') as GameScene;
    if (!game.state) return;
    const { state, player, selection } = game;

    const own: Record<AntType, number> = { worker: 0, soldier: 0, queen: 0 };
    const sel: Record<AntType, number> = { worker: 0, soldier: 0, queen: 0 };
    let idleWorkers = 0;
    for (const ant of state.ants) {
      if (ant.colony !== player.id) continue;
      own[ant.type]++;
      if (selection.selected.has(ant.id)) sel[ant.type]++;
      if (ant.type === 'worker' && ant.task.kind === 'idle') idleWorkers++;
    }
    const selTotal = sel.worker + sel.soldier + sel.queen;
    const selText = selTotal > 0 ? `   Selected: ${sel.worker} workers, ${sel.soldier} soldiers` : '';
    this.status.setText(
      `Food: ${player.food}   Workers: ${own.worker} (${idleWorkers} idle)   Soldiers: ${own.soldier}${selText}`,
    );

    const food = state.food.find((f) => f.id === selection.selectedFood);
    this.foodPanel.setVisible(!!food);
    if (food) {
      const gatherers = gatherersOf(state, player.id, food.id).length;
      this.foodInfo.setText(
        `${FOOD_NAMES[food.kind]}: ${food.amount} / ${food.max} left\nGatherers: ${gatherers} of ${own.worker} workers`,
      );
    }
  }

  private createFoodPanel(): void {
    this.foodInfo = this.add.text(0, 0, '', { ...TEXT_STYLE, backgroundColor: undefined });
    const minus = this.makeButton(0, 44, '  −  ', () => this.adjustGatherers(-1));
    const plus = this.makeButton(60, 44, '  +  ', () => this.adjustGatherers(1));
    const bg = this.add.rectangle(-8, -6, 300, 86, 0x000000, 0.75).setOrigin(0).setStrokeStyle(1, 0xffe14d);
    this.foodPanel = this.add.container(0, 0, [bg, this.foodInfo, minus, plus]).setVisible(false);
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const btn = this.add
      .text(x, y, label, { ...TEXT_STYLE, fontSize: '16px', backgroundColor: '#444444' })
      .setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setBackgroundColor('#666666'));
    btn.on('pointerout', () => btn.setBackgroundColor('#444444'));
    btn.on('pointerdown', onClick);
    return btn;
  }

  private adjustGatherers(delta: number): void {
    const game = this.scene.get('Game') as GameScene;
    const foodId = game.selection.selectedFood;
    if (foodId === null) return;
    const current = gatherersOf(game.state, game.player.id, foodId).length;
    game.issue({ type: 'setGatherers', foodId, count: Math.max(0, current + delta) });
  }

  private layout(): void {
    this.help.setY(this.scale.height - 10);
    this.foodPanel.setPosition(this.scale.width - 310, 16);
  }
}
