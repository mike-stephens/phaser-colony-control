import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';
import { AntLayer } from '../render/AntLayer';
import { TERRAIN_TEXTURE, generatePlaceholderTextures } from '../render/textures';
import { issueCommand } from '../sim/commands';
import { TICK_MS, stepSimulation } from '../sim/simulation';
import { GameState, createNewGame } from '../sim/state';

const COLONY_COLORS = { black: 0x111111, red: 0xc0392b } as const;
/** Cap on catch-up after a long frame (e.g. a backgrounded tab). */
const MAX_FRAME_MS = 250;

export class GameScene extends Phaser.Scene {
  state!: GameState;
  selection!: SelectionController;
  private cameraCtl!: CameraController;
  private ants!: AntLayer;
  private accumulator = 0;

  constructor() {
    super('Game');
  }

  init(data: { seed: number }): void {
    this.state = createNewGame(data.seed);
    this.accumulator = 0;
  }

  create(): void {
    generatePlaceholderTextures(this);
    this.drawMap();
    this.drawNests();
    this.ants = new AntLayer(this);

    const worldW = this.state.map.width * TILE_SIZE;
    const worldH = this.state.map.height * TILE_SIZE;
    this.cameraCtl = new CameraController(this, worldW, worldH);
    const player = this.state.colonies.find((c) => c.isPlayer)!;
    this.selection = new SelectionController(this, this.cameraCtl, () => this.state, player.id, (antIds, target) =>
      issueCommand(this.state, player.id, { type: 'move', antIds, target }),
    );

    this.cameras.main.centerOn((player.nest.x + 0.5) * TILE_SIZE, (player.nest.y + 0.5) * TILE_SIZE);

    // Esc clears the selection first, so a stray press doesn't quit the game.
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.selection.selected.size > 0) this.selection.clear();
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
    this.selection.prune();
    this.ants.sync(this.state.ants, this.accumulator / TICK_MS, this.selection.selected);
  }

  private drawMap(): void {
    const { map } = this.state;
    const rows: number[][] = [];
    for (let y = 0; y < map.height; y++) rows.push(map.tiles.slice(y * map.width, (y + 1) * map.width));

    const tilemap = this.make.tilemap({ data: rows, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = tilemap.addTilesetImage(TERRAIN_TEXTURE)!;
    tilemap.createLayer(0, tileset, 0, 0)!.setDepth(0);
  }

  private drawNests(): void {
    for (const colony of this.state.colonies) {
      const cx = (colony.nest.x + 0.5) * TILE_SIZE;
      const cy = (colony.nest.y + 0.5) * TILE_SIZE;
      this.add.circle(cx, cy, TILE_SIZE * 0.8, COLONY_COLORS[colony.id]).setStrokeStyle(3, 0xffffff).setDepth(1);
    }
  }
}
