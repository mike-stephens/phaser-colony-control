import Phaser from 'phaser';
import type { AntType } from '../sim/ants';
import { buildersOf, gatherersOf } from '../sim/commands';
import { isExploredBy } from '../sim/fog';
import { worldToTile } from '../sim/map';
import { WALL_PEBBLES, openPlans } from '../sim/walls';
import { MAX_NESTS, MIN_NEST_SPACING, NEST_MAX_HP } from '../sim/state';
import { colonyCapacity } from '../sim/underground';
import {
  ANT_COST,
  MAX_QUEUE,
  ticksUntilUpkeep,
  trainBlocker,
  upkeepDue,
  UPKEEP_INTERVAL_TICKS,
} from '../sim/economy';
import type { FoodKind } from '../sim/food';
import { TICK_MS } from '../sim/simulation';
import type { GameScene } from './GameScene';

const HELP =
  'Left-click/drag: select ants, food or nest (H)   Right-click (two-finger, Ctrl+click): attack / gather / explore fog / move / rally\n' +
  'Swipe/wheel, WASD, right-drag: pan   Pinch/Ctrl+wheel, Q/E: zoom   B: walls   U: underground   Esc: back/pause';

const FOOD_NAMES: Record<FoodKind, string> = {
  crumbs: 'Bread crumbs',
  seeds: 'Seeds',
  berries: 'Berries',
  carcass: 'Spider carcass',
};
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
/** How long (ticks) an "under attack" alert stays up after the last bite. */
const ALERT_TICKS = 60;
const clock = (ticks: number) => {
  const s = Math.floor((ticks * TICK_MS) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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
  private alert!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private gameOver!: Phaser.GameObjects.Container;
  private gameOverTitle!: Phaser.GameObjects.Text;
  private gameOverStats!: Phaser.GameObjects.Text;

  private foodPanel!: Phaser.GameObjects.Container;
  private foodInfo!: Phaser.GameObjects.Text;

  private nestPanel!: Phaser.GameObjects.Container;
  private nestInfo!: Phaser.GameObjects.Text;
  private trainButtons!: Button[];
  private queueButtons!: Button[];
  private progress!: Phaser.GameObjects.Graphics;
  private nestHint!: Phaser.GameObjects.Text;

  private queenPanel!: Phaser.GameObjects.Container;
  private queenInfo!: Phaser.GameObjects.Text;
  private foundButton!: Button;

  private buildPanel!: Phaser.GameObjects.Container;
  private buildInfo!: Phaser.GameObjects.Text;

  private pauseMenu!: Phaser.GameObjects.Container;
  private toastText!: Phaser.GameObjects.Text;
  private toastUntil = 0;

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
    this.alert = this.add.text(0, 10, '', { ...TEXT_STYLE, backgroundColor: '#b33a00' }).setOrigin(0.5, 0);
    this.help = this.add.text(10, 0, HELP, TEXT_STYLE).setOrigin(0, 1);
    this.createFoodPanel();
    this.createNestPanel();
    this.createQueenPanel();
    this.createBuildPanel();
    this.createPauseMenu();
    this.createGameOver();
    this.toastText = this.add
      .text(0, 0, '', { ...TEXT_STYLE, backgroundColor: '#1f5a1f' })
      .setOrigin(0.5, 0)
      .setVisible(false)
      .setDepth(200);
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  /** Lets the game scene ignore clicks that land on HUD controls. */
  isOverUi(sx: number, sy: number): boolean {
    if (this.gameOver?.visible || this.pauseMenu?.visible) return true;
    if (this.scene.isActive('Underground')) return true;
    return [this.foodPanel, this.nestPanel, this.buildPanel, this.queenPanel].some(
      (p) => p?.visible && p.getBounds().contains(sx, sy),
    );
  }

  /** Brief message at the top of the screen. */
  toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastUntil = this.time.now + 2000;
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
      `${clock(state.tick)}${game.paused ? ' PAUSED' : ''}  [${state.difficulty}]   Food: ${player.food}   Eats ${due} every ${seconds(UPKEEP_INTERVAL_TICKS)}s (next in ${seconds(ticksUntilUpkeep(state))}s)   ` +
        `Ants: ${total}/${colonyCapacity(player)}  W${own.worker} S${own.soldier} Q${own.queen}   Idle workers: ${idleWorkers}` +
        (selectedCount > 0 ? `   Selected: ${selectedCount}` : ''),
    );
    this.starving.setVisible(player.starving);

    const nestHit = player.nests.some((n) => state.tick - n.lastHitTick < ALERT_TICKS);
    const antsHit = state.tick - player.lastAntHitTick < ALERT_TICKS;
    this.alert
      .setText(nestHit ? 'Your nest is under attack! (H to jump home)' : 'Your ants are under attack!')
      .setVisible((nestHit || antsHit) && state.winner === null);

    this.updateGameOver();
    this.updateBuildPanel(own.worker);
    this.updateQueenPanel();
    this.pauseMenu.setVisible(game.paused && state.winner === null);
    if (this.toastText.visible && this.time.now > this.toastUntil) this.toastText.setVisible(false);

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
    this.nestInfo = this.add.text(0, 0, '', { ...PLAIN, lineSpacing: 2 });
    const nestId = () => this.game_.selection.selectedNest ?? undefined;
    this.trainButtons = TRAINABLE.map(
      (type, i) =>
        new Button(this, i * 110, 44, '', () => this.game_.issue({ type: 'train', antType: type, nestId: nestId() })),
    );
    this.queueButtons = Array.from(
      { length: MAX_QUEUE },
      (_, i) =>
        new Button(this, i * 64, 106, '', () => this.game_.issue({ type: 'cancelTraining', index: i, nestId: nestId() })),
    );
    this.progress = this.add.graphics();
    this.nestHint = this.add.text(0, 138, '', { ...PLAIN, color: '#bbbbbb', fontSize: '12px' });
    const walls = new Button(this, 0, 162, 'Walls (B)', () => this.game_.setBuildMode(true));
    const underground = new Button(this, 110, 162, 'Underground (U)', () => this.game_.openUnderground());
    const bg = this.panelBackground(202);
    this.nestPanel = this.add
      .container(0, 0, [
        bg,
        this.nestInfo,
        ...this.trainButtons.map((b) => b.text),
        this.add.text(0, 78, 'Training (click to cancel):', { ...PLAIN, fontSize: '12px', color: '#bbbbbb' }),
        ...this.queueButtons.map((b) => b.text),
        this.progress,
        this.nestHint,
        walls.text,
        underground.text,
      ])
      .setVisible(false);
  }

  private updateNestPanel(population: number): void {
    const game = this.game_;
    const { state, player } = game;
    const nest = game.selectedNest;
    this.nestPanel.setVisible(!!nest && !player.eliminated && state.winner === null);
    if (!nest) return;

    const index = player.nests.indexOf(nest) + 1;
    const digging = nest.underground.dig ? '  (digging)' : '';
    this.nestInfo.setText(
      `Nest ${index} of ${player.nests.length}   HP ${Math.round(nest.hp)}/${NEST_MAX_HP}\n` +
        `Colony: ${population}/${colonyCapacity(player)} ants${digging}`,
    );
    TRAINABLE.forEach((type, i) => {
      const blocked = trainBlocker(state, player, nest, type);
      this.trainButtons[i].set(`${ANT_NAMES[type]} ${ANT_COST[type].food}`, blocked === null);
    });

    this.progress.clear();
    this.queueButtons.forEach((btn, i) => {
      const type = nest.queue[i];
      btn.set(type ? ANT_NAMES[type].slice(0, 4) : '', true, !!type);
    });
    const current = nest.queue[0];
    if (current) {
      const frac = Math.min(1, nest.progress / ANT_COST[current].ticks);
      const w = this.queueButtons[0].text.width;
      this.progress.fillStyle(0x000000, 0.8).fillRect(0, 132, w, 4);
      this.progress.fillStyle(ACCENT).fillRect(0, 132, w * frac, 4);
    }

    const blocked = trainBlocker(state, player, nest, 'worker');
    const note = blocked && blocked !== 'Not enough food' ? `${blocked}. ` : nest.queue.length === 0 ? 'Idle. ' : '';
    this.nestHint.setText(`${note}Right-click: rally point.  H: next nest`);
  }

  // ---------------------------------------------------------------- queen panel

  private createQueenPanel(): void {
    this.queenInfo = this.add.text(0, 0, '', { ...PLAIN, lineSpacing: 2 });
    this.foundButton = new Button(this, 0, 64, '', () => {
      const game = this.game_;
      game.setFoundMode(!game.selection.foundMode);
    });
    const bg = this.panelBackground(104);
    this.queenPanel = this.add.container(0, 0, [bg, this.queenInfo, this.foundButton.text]).setVisible(false);
  }

  private updateQueenPanel(): void {
    const game = this.game_;
    const queens = game.selectedQueens;
    const show = queens.length > 0 && game.state.winner === null && !game.selection.buildMode;
    this.queenPanel.setVisible(show && !this.nestPanel.visible && !this.foodPanel.visible);
    if (!this.queenPanel.visible) return;
    const atLimit = game.player.nests.length >= MAX_NESTS;
    if (game.selection.foundMode) {
      this.queenInfo.setText(
        `Click a site ${MIN_NEST_SPACING}+ tiles from every nest\n(outside the red circles; green = OK)`,
      );
      this.foundButton.set(' Cancel (Esc) ', true);
    } else {
      const founding = queens.some((q) => q.task.kind === 'found');
      this.queenInfo.setText(
        `${queens.length} queen${queens.length > 1 ? 's' : ''} selected` +
          (founding ? ' (on her way to found a nest)' : '') +
          `\nNests: ${game.player.nests.length}/${MAX_NESTS}`,
      );
      this.foundButton.set(atLimit ? ' Nest limit reached ' : ' Found new nest (F) ', !atLimit);
    }
  }

  // ---------------------------------------------------------------- build panel

  private createBuildPanel(): void {
    this.buildInfo = this.add.text(0, 0, '', { ...PLAIN, lineSpacing: 4 });
    const minus = new Button(this, 0, 124, '  −  ', () => this.adjustBuilders(-1));
    const plus = new Button(this, 60, 124, '  +  ', () => this.adjustBuilders(1));
    const done = new Button(this, 150, 124, ' Done (B) ', () => this.game_.setBuildMode(false));
    const bg = this.panelBackground(164);
    this.buildPanel = this.add.container(0, 0, [bg, this.buildInfo, minus.text, plus.text, done.text]).setVisible(false);
  }

  private updateBuildPanel(workers: number): void {
    const { state, player, selection } = this.game_;
    this.buildPanel.setVisible(selection.buildMode && state.winner === null);
    if (!this.buildPanel.visible) return;
    const plans = openPlans(state, player.id);
    const built = Object.values(state.walls).filter((w) => w.owner === player.id && w.built).length;
    const needed = plans.reduce((n, w) => n + WALL_PEBBLES - w.pebbles, 0);
    const knownPebbles = state.pebbles
      .filter((p) => isExploredBy(state, player.id, worldToTile(p.x), worldToTile(p.y)))
      .reduce((n, p) => n + p.amount, 0);
    const builders = buildersOf(state, player.id).length;
    this.buildInfo.setText(
      [
        'WALL BUILDING',
        'Drag: plan walls   Right-drag: remove',
        `Plans: ${plans.length} (need ${needed} pebbles)   Built: ${built}`,
        knownPebbles > 0 ? `Known pebbles: ${knownPebbles}` : 'No pebbles found yet: explore near rocks',
        `Builders: ${builders} of ${workers} workers`,
      ].join('\n'),
    );
  }

  private adjustBuilders(delta: number): void {
    const game = this.game_;
    const current = buildersOf(game.state, game.player.id).length;
    game.issue({ type: 'setBuilders', count: Math.max(0, current + delta) });
  }

  // ---------------------------------------------------------------- pause menu

  private createPauseMenu(): void {
    const dim = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.5).setOrigin(0).setName('dim');
    const card = this.add.rectangle(0, 0, 360, 300, 0x111111, 0.95).setStrokeStyle(2, ACCENT);
    const title = this.add.text(0, -110, 'PAUSED', { fontFamily: 'monospace', fontSize: '36px', color: '#ffffff' }).setOrigin(0.5);
    const buttons = [
      new Button(this, 0, -40, '      Resume      ', () => this.game_.togglePause()),
      new Button(this, 0, 10, '    Save game     ', () => this.toast(this.game_.save() ? 'Game saved' : 'Could not save (storage full or blocked)')),
      new Button(this, 0, 60, ' Save & quit to menu ', () => {
        if (this.game_.save()) this.game_.toMenu();
        else this.toast('Could not save (storage full or blocked)');
      }),
      new Button(this, 0, 110, ' Quit without saving ', () => this.game_.toMenu()),
    ];
    for (const b of buttons) b.text.setFontSize(18).setOrigin(0.5);
    this.pauseMenu = this.add
      .container(0, 0, [dim, card, title, ...buttons.map((b) => b.text)])
      .setVisible(false)
      .setDepth(150);
  }

  // ---------------------------------------------------------------- game over

  private createGameOver(): void {
    const dim = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.6).setOrigin(0);
    const card = this.add.rectangle(0, 0, 560, 360, 0x111111, 0.95).setStrokeStyle(2, ACCENT);
    this.gameOverTitle = this.add
      .text(0, -110, '', { fontFamily: 'monospace', fontSize: '56px', color: '#ffffff' })
      .setOrigin(0.5);
    this.gameOverStats = this.add
      .text(0, -30, '', { ...PLAIN, fontSize: '16px', align: 'left' })
      .setOrigin(0.5, 0);
    const again = new Button(this, -125, 135, ' Play again (new map) ', () => this.game_.playAgain());
    const menu = new Button(this, 145, 135, ' Main menu ', () => this.game_.toMenu());
    for (const b of [again, menu]) b.text.setFontSize(18).setOrigin(0.5);
    this.gameOver = this.add
      .container(0, 0, [dim, card, this.gameOverTitle, this.gameOverStats, again.text, menu.text])
      .setVisible(false)
      .setDepth(100);
    dim.setName('dim');
  }

  private updateGameOver(): void {
    const { state, player } = this.game_;
    if (state.winner === null) {
      this.gameOver.setVisible(false);
      return;
    }
    if (this.gameOver.visible) return;
    const won = state.winner === player.id;
    this.gameOverTitle.setText(won ? 'VICTORY' : 'DEFEAT').setColor(won ? '#7dff6a' : '#ff6a5a');
    const row = (label: string, f: (c: typeof player) => number) =>
      `${label.padEnd(16)}${String(f(player)).padStart(8)}${String(f(state.colonies.find((c) => c.id !== player.id)!)).padStart(8)}`;
    this.gameOverStats.setText(
      [
        `${won ? 'The red nest has fallen.' : 'Your nest has fallen.'}  Time ${clock(state.tick)} on ${state.difficulty}`,
        '',
        `${''.padEnd(16)}${'Black'.padStart(8)}${'Red'.padStart(8)}`,
        row('Food gathered', (c) => c.stats.gathered),
        row('Ants trained', (c) => c.stats.trained),
        row('Enemies killed', (c) => c.stats.kills),
        row('Ants lost', (c) => c.stats.losses),
      ].join('\n'),
    );
    this.foodPanel.setVisible(false);
    this.nestPanel.setVisible(false);
    this.gameOver.setVisible(true);
  }

  // ---------------------------------------------------------------- layout

  private panelBackground(height: number): Phaser.GameObjects.Rectangle {
    return this.add
      .rectangle(-10, -8, PANEL_WIDTH, height, 0x000000, 0.8)
      .setOrigin(0)
      .setStrokeStyle(1, ACCENT);
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.help.setY(height - 10);
    this.alert.setX(width / 2).setY(76);
    this.gameOver.setPosition(width / 2, height / 2);
    (this.gameOver.getByName('dim') as Phaser.GameObjects.Rectangle)
      .setPosition(-width / 2, -height / 2)
      .setSize(width, height);
    const x = this.scale.width - PANEL_WIDTH;
    this.foodPanel.setPosition(x, 80);
    this.nestPanel.setPosition(x, 80);
    this.queenPanel.setPosition(x, 80);
    this.buildPanel.setPosition(x, 80);
    this.toastText.setPosition(width / 2, 110);
    this.pauseMenu.setPosition(width / 2, height / 2);
    (this.pauseMenu.getByName('dim') as Phaser.GameObjects.Rectangle)
      .setPosition(-width / 2, -height / 2)
      .setSize(width, height);
  }
}
