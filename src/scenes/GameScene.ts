import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';
import { AntLayer } from '../render/AntLayer';
import { DEPTH } from '../render/depths';
import { FogLayer } from '../render/FogLayer';
import { FoodLayer } from '../render/FoodLayer';
import { TERRAIN_TEXTURE, generatePlaceholderTextures } from '../render/textures';
import { Command, issueCommand } from '../sim/commands';
import { isExploredBy, isVisibleTo } from '../sim/fog';
import { findFoodAt } from '../sim/food';
import { Point, worldToTile } from '../sim/map';
import { TICK_MS, stepSimulation } from '../sim/simulation';
import { Colony, GameState, createNewGame, nestPoint } from '../sim/state';
import type { HudScene } from './HudScene';

const COLONY_COLORS = { black: 0x111111, red: 0xc0392b } as const;
const NEST_RADIUS = TILE_SIZE * 0.8;
const MARKER_COLORS = { move: 0x7dff6a, explore: 0x6ac8ff, gather: 0xffe14d } as const;
/** Cap on catch-up after a long frame (e.g. a backgrounded tab). */
const MAX_FRAME_MS = 250;

export class GameScene extends Phaser.Scene {
  state!: GameState;
  player!: Colony;
  selection!: SelectionController;
  private cameraCtl!: CameraController;
  private ants!: AntLayer;
  private foods!: FoodLayer;
  private fog!: FogLayer;
  private rally!: Phaser.GameObjects.Graphics;
  private accumulator = 0;

  constructor() {
    super('Game');
  }

  init(data: { seed: number }): void {
    this.state = createNewGame(data.seed);
    this.player = this.state.colonies.find((c) => c.isPlayer)!;
    this.accumulator = 0;
  }

  create(): void {
    const { map } = this.state;
    generatePlaceholderTextures(this);
    this.drawMap();
    this.drawNests();
    this.foods = new FoodLayer(this);
    this.ants = new AntLayer(this);
    this.fog = new FogLayer(this, map.width, map.height);

    this.cameraCtl = new CameraController(this, map.width * TILE_SIZE, map.height * TILE_SIZE);
    this.selection = new SelectionController(this, this.cameraCtl, {
      colony: this.player.id,
      getState: () => this.state,
      onCommand: (antIds, target) => this.orderTo(antIds, target),
      onRally: (target) => this.issue({ type: 'setRally', target }),
      foodAt: (p) => this.knownFoodAt(p),
      isOnNest: (p) => Math.hypot(p.x - this.nestCenter.x, p.y - this.nestCenter.y) <= NEST_RADIUS + 4,
      isOverUi: (sx, sy) => (this.scene.get('Hud') as HudScene).isOverUi(sx, sy),
    });
    this.cameras.main.centerOn(this.nestCenter.x, this.nestCenter.y);
    this.rally = this.add.graphics().setDepth(DEPTH.overlay);

    const kb = this.input.keyboard!;
    // Esc clears the selection first, so a stray press doesn't quit the game.
    kb.on('keydown-ESC', () => {
      if (this.selection.hasSelection) this.selection.clear();
      else this.scene.start('Menu');
    });
    // H: select the nest and jump the camera home.
    kb.on('keydown-H', () => {
      this.selection.selectNest();
      this.cameras.main.centerOn(this.nestCenter.x, this.nestCenter.y);
    });

    this.scene.launch('Hud');
    this.events.once('shutdown', () => this.scene.stop('Hud'));
  }

  update(_time: number, delta: number): void {
    this.cameraCtl.update(delta);

    this.accumulator += Math.min(delta, MAX_FRAME_MS);
    while (this.accumulator >= TICK_MS) {
      stepSimulation(this.state);
      this.accumulator -= TICK_MS;
    }

    const { state, player } = this;
    this.selection.prune();
    this.ants.sync(state.ants, this.accumulator / TICK_MS, this.selection.selected, (ant) =>
      ant.colony === player.id || isVisibleTo(state, player.id, worldToTile(ant.x), worldToTile(ant.y)),
    );
    this.foods.sync(state.food, this.selection.selectedFood, this.cameras.main.zoom);
    this.fog.update(state, player.id);
    this.drawRally();
  }

  get nestCenter(): Point {
    return nestPoint(this.state, this.player.id);
  }

  /** Flag at the rally point, shown while the nest is selected. */
  private drawRally(): void {
    this.rally.clear();
    if (!this.selection.selectedNest) return;
    const zoom = this.cameras.main.zoom;
    const nest = this.nestCenter;
    this.rally.lineStyle(3 / zoom, 0xffe14d).strokeCircle(nest.x, nest.y, NEST_RADIUS + 5);
    const r = this.player.rally;
    if (!r) return;
    this.rally.lineStyle(1.5 / zoom, 0xffffff, 0.5).lineBetween(nest.x, nest.y, r.x, r.y);
    this.rally.lineStyle(2, 0xffffff).lineBetween(r.x, r.y, r.x, r.y - 22);
    this.rally.fillStyle(COLONY_COLORS[this.player.id]).fillTriangle(r.x, r.y - 22, r.x + 14, r.y - 17, r.x, r.y - 12);
  }

  /** Issues a command on behalf of the human player. */
  issue(command: Command): void {
    issueCommand(this.state, this.player.id, command);
  }

  /** Right-click: gather known food, explore unexplored ground, otherwise move. */
  private orderTo(antIds: number[], target: Point): number {
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
      const cx = (colony.nest.x + 0.5) * TILE_SIZE;
      const cy = (colony.nest.y + 0.5) * TILE_SIZE;
      this.add
        .circle(cx, cy, NEST_RADIUS, COLONY_COLORS[colony.id])
        .setStrokeStyle(3, 0xffffff)
        .setDepth(DEPTH.nests);
    }
  }
}
