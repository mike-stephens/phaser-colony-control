import Phaser from 'phaser';
import { ART_SCALE, antKey, foodKey } from '../art/manifest';
import { ticksUntilUpkeep, upkeepDue, UPKEEP_INTERVAL_TICKS } from '../sim/economy';
import { TICK_MS } from '../sim/simulation';
import { colonyCapacity } from '../sim/underground';
import { CardCommand, commandsFor } from '../ui/commandCard';
import { makeIcons } from '../ui/icons';
import { Minimap } from '../ui/Minimap';
import { SelectionPanel } from '../ui/SelectionPanel';
import { COLORS, FONT, HUD_BOTTOM, HUD_TOP, SMALL, TEXT } from '../ui/theme';
import type { GameScene } from './GameScene';

const ALERT_TICKS = 60;
const MINIMAP = 164;
const SLOT = 54;
const SLOT_GAP = 4;
const CARD_W = 5 * SLOT + 4 * SLOT_GAP;
const CARD_H = 3 * SLOT + 2 * SLOT_GAP;
const PAD = 10;

const seconds = (ticks: number) => Math.ceil((ticks * TICK_MS) / 1000);
const clock = (ticks: number) => {
  const s = Math.floor((ticks * TICK_MS) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const HELP_TEXT = `MOUSE / TRACKPAD
  Left-click / drag ........ select ants, a nest or food (Shift adds)
  Right-click .............. context order: attack / gather / explore fog / move
                             (with a nest selected: set its rally point)
  Two-finger click, Ctrl+click = right-click
  Swipe or wheel ........... pan        Pinch or Ctrl+wheel ... zoom
  Right- or middle-drag .... pan        Minimap ............... click/drag to look,
  Pointer at screen edge ... pan                                right-click to order

KEYBOARD
  Arrows ... pan     + / - ... zoom     H ... next nest     . ... idle workers
  Command card letters (shown on each button): M move, S stop, A attack,
  X explore, G gather, R return/rally, B walls, F found nest, U underground,
  W/S/Q train worker/soldier/queen, E/D add/remove gatherers or builders
  Esc ... back out (cancel, deselect, then pause)    P ... pause    F1 or ? ... this help`;

/** A clickable text button for the top bar and overlays. */
class TextButton {
  readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, label: string, onClick: () => void, size = 14) {
    this.text = scene.add
      .text(0, 0, label, { ...TEXT, fontSize: `${size}px`, backgroundColor: '#3a3226', padding: { x: 10, y: 5 } })
      .setInteractive({ useHandCursor: true });
    this.text.on('pointerover', () => this.text.setBackgroundColor('#564a36'));
    this.text.on('pointerout', () => this.text.setBackgroundColor('#3a3226'));
    this.text.on('pointerdown', onClick);
  }
}

/** One square on the command card. */
class SlotView {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Image;
  readonly key: Phaser.GameObjects.Text;
  command: CardCommand | null = null;

  constructor(scene: Phaser.Scene, onHover: (hovering: boolean) => void) {
    this.bg = scene.add.rectangle(0, 0, SLOT, SLOT, COLORS.button).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
    this.icon = scene.add.image(0, 0, 'icon-move');
    this.key = scene.add.text(0, 0, '', { ...SMALL, fontSize: '11px', color: '#ffe14d' });
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', () => {
      if (this.command?.enabled) this.bg.setFillStyle(COLORS.buttonHover);
      onHover(true);
    });
    this.bg.on('pointerout', () => {
      this.paint();
      onHover(false);
    });
    this.bg.on('pointerdown', () => {
      if (this.command?.enabled) this.command.run();
    });
  }

  place(x: number, y: number): void {
    this.bg.setPosition(x, y);
    this.icon.setPosition(x + SLOT / 2, y + SLOT / 2 + 2);
    this.key.setPosition(x + 3, y + 1);
  }

  show(command: CardCommand | null): void {
    this.command = command;
    const visible = !!command;
    this.icon.setVisible(visible);
    this.key.setVisible(visible);
    this.bg.setAlpha(visible ? 1 : 0.35);
    if (!command) {
      this.bg.setFillStyle(COLORS.buttonDisabled).setStrokeStyle(1, COLORS.panelEdge);
      return;
    }
    if (this.icon.texture.key !== command.icon.key) this.icon.setTexture(command.icon.key, command.icon.frame ?? 0);
    const isAnt = command.icon.key.startsWith('ant-');
    this.icon.setRotation(isAnt ? -Math.PI / 2 : 0);
    const longest = Math.max(this.icon.frame.width, this.icon.frame.height);
    this.icon.setScale(Math.min(40 / longest, ART_SCALE * 2.2));
    this.icon.setAlpha(command.enabled ? 1 : 0.35);
    this.key.setText(command.hotkey === 'ESCAPE' ? 'Esc' : command.hotkey);
    this.paint();
  }

  private paint(): void {
    const c = this.command;
    if (!c) return;
    this.bg.setFillStyle(c.enabled ? COLORS.button : COLORS.buttonDisabled);
    this.bg.setStrokeStyle(c.active ? 2 : 1, c.active ? COLORS.accent : COLORS.panelEdge);
  }
}

/**
 * Screen-space HUD in its own scene (so it never zooms with the world).
 * StarCraft-style: resources across the top; minimap, selection details and
 * the command card across the bottom.
 */
export class HudScene extends Phaser.Scene {
  private bars!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private foodText!: Phaser.GameObjects.Text;
  private upkeepText!: Phaser.GameObjects.Text;
  private antsText!: Phaser.GameObjects.Text;
  private idleText!: Phaser.GameObjects.Text;
  private foodIcon!: Phaser.GameObjects.Image;
  private antIcon!: Phaser.GameObjects.Image;
  private idleIcon!: Phaser.GameObjects.Image;
  private helpButton!: TextButton;
  private menuButton!: TextButton;

  private starving!: Phaser.GameObjects.Text;
  private alert!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private toastUntil = 0;

  private minimap!: Minimap;
  private panel!: SelectionPanel;
  private slots: SlotView[] = [];
  private commands: CardCommand[] = [];
  private tooltip!: Phaser.GameObjects.Text;
  /** Index of the command-card slot under the pointer (commands are rebuilt every frame). */
  private hoveredSlot: number | null = null;

  private pauseMenu!: Phaser.GameObjects.Container;
  private gameOver!: Phaser.GameObjects.Container;
  private gameOverTitle!: Phaser.GameObjects.Text;
  private gameOverStats!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Container;

  constructor() {
    super('Hud');
  }

  private get game_(): GameScene {
    return this.scene.get('Game') as GameScene;
  }

  get helpOpen(): boolean {
    return !!this.help?.visible;
  }

  create(): void {
    makeIcons(this);
    const game = this.game_;
    this.bars = this.add.graphics();

    // ---- top bar
    this.clockText = this.add.text(0, 0, '', TEXT);
    this.foodIcon = this.add.image(0, 0, foodKey('crumbs')).setScale(0.32);
    this.foodText = this.add.text(0, 0, '', { ...TEXT, fontSize: '16px' });
    this.upkeepText = this.add.text(0, 0, '', SMALL);
    this.antIcon = this.add.image(0, 0, antKey(game.player.id, 'soldier'), 0).setScale(0.62).setRotation(-Math.PI / 2);
    this.antsText = this.add.text(0, 0, '', { ...TEXT, fontSize: '16px' });
    this.idleIcon = this.add.image(0, 0, antKey(game.player.id, 'worker'), 0).setScale(0.62).setRotation(-Math.PI / 2);
    this.idleText = this.add
      .text(0, 0, '', { ...TEXT, backgroundColor: '#3a3226', padding: { x: 6, y: 4 } })
      .setInteractive({ useHandCursor: true });
    this.idleText.on('pointerdown', () => this.game_.selectIdleWorkers());
    this.helpButton = new TextButton(this, '? Help', () => this.toggleHelp());
    this.menuButton = new TextButton(this, 'Menu', () => this.game_.togglePause());

    this.starving = this.add
      .text(0, 0, 'STARVING: not enough food for every ant!', { ...TEXT, backgroundColor: '#8b1a1a', padding: { x: 8, y: 4 } })
      .setVisible(false);
    this.alert = this.add
      .text(0, 0, '', { ...TEXT, backgroundColor: '#b33a00', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.toastText = this.add
      .text(0, 0, '', { ...TEXT, backgroundColor: '#1f5a1f', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 0)
      .setVisible(false)
      .setDepth(200);

    // ---- bottom bar
    this.minimap = new Minimap(this, () => this.game_, game.state.map.width, game.state.map.height);
    this.panel = new SelectionPanel(this);
    for (let i = 0; i < 15; i++) {
      this.slots.push(new SlotView(this, (on) => (this.hoveredSlot = on ? i : this.hoveredSlot === i ? null : this.hoveredSlot)));
    }
    this.tooltip = this.add
      .text(0, 0, '', { ...TEXT, backgroundColor: '#0f0c09ee', padding: { x: 10, y: 8 }, lineSpacing: 3 })
      .setOrigin(1, 1)
      .setVisible(false)
      .setDepth(120);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const ev = p.event as MouseEvent;
      if (p.leftButtonDown()) this.panel.click(p.x, p.y, ev.shiftKey);
    });

    this.createPauseMenu();
    this.createGameOver();
    this.createHelp();

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  /** True when a screen point is on the HUD, so clicks there aren't for the world. */
  isOverUi(_sx: number, sy: number): boolean {
    if (this.gameOver?.visible || this.pauseMenu?.visible || this.help?.visible) return true;
    if (this.scene.isActive('Underground')) return true;
    return sy < HUD_TOP || sy > this.scale.height - HUD_BOTTOM;
  }

  /** Runs the command-card command bound to a key, if any. */
  pressHotkey(key: string): boolean {
    const cmd = this.commands.find((c) => c.hotkey === key);
    if (!cmd) return false;
    if (cmd.enabled) cmd.run();
    else if (cmd.reason) this.toast(cmd.reason);
    return true;
  }

  toggleHelp(): void {
    this.help.setVisible(!this.help.visible);
  }

  /** Brief message under the top bar. */
  toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastUntil = this.time.now + 2200;
  }

  update(time: number): void {
    const game = this.game_;
    if (!game.state) return;
    const { state, player } = game;

    // ---- top bar
    let workers = 0;
    let soldiers = 0;
    let queens = 0;
    let idle = 0;
    for (const a of state.ants) {
      if (a.colony !== player.id) continue;
      if (a.type === 'worker') {
        workers++;
        if (a.task.kind === 'idle') idle++;
      } else if (a.type === 'soldier') soldiers++;
      else queens++;
    }
    this.clockText.setText(`${clock(state.tick)}${game.paused ? '  PAUSED' : ''}   ${state.difficulty}`);
    this.foodText.setText(`${player.food}`);
    this.upkeepText.setText(
      `eats ${upkeepDue(state, player.id)}/${seconds(UPKEEP_INTERVAL_TICKS)}s · next ${seconds(ticksUntilUpkeep(state))}s`,
    );
    this.antsText.setText(
      `${workers + soldiers + queens}/${colonyCapacity(player)}   W${workers} S${soldiers} Q${queens}`,
    );
    this.idleText.setText(`Idle ${idle}`).setColor(idle > 0 ? '#ffe14d' : '#9a917e');
    this.layoutTopBar();

    this.starving.setVisible(player.starving && state.winner === null);
    const nestHit = player.nests.some((n) => state.tick - n.lastHitTick < ALERT_TICKS);
    const antsHit = state.tick - player.lastAntHitTick < ALERT_TICKS;
    this.alert
      .setText(nestHit ? 'Your nest is under attack! (H to jump home)' : 'Your ants are under attack!')
      .setVisible((nestHit || antsHit) && state.winner === null);
    if (this.toastText.visible && this.time.now > this.toastUntil) this.toastText.setVisible(false);

    // ---- bottom bar
    this.minimap.update(time);
    this.panel.update(game);
    this.commands = state.winner === null && !player.eliminated ? commandsFor(game) : [];
    this.slots.forEach((slot, i) => slot.show(this.commands.find((c) => c.slot === i) ?? null));
    this.drawTooltip();

    this.pauseMenu.setVisible(game.paused && state.winner === null);
    this.updateGameOver();
  }

  private drawTooltip(): void {
    const c = this.hoveredSlot === null ? null : this.slots[this.hoveredSlot].command;
    if (!c) {
      this.tooltip.setVisible(false);
      return;
    }
    const lines = [c.title, c.detail];
    if (!c.enabled && c.reason) lines.push(`Not available: ${c.reason}`);
    this.tooltip.setText(lines.join('\n')).setVisible(true);
  }

  // ---------------------------------------------------------------- layout

  private layout(): void {
    const { width, height } = this.scale;
    const top = height - HUD_BOTTOM;
    const g = this.bars;
    g.clear();
    // Top bar.
    g.fillStyle(COLORS.panel, 0.96).fillRect(0, 0, width, HUD_TOP);
    g.lineStyle(2, COLORS.panelEdge).lineBetween(0, HUD_TOP - 1, width, HUD_TOP - 1);
    // Bottom bar with recessed wells for the minimap and the command card.
    g.fillStyle(COLORS.panel, 0.97).fillRect(0, top, width, HUD_BOTTOM);
    g.lineStyle(2, COLORS.panelEdge).lineBetween(0, top + 1, width, top + 1);
    const mmY = top + (HUD_BOTTOM - MINIMAP) / 2;
    g.fillStyle(0x000000).fillRect(PAD - 3, mmY - 3, MINIMAP + 6, MINIMAP + 6);
    g.lineStyle(2, COLORS.panelEdge).strokeRect(PAD - 3, mmY - 3, MINIMAP + 6, MINIMAP + 6);
    this.minimap.layout(PAD, mmY, MINIMAP);

    const cardX = width - PAD - CARD_W;
    const cardY = top + (HUD_BOTTOM - CARD_H) / 2;
    g.fillStyle(COLORS.panelInner).fillRect(cardX - 5, cardY - 5, CARD_W + 10, CARD_H + 10);
    this.slots.forEach((s, i) => s.place(cardX + (i % 5) * (SLOT + SLOT_GAP), cardY + Math.floor(i / 5) * (SLOT + SLOT_GAP)));
    this.tooltip.setPosition(width - PAD, top - 6);

    const panelX = PAD + MINIMAP + 14;
    this.panel.layout(panelX, top + 10, Math.max(120, cardX - 14 - panelX), HUD_BOTTOM - 20);

    this.starving.setPosition(PAD, HUD_TOP + 8);
    this.alert.setPosition(width / 2, HUD_TOP + 8);
    this.toastText.setPosition(width / 2, HUD_TOP + 40);
    for (const c of [this.pauseMenu, this.gameOver, this.help]) {
      c.setPosition(width / 2, height / 2);
      (c.getByName('dim') as Phaser.GameObjects.Rectangle).setPosition(-width / 2, -height / 2).setSize(width, height);
    }
    this.layoutTopBar();
  }

  /** Lays the top bar out left to right (widths change as the numbers do). */
  private layoutTopBar(): void {
    const mid = HUD_TOP / 2;
    let x = PAD;
    this.clockText.setPosition(x, mid).setOrigin(0, 0.5);
    x += Math.max(150, this.clockText.width + 24);
    this.foodIcon.setPosition(x + 10, mid);
    this.foodText.setPosition(x + 24, mid).setOrigin(0, 0.5);
    this.upkeepText.setPosition(x + 30 + this.foodText.width, mid).setOrigin(0, 0.5);
    x += 30 + this.foodText.width + this.upkeepText.width + 24;
    this.antIcon.setPosition(x + 10, mid);
    this.antsText.setPosition(x + 24, mid).setOrigin(0, 0.5);
    x += 24 + this.antsText.width + 24;
    this.idleIcon.setPosition(x + 10, mid);
    this.idleText.setPosition(x + 22, mid).setOrigin(0, 0.5);
    const right = this.scale.width - PAD;
    this.menuButton.text.setPosition(right, mid).setOrigin(1, 0.5);
    this.helpButton.text.setPosition(right - this.menuButton.text.width - 8, mid).setOrigin(1, 0.5);
  }

  // ---------------------------------------------------------------- overlays

  private overlay(width: number, height: number, depth: number, parts: Phaser.GameObjects.GameObject[]) {
    const dim = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.55).setOrigin(0).setName('dim');
    const card = this.add.rectangle(0, 0, width, height, COLORS.panel, 0.97).setStrokeStyle(2, COLORS.accent);
    return this.add.container(0, 0, [dim, card, ...parts]).setVisible(false).setDepth(depth);
  }

  private createPauseMenu(): void {
    const title = this.add.text(0, -110, 'PAUSED', { fontFamily: FONT, fontSize: '36px', color: '#ffffff' }).setOrigin(0.5);
    const unavailable = 'Could not save (storage full or blocked)';
    const buttons = [
      new TextButton(this, '      Resume      ', () => this.game_.togglePause(), 18),
      new TextButton(this, '    Save game     ', () => this.toast(this.game_.save() ? 'Game saved' : unavailable), 18),
      new TextButton(this, ' Save & quit to menu ', () => (this.game_.save() ? this.game_.toMenu() : this.toast(unavailable)), 18),
      new TextButton(this, ' Quit without saving ', () => this.game_.toMenu(), 18),
    ];
    buttons.forEach((b, i) => b.text.setPosition(0, -40 + i * 50).setOrigin(0.5));
    this.pauseMenu = this.overlay(360, 300, 150, [title, ...buttons.map((b) => b.text)]);
  }

  private createHelp(): void {
    const title = this.add.text(0, -190, 'CONTROLS', { fontFamily: FONT, fontSize: '26px', color: '#ffffff' }).setOrigin(0.5);
    const body = this.add.text(0, -150, HELP_TEXT, { ...TEXT, lineSpacing: 4 }).setOrigin(0.5, 0);
    const close = new TextButton(this, ' Close (Esc) ', () => this.toggleHelp(), 16);
    close.text.setPosition(0, 190).setOrigin(0.5);
    this.help = this.overlay(Math.max(760, body.width + 60), 440, 160, [title, body, close.text]);
  }

  private createGameOver(): void {
    this.gameOverTitle = this.add.text(0, -110, '', { fontFamily: FONT, fontSize: '56px', color: '#ffffff' }).setOrigin(0.5);
    this.gameOverStats = this.add.text(0, -30, '', { ...TEXT, fontSize: '16px' }).setOrigin(0.5, 0);
    const again = new TextButton(this, ' Play again (new map) ', () => this.game_.playAgain(), 18);
    const menu = new TextButton(this, ' Main menu ', () => this.game_.toMenu(), 18);
    again.text.setPosition(-125, 135).setOrigin(0.5);
    menu.text.setPosition(145, 135).setOrigin(0.5);
    this.gameOver = this.overlay(560, 360, 100, [this.gameOverTitle, this.gameOverStats, again.text, menu.text]);
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
    const enemy = state.colonies.find((c) => c.id !== player.id)!;
    const row = (label: string, f: (c: typeof player) => number) =>
      `${label.padEnd(16)}${String(f(player)).padStart(8)}${String(f(enemy)).padStart(8)}`;
    this.gameOverStats.setText(
      [
        `${won ? 'The red colony has fallen.' : 'Your colony has fallen.'}  Time ${clock(state.tick)} on ${state.difficulty}`,
        '',
        `${''.padEnd(16)}${'Black'.padStart(8)}${'Red'.padStart(8)}`,
        row('Food gathered', (c) => c.stats.gathered),
        row('Ants trained', (c) => c.stats.trained),
        row('Enemies killed', (c) => c.stats.kills),
        row('Ants lost', (c) => c.stats.losses),
      ].join('\n'),
    );
    this.gameOver.setVisible(true);
  }
}
