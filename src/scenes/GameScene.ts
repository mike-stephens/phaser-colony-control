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
import { Colony, GameState, createNewGame } from '../sim/state';
import type { HudScene } from './HudScene';

const COLONY_COLORS = { black: 0x111111, red: 0xc0392b } as const;
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
      foodAt: (p) => this.knownFoodAt(p),
      isOverUi: (sx, sy) => (this.scene.get('Hud') as HudScene).isOverUi(sx, sy),
    });
    this.cameras.main.centerOn((this.player.nest.x + 0.5) * TILE_SIZE, (this.player.nest.y + 0.5) * TILE_SIZE);

    // Esc clears the selection first, so a stray press doesn't quit the game.
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.selection.hasSelection) this.selection.clear();
      else this.scene.start('Menu');
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
        .circle(cx, cy, TILE_SIZE * 0.8, COLONY_COLORS[colony.id])
        .setStrokeStyle(3, 0xffffff)
        .setDepth(DEPTH.nests);
    }
  }
}
