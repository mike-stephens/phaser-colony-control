import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';
import { deleteSave, writeSave } from '../persistence/saves';
import { AntLayer } from '../render/AntLayer';
import { CreatureLayer } from '../render/CreatureLayer';
import { DEPTH } from '../render/depths';
import { FogLayer } from '../render/FogLayer';
import { FoodLayer } from '../render/FoodLayer';
import { TERRAIN_TEXTURE, generatePlaceholderTextures } from '../render/textures';
import { WallLayer } from '../render/WallLayer';
import { ANT_STATS, Ant } from '../sim/ants';
import { Command, issueCommand } from '../sim/commands';
import { Difficulty } from '../sim/difficulty';
import { isExploredBy, isVisibleTo } from '../sim/fog';
import { findFoodAt } from '../sim/food';
import { Point, worldToTile } from '../sim/map';
import { randomSeed } from '../sim/rng';
import { TICK_MS, stepSimulation } from '../sim/simulation';
import { Colony, ColonyId, GameState, NEST_MAX_HP, NEST_RADIUS, createNewGame, nestPoint } from '../sim/state';
import { wallPlanBlocker } from '../sim/walls';
import { CREATURE_STATS, Creature } from '../sim/wildlife';
import type { HudScene } from './HudScene';

const COLONY_COLORS = { black: 0x111111, red: 0xc0392b } as const;
const MARKER_COLORS = { move: 0x7dff6a, explore: 0x6ac8ff, gather: 0xffe14d, attack: 0xff4d4d } as const;
/** Cap on catch-up after a long frame (e.g. a backgrounded tab). */
const MAX_FRAME_MS = 250;
/** Game time between autosaves (ticks). */
const AUTOSAVE_TICKS = 20 * 120;

export interface GameSceneData {
  seed?: number;
  difficulty?: Difficulty;
  /** A saved game to resume instead of starting a new one. */
  load?: GameState;
}

export class GameScene extends Phaser.Scene {
  state!: GameState;
  player!: Colony;
  selection!: SelectionController;
  paused = false;
  private cameraCtl!: CameraController;
  private ants!: AntLayer;
  private creatures!: CreatureLayer;
  private foods!: FoodLayer;
  private walls!: WallLayer;
  private fog!: FogLayer;
  private overlay!: Phaser.GameObjects.Graphics;
  private nests = new Map<ColonyId, Phaser.GameObjects.Arc>();
  private accumulator = 0;
  private lastAutosaveTick = 0;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.state = data.load ?? createNewGame(data.seed ?? randomSeed(), data.difficulty ?? 'medium');
    this.player = this.state.colonies.find((c) => c.isPlayer)!;
    this.accumulator = 0;
    this.paused = false;
    this.lastAutosaveTick = this.state.tick;
    this.nests.clear();
  }

  create(): void {
    const { map } = this.state;
    generatePlaceholderTextures(this);
    this.drawMap();
    this.drawNests();
    this.walls = new WallLayer(this);
    this.foods = new FoodLayer(this);
    this.ants = new AntLayer(this);
    this.creatures = new CreatureLayer(this);
    this.fog = new FogLayer(this, map.width, map.height);
    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);

    this.cameraCtl = new CameraController(this, map.width * TILE_SIZE, map.height * TILE_SIZE);
    this.selection = new SelectionController(this, this.cameraCtl, {
      colony: this.player.id,
      getState: () => this.state,
      onCommand: (antIds, target) => this.orderTo(antIds, target),
      onRally: (target) => this.issue({ type: 'setRally', target }),
      foodAt: (p) => this.knownFoodAt(p),
      isOnNest: (p) => dist(p, this.nestCenter) <= NEST_RADIUS + 4,
      isOverUi: (sx, sy) => (this.scene.get('Hud') as HudScene).isOverUi(sx, sy),
      onPaintWall: (p, erase) => {
        const tile = { x: worldToTile(p.x), y: worldToTile(p.y) };
        this.issue(erase ? { type: 'removeWalls', tiles: [tile] } : { type: 'planWalls', tiles: [tile] });
      },
    });
    this.cameras.main.centerOn(this.nestCenter.x, this.nestCenter.y);

    const kb = this.input.keyboard!;
    // Esc backs out one level: build mode, then selection, then pause.
    kb.on('keydown-ESC', () => {
      if (this.selection.buildMode) this.setBuildMode(false);
      else if (this.selection.hasSelection) this.selection.clear();
      else this.togglePause();
    });
    kb.on('keydown-P', () => this.togglePause());
    kb.on('keydown-B', () => this.setBuildMode(!this.selection.buildMode));
    // H: select the nest and jump the camera home.
    kb.on('keydown-H', () => {
      if (this.player.eliminated) return;
      this.selection.selectNest();
      this.cameras.main.centerOn(this.nestCenter.x, this.nestCenter.y);
    });

    this.scene.launch('Hud');
    this.events.once('shutdown', () => this.scene.stop('Hud'));
  }

  update(_time: number, delta: number): void {
    this.cameraCtl.update(delta);

    if (this.state.winner === null && !this.paused) {
      this.accumulator += Math.min(delta, MAX_FRAME_MS);
      while (this.accumulator >= TICK_MS) {
        stepSimulation(this.state);
        this.accumulator -= TICK_MS;
      }
      if (this.state.tick - this.lastAutosaveTick >= AUTOSAVE_TICKS) this.autosave();
    }

    const { state, player } = this;
    const sees = (p: Point) => isVisibleTo(state, player.id, worldToTile(p.x), worldToTile(p.y));
    this.selection.prune();
    const alpha = this.paused ? 1 : this.accumulator / TICK_MS;
    this.ants.sync(state.ants, alpha, state.tick, this.selection.selected, (a) => a.colony === player.id || sees(a));
    this.creatures.sync(state.creatures, alpha, state.tick, sees);
    this.foods.sync(state.food, this.selection.selectedFood, this.cameras.main.zoom);
    this.walls.sync(state, player.id, (tx, ty) => isExploredBy(state, player.id, tx, ty), true);
    this.fog.update(state, player.id);
    this.drawOverlay();
  }

  get nestCenter(): Point {
    return nestPoint(this.state, this.player.id);
  }

  /** Issues a command on behalf of the human player. */
  issue(command: Command): void {
    issueCommand(this.state, this.player.id, command);
  }

  setBuildMode(on: boolean): void {
    if (on && (this.player.eliminated || this.state.winner)) return;
    this.selection.buildMode = on;
    if (on) this.selection.clear();
  }

  togglePause(): void {
    if (this.state.winner !== null) return;
    this.paused = !this.paused;
  }

  save(): boolean {
    return writeSave('manual', this.state);
  }

  private autosave(): void {
    this.lastAutosaveTick = this.state.tick;
    if (writeSave('auto', this.state)) (this.scene.get('Hud') as HudScene).toast('Autosaved');
  }

  toMenu(): void {
    // A finished game isn't worth continuing; don't leave it as the autosave.
    if (this.state.winner !== null) deleteSave('auto');
    this.scene.start('Menu');
  }

  playAgain(): void {
    deleteSave('auto');
    this.scene.restart({ seed: randomSeed(), difficulty: this.state.difficulty });
  }

  /** Right-click: attack enemies or creatures, gather known food, explore unexplored ground, otherwise move. */
  private orderTo(antIds: number[], target: Point): number {
    const creature = this.visibleCreatureAt(target);
    if (creature) {
      this.issue({ type: 'attack', antIds, target: { creature: creature.id } });
      return MARKER_COLORS.attack;
    }
    const enemy = this.visibleEnemyAt(target);
    if (enemy) {
      this.issue({ type: 'attack', antIds, target: { ant: enemy.id } });
      return MARKER_COLORS.attack;
    }
    const enemyNest = this.knownEnemyNestAt(target);
    if (enemyNest) {
      this.issue({ type: 'attack', antIds, target: { nest: enemyNest.id } });
      return MARKER_COLORS.attack;
    }
    const foodId = this.knownFoodAt(target);
    if (foodId !== null) {
      this.issue({ type: 'gather', antIds, foodId });
      return MARKER_COLORS.gather;
    }
    if (!isExploredBy(this.state, this.player.id, worldToTile(target.x), worldToTile(target.y))) {
      this.issue({ type: 'explore', antIds, target });
      return MARKER_COLORS.explore;
    }
    this.issue({ type: 'move', antIds, target });
    return MARKER_COLORS.move;
  }

  private visibleEnemyAt(p: Point): Ant | null {
    const slop = 4 / this.cameras.main.zoom;
    let best: Ant | null = null;
    let bestDist = Infinity;
    for (const ant of this.state.ants) {
      if (ant.colony === this.player.id) continue;
      const d = dist(ant, p);
      if (d > ANT_STATS[ant.type].radius + slop || d >= bestDist) continue;
      if (!isVisibleTo(this.state, this.player.id, worldToTile(ant.x), worldToTile(ant.y))) continue;
      best = ant;
      bestDist = d;
    }
    return best;
  }

  private visibleCreatureAt(p: Point): Creature | null {
    const slop = 4 / this.cameras.main.zoom;
    return (
      this.state.creatures.find(
        (c) =>
          dist(c, p) <= CREATURE_STATS[c.kind].radius + slop &&
          isVisibleTo(this.state, this.player.id, worldToTile(c.x), worldToTile(c.y)),
      ) ?? null
    );
  }

  private knownEnemyNestAt(p: Point): Colony | null {
    return (
      this.state.colonies.find(
        (c) =>
          c.id !== this.player.id &&
          !c.eliminated &&
          isExploredBy(this.state, this.player.id, c.nest.x, c.nest.y) &&
          dist(p, nestPoint(this.state, c.id)) <= NEST_RADIUS + 4,
      ) ?? null
    );
  }

  private knownFoodAt(p: Point): number | null {
    const known = this.state.food.filter((f) =>
      isExploredBy(this.state, this.player.id, worldToTile(f.x), worldToTile(f.y)),
    );
    return findFoodAt(known, p, 4 / this.cameras.main.zoom)?.id ?? null;
  }

  private drawMap(): void {
    const { map } = this.state;
    const rows: number[][] = [];
    for (let y = 0; y < map.height; y++) rows.push(map.tiles.slice(y * map.width, (y + 1) * map.width));

    const tilemap = this.make.tilemap({ data: rows, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = tilemap.addTilesetImage(TERRAIN_TEXTURE)!;
    tilemap.createLayer(0, tileset, 0, 0)!.setDepth(DEPTH.terrain);
  }

  private drawNests(): void {
    for (const colony of this.state.colonies) {
      const c = nestPoint(this.state, colony.id);
      const mound = this.add
        .circle(c.x, c.y, NEST_RADIUS, COLONY_COLORS[colony.id])
        .setStrokeStyle(3, 0xffffff)
        .setDepth(DEPTH.nests);
      this.nests.set(colony.id, mound);
    }
  }

  /** Nest health bars, the destroyed-nest look, the rally flag, and the build-mode cursor. */
  private drawOverlay(): void {
    const g = this.overlay;
    const zoom = this.cameras.main.zoom;
    g.clear();

    for (const colony of this.state.colonies) {
      const c = nestPoint(this.state, colony.id);
      if (colony.eliminated) {
        this.nests.get(colony.id)!.setFillStyle(0x3a2e22).setStrokeStyle(3, 0x666666);
        continue;
      }
      const seen = colony.id === this.player.id || isVisibleTo(this.state, this.player.id, colony.nest.x, colony.nest.y);
      if (!seen || colony.nestHp >= NEST_MAX_HP) continue;
      const w = 60;
      const frac = colony.nestHp / NEST_MAX_HP;
      const top = c.y - NEST_RADIUS - 14;
      g.fillStyle(0x000000, 0.75).fillRect(c.x - w / 2 - 1, top - 1, w + 2, 7);
      g.fillStyle(frac > 0.5 ? 0x6ad04a : frac > 0.25 ? 0xe0b13a : 0xe04a3a).fillRect(c.x - w / 2, top, w * frac, 5);
    }

    if (this.selection.buildMode) {
      const p = this.input.activePointer;
      const w = this.cameraCtl.screenToWorld(p.x, p.y);
      const tx = worldToTile(w.x);
      const ty = worldToTile(w.y);
      const ok = wallPlanBlocker(this.state, this.player.id, tx, ty) === null;
      g.lineStyle(2 / zoom, ok ? 0x7dff6a : 0xff4d4d).strokeRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }

    if (!this.selection.selectedNest) return;
    const nest = this.nestCenter;
    g.lineStyle(3 / zoom, 0xffe14d).strokeCircle(nest.x, nest.y, NEST_RADIUS + 5);
    const r = this.player.rally;
    if (!r) return;
    g.lineStyle(1.5 / zoom, 0xffffff, 0.5).lineBetween(nest.x, nest.y, r.x, r.y);
    g.lineStyle(2, 0xffffff).lineBetween(r.x, r.y, r.x, r.y - 22);
    g.fillStyle(COLONY_COLORS[this.player.id]).fillTriangle(r.x, r.y - 22, r.x + 14, r.y - 17, r.x, r.y - 12);
  }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
