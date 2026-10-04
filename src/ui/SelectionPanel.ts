import Phaser from 'phaser';
import { ART_SCALE, antKey, foodKey, nestKey } from '../art/manifest';
import { ANT_STATS, Ant, AntType } from '../sim/ants';
import { buildersOf, gatherersOf } from '../sim/commands';
import { ANT_COST } from '../sim/economy';
import { isExploredBy } from '../sim/fog';
import type { FoodKind } from '../sim/food';
import { worldToTile } from '../sim/map';
import { MIN_NEST_SPACING, NEST_MAX_HP } from '../sim/state';
import { colonyCapacity } from '../sim/underground';
import { WALL_PEBBLES, openPlans } from '../sim/walls';
import type { GameScene } from '../scenes/GameScene';
import { COLORS, FONT, SMALL, TEXT } from './theme';

const NAMES: Record<AntType, string> = { worker: 'Worker', soldier: 'Soldier', queen: 'Queen' };
const FOOD_NAMES: Record<FoodKind, string> = {
  crumbs: 'Bread crumbs',
  seeds: 'Seeds',
  berries: 'Berries',
  carcass: 'Spider carcass',
};
const CELL = 38;

interface Hotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: (shift: boolean) => void;
}

/**
 * The middle of the bottom bar: details of whatever is selected. Redrawn
 * every frame from pooled text/image objects; clickable areas (group icons,
 * queued eggs) are registered as hotspots.
 */
export class SelectionPanel {
  private g: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private images: Phaser.GameObjects.Image[] = [];
  private textIdx = 0;
  private imageIdx = 0;
  private hotspots: Hotspot[] = [];
  private x = 0;
  private y = 0;
  private w = 300;
  private h = 160;

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics();
  }

  layout(x: number, y: number, w: number, h: number): void {
    Object.assign(this, { x, y, w, h });
  }

  /** Handles a click inside the panel; returns true if something was clicked. */
  click(px: number, py: number, shift: boolean): boolean {
    const hit = this.hotspots.find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
    hit?.onClick(shift);
    return !!hit;
  }

  update(game: GameScene): void {
    this.g.clear();
    this.textIdx = 0;
    this.imageIdx = 0;
    this.hotspots = [];
    this.g.fillStyle(COLORS.panelInner, 0.9).fillRect(this.x, this.y, this.w, this.h);
    this.g.lineStyle(1, COLORS.panelEdge).strokeRect(this.x, this.y, this.w, this.h);

    const { selection, state, player } = game;
    if (selection.buildMode) this.drawBuild(game);
    else if (selection.targeting) this.drawTargeting(game);
    else if (game.selectedAnts.length === 1) this.drawAnt(game.selectedAnts[0]);
    else if (game.selectedAnts.length > 1) this.drawGroup(game, game.selectedAnts);
    else if (game.selectedNest) this.drawNest(game);
    else if (state.food.some((f) => f.id === selection.selectedFood)) this.drawFood(game);
    else this.drawNothing(player.nests.length);

    for (let i = this.textIdx; i < this.texts.length; i++) this.texts[i].setVisible(false);
    for (let i = this.imageIdx; i < this.images.length; i++) this.images[i].setVisible(false);
  }

  // ---------------------------------------------------------------- views

  private drawAnt(ant: Ant): void {
    const stats = ANT_STATS[ant.type];
    this.portrait(antKey(ant.colony, ant.type), 0);
    const x = this.x + 112;
    this.text(x, this.y + 12, NAMES[ant.type], { ...TEXT, fontSize: '18px' });
    this.bar(x, this.y + 40, 160, 10, ant.hp / stats.maxHp, `${Math.ceil(ant.hp)} / ${stats.maxHp} HP`);
    this.text(x, this.y + 70, describeTask(ant), TEXT);
    this.text(
      x,
      this.y + 96,
      `Bite ${stats.damage}/s   Speed ${Math.round(stats.speed / 32)} tiles/s   Sight ${stats.sight}`,
      SMALL,
    );
    if (ant.carrying > 0) this.text(x, this.y + 116, `Carrying ${ant.carrying} food`, SMALL);
    if (ant.pebble) this.text(x, this.y + 116, 'Carrying a pebble', SMALL);
  }

  private drawGroup(game: GameScene, ants: Ant[]): void {
    const counts = { worker: 0, soldier: 0, queen: 0 };
    for (const a of ants) counts[a.type]++;
    const summary = (Object.keys(counts) as AntType[])
      .filter((t) => counts[t] > 0)
      .map((t) => `${counts[t]} ${NAMES[t].toLowerCase()}${counts[t] > 1 ? 's' : ''}`)
      .join(', ');
    this.text(this.x + 10, this.y + 8, `${ants.length} selected: ${summary}`, TEXT);
    this.text(this.x + this.w - 10, this.y + 8, 'click: only that ant  shift: remove', SMALL).setOrigin(1, 0);

    const cols = Math.max(1, Math.floor((this.w - 20) / CELL));
    const rows = Math.max(1, Math.floor((this.h - 36) / CELL));
    const shown = ants.slice(0, cols * rows);
    // Soldiers first, like StarCraft groups by type.
    const order: Record<AntType, number> = { soldier: 0, queen: 1, worker: 2 };
    shown.sort((a, b) => order[a.type] - order[b.type] || a.id - b.id);
    shown.forEach((ant, i) => {
      const cx = this.x + 10 + (i % cols) * CELL;
      const cy = this.y + 32 + Math.floor(i / cols) * CELL;
      this.g.fillStyle(COLORS.button).fillRect(cx, cy, CELL - 4, CELL - 4);
      this.image(antKey(ant.colony, ant.type), cx + (CELL - 4) / 2, cy + (CELL - 4) / 2 - 2, 34);
      const frac = ant.hp / ANT_STATS[ant.type].maxHp;
      this.g.fillStyle(0x000000).fillRect(cx + 3, cy + CELL - 10, CELL - 10, 3);
      this.g.fillStyle(frac > 0.5 ? COLORS.good : COLORS.danger).fillRect(cx + 3, cy + CELL - 10, (CELL - 10) * frac, 3);
      this.hotspots.push({
        x: cx,
        y: cy,
        w: CELL - 4,
        h: CELL - 4,
        onClick: (shift) => {
          if (shift) game.selection.selected.delete(ant.id);
          else game.selectOnly(ant.id);
        },
      });
    });
    if (ants.length > shown.length) {
      this.text(this.x + this.w - 10, this.y + this.h - 18, `+${ants.length - shown.length} more`, SMALL).setOrigin(1, 0);
    }
  }

  private drawNest(game: GameScene): void {
    const { player, state } = game;
    const nest = game.selectedNest!;
    this.portrait(nestKey(player.id), 0);
    const x = this.x + 112;
    const index = player.nests.indexOf(nest) + 1;
    this.text(x, this.y + 10, `Nest ${index} of ${player.nests.length}`, { ...TEXT, fontSize: '18px' });
    this.bar(x, this.y + 36, 180, 10, nest.hp / NEST_MAX_HP, `${Math.round(nest.hp)} / ${NEST_MAX_HP} HP`);
    const ants = state.ants.filter((a) => a.colony === player.id).length;
    const dig = nest.underground.dig;
    this.text(
      x,
      this.y + 58,
      `Colony ${ants}/${colonyCapacity(player)} ants` +
        (dig ? `   digging ${Math.floor((dig.progress / dig.needed) * 100)}%` : ''),
      SMALL,
    );

    this.text(x, this.y + 80, nest.queue.length ? 'Training (click to cancel):' : 'Nothing training', SMALL);
    nest.queue.forEach((type, i) => {
      const cx = x + i * (CELL + 2);
      const cy = this.y + 98;
      this.g.fillStyle(COLORS.button).fillRect(cx, cy, CELL, CELL);
      this.image(antKey(player.id, type), cx + CELL / 2, cy + CELL / 2, 36);
      if (i === 0) {
        const frac = Math.min(1, nest.progress / ANT_COST[type].ticks);
        this.g.fillStyle(0x000000).fillRect(cx, cy + CELL + 2, CELL, 4);
        this.g.fillStyle(COLORS.accent).fillRect(cx, cy + CELL + 2, CELL * frac, 4);
      }
      this.hotspots.push({
        x: cx,
        y: cy,
        w: CELL,
        h: CELL,
        onClick: () => game.issue({ type: 'cancelTraining', index: i, nestId: nest.id }),
      });
    });
  }

  private drawFood(game: GameScene): void {
    const { state, player, selection } = game;
    const food = state.food.find((f) => f.id === selection.selectedFood)!;
    this.portrait(foodKey(food.kind), 0);
    const x = this.x + 112;
    this.text(x, this.y + 12, FOOD_NAMES[food.kind], { ...TEXT, fontSize: '18px' });
    this.bar(x, this.y + 40, 180, 10, food.amount / food.max, `${food.amount} / ${food.max} food left`, COLORS.accent);
    const workers = state.ants.filter((a) => a.colony === player.id && a.type === 'worker').length;
    this.text(x, this.y + 70, `Gatherers: ${gatherersOf(state, player.id, food.id).length} of ${workers} workers`, TEXT);
    this.text(x, this.y + 96, 'E / D add or remove gatherers', SMALL);
  }

  private drawBuild(game: GameScene): void {
    const { state, player } = game;
    const plans = openPlans(state, player.id);
    const built = Object.values(state.walls).filter((w) => w.owner === player.id && w.built).length;
    const needed = plans.reduce((n, w) => n + WALL_PEBBLES - w.pebbles, 0);
    const pebbles = state.pebbles
      .filter((p) => isExploredBy(state, player.id, worldToTile(p.x), worldToTile(p.y)))
      .reduce((n, p) => n + p.amount, 0);
    const workers = state.ants.filter((a) => a.colony === player.id && a.type === 'worker').length;
    this.text(this.x + 12, this.y + 10, 'Wall building', { ...TEXT, fontSize: '18px' });
    this.text(this.x + 12, this.y + 40, 'Drag on the map to plan walls, right-drag to remove.', TEXT);
    this.text(this.x + 12, this.y + 64, `Plans: ${plans.length} (need ${needed} pebbles)   Built: ${built}`, TEXT);
    this.text(
      this.x + 12,
      this.y + 88,
      pebbles > 0 ? `Known pebbles: ${pebbles}` : 'No pebbles found yet: explore near rocks',
      TEXT,
    );
    this.text(this.x + 12, this.y + 112, `Builders: ${buildersOf(state, player.id).length} of ${workers} workers`, TEXT);
  }

  private drawTargeting(game: GameScene): void {
    const help: Record<string, string> = {
      move: 'Click where to move.',
      attack: 'Click an enemy, spider or nest to attack it,\nor the ground to attack-move there.',
      gather: 'Click a food source to gather it.',
      explore: 'Click an area to explore.',
      rally: "Click where this nest's new ants should gather.",
      found: `Click a site at least ${MIN_NEST_SPACING} tiles from every nest\n(outside the red circles; the cursor turns green when OK).`,
    };
    this.text(this.x + 12, this.y + 12, 'Choose a target', { ...TEXT, fontSize: '18px' });
    this.text(this.x + 12, this.y + 44, help[game.selection.targeting!], TEXT);
    this.text(this.x + 12, this.y + this.h - 26, 'Right-click or Esc to cancel', SMALL);
  }

  private drawNothing(nests: number): void {
    this.text(this.x + 12, this.y + 12, 'Nothing selected', { ...TEXT, fontSize: '18px' });
    this.text(
      this.x + 12,
      this.y + 44,
      [
        'Drag to select ants. Right-click to give orders.',
        nests > 0 ? 'Click a nest (or press H) to train ants.' : '',
        "Press . for idle workers, ? for all controls.",
      ]
        .filter(Boolean)
        .join('\n'),
      { ...TEXT, lineSpacing: 6 },
    );
  }

  // ---------------------------------------------------------------- drawing helpers

  private portrait(key: string, frame: number): void {
    const px = this.x + 10;
    const py = this.y + 10;
    this.g.fillStyle(COLORS.button).fillRect(px, py, 92, this.h - 20);
    this.g.lineStyle(1, COLORS.panelEdge).strokeRect(px, py, 92, this.h - 20);
    this.image(key, px + 46, py + (this.h - 20) / 2, 80, frame);
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, label: string, color?: number): void {
    const f = Math.max(0, Math.min(1, frac));
    this.g.fillStyle(0x000000).fillRect(x, y, w, h);
    this.g.fillStyle(color ?? (f > 0.5 ? COLORS.good : f > 0.25 ? 0xe0b13a : COLORS.danger)).fillRect(x, y, w * f, h);
    this.text(x + w + 8, y - 3, label, SMALL);
  }

  private text(x: number, y: number, value: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    let t = this.texts[this.textIdx];
    if (!t) {
      t = this.scene.add.text(0, 0, '', { fontFamily: FONT });
      this.texts.push(t);
    }
    this.textIdx++;
    return t.setStyle(style).setText(value).setPosition(x, y).setOrigin(0, 0).setVisible(true);
  }

  /** An image fitted inside a `box` px square, ants turned to face up. */
  private image(key: string, x: number, y: number, box: number, frame = 0): void {
    let img = this.images[this.imageIdx];
    if (!img) {
      img = this.scene.add.image(0, 0, key, frame);
      this.images.push(img);
    }
    this.imageIdx++;
    img.setTexture(key, frame).setPosition(x, y).setVisible(true);
    const isAnt = key.startsWith('ant-');
    img.setRotation(isAnt ? -Math.PI / 2 : 0);
    const longest = Math.max(img.frame.width, img.frame.height);
    img.setScale(Math.min(box / longest, ART_SCALE * 3));
  }
}

function describeTask(ant: Ant): string {
  const t = ant.task;
  switch (t.kind) {
    case 'idle':
      return ant.path.length > 0 || ant.moveTarget ? 'Moving' : 'Idle';
    case 'explore':
      return 'Exploring';
    case 'gather':
      return { toFood: 'Heading to food', harvesting: 'Gathering', toNest: 'Carrying food home' }[t.phase];
    case 'build':
      return ant.pebble ? 'Carrying a pebble to a wall' : 'Fetching pebbles for walls';
    case 'attack':
      return 'nest' in t.target ? 'Raiding a nest' : 'creature' in t.target ? 'Fighting a spider' : 'Fighting';
    case 'attackMove':
      return 'Attack-moving';
    case 'found':
      return 'Off to found a new nest';
  }
}
