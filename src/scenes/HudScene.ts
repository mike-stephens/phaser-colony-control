import Phaser from 'phaser';
import type { AntType } from '../sim/ants';
import { gatherersOf } from '../sim/commands';
import {
  ANT_COST,
  MAX_QUEUE,
  POPULATION_CAP,
  ticksUntilUpkeep,
  trainBlocker,
  upkeepDue,
  UPKEEP_INTERVAL_TICKS,
} from '../sim/economy';
import type { FoodKind } from '../sim/food';
import { TICK_MS } from '../sim/simulation';
import type { GameScene } from './GameScene';

const HELP =
  'Left-click/drag: select ants, food or nest (H)   Right-click (two-finger, Ctrl+click): move / explore fog / gather / rally\n' +
  'Swipe/wheel, WASD, right-drag: pan   Pinch, Ctrl+wheel, Q/E: zoom   Esc: deselect / menu';

const FOOD_NAMES: Record<FoodKind, string> = { crumbs: 'Bread crumbs', seeds: 'Seeds', berries: 'Berries' };
const ANT_NAMES: Record<AntType, string> = { worker: 'Worker', soldier: 'Soldier', queen: 'Queen' };
const TRAINABLE: AntType[] = ['worker', 'soldier', 'queen'];

const PANEL_WIDTH = 340;
const ACCENT = 0xffe14d;
const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffffff',
  backgroundColor: '#000000aa',
  padding: { x: 6, y: 4 },
};
const PLAIN = { ...TEXT_STYLE, backgroundColor: undefined };

const seconds = (ticks: number) => Math.ceil((ticks * TICK_MS) / 1000);

/** A clickable text label that can be greyed out. */
class Button {
  readonly text: Phaser.GameObjects.Text;
  private enabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void) {
    this.text = scene.add
      .text(x, y, label, { ...TEXT_STYLE, backgroundColor: '#444444' })
      .setInteractive({ useHandCursor: true });
    this.text.on('pointerover', () => this.enabled && this.text.setBackgroundColor('#666666'));
    this.text.on('pointerout', () => this.paint());
    this.text.on('pointerdown', () => this.enabled && onClick());
  }

  set(label: string, enabled: boolean, visible = true): void {
    this.text.setText(label).setVisible(visible);
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.paint();
    }
  }

  private paint(): void {
    this.text.setBackgroundColor(this.enabled ? '#444444' : '#2a2a2a').setColor(this.enabled ? '#ffffff' : '#777777');
  }
}

/**
 * Screen-space overlay. Runs as its own scene so its camera never zooms or
 * scrolls with the world.
 */
export class HudScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private starving!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;

  private foodPanel!: Phaser.GameObjects.Container;
  private foodInfo!: Phaser.GameObjects.Text;

  private nestPanel!: Phaser.GameObjects.Container;
  private nestInfo!: Phaser.GameObjects.Text;
  private trainButtons!: Button[];
  private queueButtons!: Button[];
  private progress!: Phaser.GameObjects.Graphics;
  private nestHint!: Phaser.GameObjects.Text;

  constructor() {
    super('Hud');
  }

  private get game_(): GameScene {
    return this.scene.get('Game') as GameScene;
  }

  create(): void {
    this.status = this.add.text(10, 10, '', TEXT_STYLE);
    this.starving = this.add
      .text(10, 40, 'STARVING: not enough food for every ant. Gather more or they will die!', {
        ...TEXT_STYLE,
        backgroundColor: '#8b1a1a',
      })
      .setVisible(false);
    this.help = this.add.text(10, 0, HELP, TEXT_STYLE).setOrigin(0, 1);
    this.createFoodPanel();
    this.createNestPanel();
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  /** Lets the game scene ignore clicks that land on HUD controls. */
  isOverUi(sx: number, sy: number): boolean {
    return [this.foodPanel, this.nestPanel].some((p) => p?.visible && p.getBounds().contains(sx, sy));
  }

  update(): void {
    const game = this.game_;
    if (!game.state) return;
    const { state, player, selection } = game;

    const own: Record<AntType, number> = { worker: 0, soldier: 0, queen: 0 };
    let idleWorkers = 0;
    let selectedCount = 0;
    for (const ant of state.ants) {
      if (ant.colony !== player.id) continue;
      own[ant.type]++;
      if (selection.selected.has(ant.id)) selectedCount++;
      if (ant.type === 'worker' && ant.task.kind === 'idle') idleWorkers++;
    }
    const total = own.worker + own.soldier + own.queen;
    const due = upkeepDue(state, player.id);
    this.status.setText(
      `Food: ${player.food}   Eats ${due} every ${seconds(UPKEEP_INTERVAL_TICKS)}s (next in ${seconds(ticksUntilUpkeep(state))}s)   ` +
        `Ants: ${total}/${POPULATION_CAP}  W${own.worker} S${own.soldier} Q${own.queen}   Idle workers: ${idleWorkers}` +
        (selectedCount > 0 ? `   Selected: ${selectedCount}` : ''),
    );
    this.starving.setVisible(player.starving);

    this.updateFoodPanel(own.worker);
    this.updateNestPanel(total);
  }

  // ---------------------------------------------------------------- food panel

  private createFoodPanel(): void {
    this.foodInfo = this.add.text(0, 0, '', PLAIN);
    const minus = new Button(this, 0, 44, '  −  ', () => this.adjustGatherers(-1));
    const plus = new Button(this, 60, 44, '  +  ', () => this.adjustGatherers(1));
    const bg = this.panelBackground(86);
    this.foodPanel = this.add.container(0, 0, [bg, this.foodInfo, minus.text, plus.text]).setVisible(false);
  }

  private updateFoodPanel(workers: number): void {
    const { state, player, selection } = this.game_;
    const food = state.food.find((f) => f.id === selection.selectedFood);
    this.foodPanel.setVisible(!!food);
    if (!food) return;
    const gatherers = gatherersOf(state, player.id, food.id).length;
    this.foodInfo.setText(
      `${FOOD_NAMES[food.kind]}: ${food.amount} / ${food.max} left\nGatherers: ${gatherers} of ${workers} workers`,
    );
  }

  private adjustGatherers(delta: number): void {
    const game = this.game_;
    const foodId = game.selection.selectedFood;
    if (foodId === null) return;
    const current = gatherersOf(game.state, game.player.id, foodId).length;
    game.issue({ type: 'setGatherers', foodId, count: Math.max(0, current + delta) });
  }

  // ---------------------------------------------------------------- nest panel

  private createNestPanel(): void {
    this.nestInfo = this.add.text(0, 0, '', PLAIN);
    this.trainButtons = TRAINABLE.map(
      (type, i) => new Button(this, i * 110, 30, '', () => this.game_.issue({ type: 'train', antType: type })),
    );
    this.queueButtons = Array.from(
      { length: MAX_QUEUE },
      (_, i) => new Button(this, i * 64, 92, '', () => this.game_.issue({ type: 'cancelTraining', index: i })),
    );
    this.progress = this.add.graphics();
    this.nestHint = this.add.text(0, 124, '', { ...PLAIN, color: '#bbbbbb', fontSize: '12px' });
    const bg = this.panelBackground(150);
    this.nestPanel = this.add
      .container(0, 0, [
        bg,
        this.nestInfo,
        ...this.trainButtons.map((b) => b.text),
        this.add.text(0, 64, 'Training (click to cancel):', { ...PLAIN, fontSize: '12px', color: '#bbbbbb' }),
        ...this.queueButtons.map((b) => b.text),
        this.progress,
        this.nestHint,
      ])
      .setVisible(false);
  }

  private updateNestPanel(population: number): void {
    const { state, player, selection } = this.game_;
    this.nestPanel.setVisible(selection.selectedNest);
    if (!selection.selectedNest) return;

    this.nestInfo.setText(`Black colony nest          Ants ${population}/${POPULATION_CAP}`);
    TRAINABLE.forEach((type, i) => {
      const blocked = trainBlocker(state, player, type);
      this.trainButtons[i].set(`${ANT_NAMES[type]} ${ANT_COST[type].food}`, blocked === null);
    });

    this.progress.clear();
    this.queueButtons.forEach((btn, i) => {
      const type = player.queue[i];
      btn.set(type ? ANT_NAMES[type].slice(0, 4) : '', true, !!type);
    });
    const current = player.queue[0];
    if (current) {
      const frac = Math.min(1, player.progress / ANT_COST[current].ticks);
      const w = this.queueButtons[0].text.width;
      this.progress.fillStyle(0x000000, 0.8).fillRect(0, 118, w, 4);
      this.progress.fillStyle(ACCENT).fillRect(0, 118, w * frac, 4);
    }

    const hint = player.queue.length === 0 ? 'Nothing training. ' : '';
    const blockedAll = trainBlocker(state, player, 'worker');
    this.nestHint.setText(
      `${hint}${blockedAll && blockedAll !== 'Not enough food' ? blockedAll + '. ' : ''}Right-click the map to set the rally point.`,
    );
  }

  // ---------------------------------------------------------------- layout

  private panelBackground(height: number): Phaser.GameObjects.Rectangle {
    return this.add
      .rectangle(-10, -8, PANEL_WIDTH, height, 0x000000, 0.8)
      .setOrigin(0)
      .setStrokeStyle(1, ACCENT);
  }

  private layout(): void {
    this.help.setY(this.scale.height - 10);
    const x = this.scale.width - PANEL_WIDTH;
    this.foodPanel.setPosition(x, 80);
    this.nestPanel.setPosition(x, 80);
  }
}
