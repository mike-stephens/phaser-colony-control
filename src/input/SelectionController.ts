import Phaser from 'phaser';
import { ANT_STATS } from '../sim/ants';
import { Point } from '../sim/map';
import type { ColonyId, GameState } from '../sim/state';
import { DEPTH } from '../render/depths';
import { CameraController } from './CameraController';

/** Screen pixels the pointer must travel before a press counts as a drag. */
const DRAG_THRESHOLD = 6;
const BOX_COLOR = 0x7dff6a;

type Gesture = 'none' | 'select' | 'command';

export interface SelectionOptions {
  colony: ColonyId;
  getState: () => GameState;
  /** Handles a right-click order; returns the marker colour to flash, or null if nothing happened. */
  onCommand: (antIds: number[], target: Point) => number | null;
  /** Sets the nest's rally point (right-click while the nest is selected). */
  onRally: (target: Point) => void;
  /** Food source under a world point that this player may interact with. */
  foodAt: (p: Point) => number | null;
  /** True when a world point is on this player's nest. */
  isOnNest: (p: Point) => boolean;
  /** True when a screen point is over HUD UI, so the click is not for the world. */
  isOverUi: (sx: number, sy: number) => boolean;
}

/**
 * Mouse/trackpad unit control:
 *   left-click             select one ant (Shift toggles it), a food source, or the nest
 *   left-drag              box-select (Shift adds to the selection)
 *   right-click / two-finger click / Ctrl+click   order selected ants
 *   right- or middle-drag  pan the camera
 */
export class SelectionController {
  readonly selected = new Set<number>();
  selectedFood: number | null = null;
  selectedNest = false;
  private gesture: Gesture = 'none';
  private start = new Phaser.Math.Vector2();
  private dragging = false;
  private box: Phaser.GameObjects.Graphics;

  constructor(
    private scene: Phaser.Scene,
    private camera: CameraController,
    private opts: SelectionOptions,
  ) {
    this.box = scene.add.graphics().setDepth(DEPTH.overlay);
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMoveEvent, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.events.once('shutdown', () => {
      scene.input.off('pointerdown', this.onDown, this);
      scene.input.off('pointermove', this.onMoveEvent, this);
      scene.input.off('pointerup', this.onUp, this);
    });
  }

  get hasSelection(): boolean {
    return this.selected.size > 0 || this.selectedFood !== null || this.selectedNest;
  }

  clear(): void {
    this.selected.clear();
    this.selectedFood = null;
    this.selectedNest = false;
  }

  selectNest(): void {
    this.clear();
    this.selectedNest = true;
  }

  /** Drops selections whose ants or food no longer exist. */
  prune(): void {
    const state = this.opts.getState();
    if (this.selected.size > 0) {
      const alive = new Set(state.ants.map((a) => a.id));
      for (const id of this.selected) if (!alive.has(id)) this.selected.delete(id);
    }
    if (this.selectedFood !== null && !state.food.some((f) => f.id === this.selectedFood)) {
      this.selectedFood = null;
    }
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.opts.isOverUi(p.x, p.y)) {
      this.gesture = 'none';
      return;
    }
    const ev = p.event as MouseEvent;
    // On a Mac, Ctrl+click is the conventional right-click.
    const isCommand = p.button === 2 || p.button === 1 || (p.button === 0 && ev.ctrlKey);
    this.gesture = isCommand ? 'command' : 'select';
    this.start.set(p.x, p.y);
    this.dragging = false;
  }

  private onMoveEvent(p: Phaser.Input.Pointer): void {
    if (this.gesture === 'none' || !p.isDown) return;
    if (!this.dragging && Phaser.Math.Distance.Between(this.start.x, this.start.y, p.x, p.y) > DRAG_THRESHOLD) {
      this.dragging = true;
    }
    if (!this.dragging) return;

    if (this.gesture === 'command') {
      this.camera.panBy(-(p.x - p.prevPosition.x), -(p.y - p.prevPosition.y));
    } else {
      this.drawBox(p.x, p.y);
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const ev = p.event as MouseEvent;
    const gesture = this.gesture;
    this.gesture = 'none';
    this.box.clear();

    if (gesture === 'command' && !this.dragging) {
      const ids = [...this.selected];
      const target = this.camera.screenToWorld(p.x, p.y);
      if (ids.length > 0) {
        const color = this.opts.onCommand(ids, target);
        if (color !== null) this.showMarker(target, color);
      } else if (this.selectedNest) {
        this.opts.onRally(target);
        this.showMarker(target, BOX_COLOR);
      }
    } else if (gesture === 'select') {
      if (this.dragging) this.selectInBox(p.x, p.y, ev.shiftKey);
      else this.selectAt(p.x, p.y, ev.shiftKey);
    }
    this.dragging = false;
  }

  private drawBox(sx: number, sy: number): void {
    const a = this.camera.screenToWorld(this.start.x, this.start.y);
    const b = this.camera.screenToWorld(sx, sy);
    const lineWidth = 1.5 / this.camera.camera.zoom;
    this.box.clear();
    this.box.fillStyle(BOX_COLOR, 0.12);
    this.box.lineStyle(lineWidth, BOX_COLOR, 0.9);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    this.box.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    this.box.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }

  private selectInBox(sx: number, sy: number, additive: boolean): void {
    const a = this.camera.screenToWorld(this.start.x, this.start.y);
    const b = this.camera.screenToWorld(sx, sy);
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (!additive) this.selected.clear();
    this.selectedFood = null;
    this.selectedNest = false;
    for (const ant of this.opts.getState().ants) {
      if (ant.colony === this.opts.colony && ant.x >= x0 && ant.x <= x1 && ant.y >= y0 && ant.y <= y1) {
        this.selected.add(ant.id);
      }
    }
  }

  private selectAt(sx: number, sy: number, toggle: boolean): void {
    const w = this.camera.screenToWorld(sx, sy);
    // Generous hit area that stays a usable size on screen when zoomed out.
    const slop = 4 / this.camera.camera.zoom;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const ant of this.opts.getState().ants) {
      if (ant.colony !== this.opts.colony) continue;
      const d = Math.hypot(ant.x - w.x, ant.y - w.y);
      if (d <= ANT_STATS[ant.type].radius + slop && d < bestDist) {
        best = ant.id;
        bestDist = d;
      }
    }

    if (best === null) {
      // No ant here: select the nest or a food source instead (replacing the ant selection).
      const food = this.opts.foodAt(w);
      if (this.opts.isOnNest(w)) {
        this.selectNest();
      } else if (food !== null) {
        this.clear();
        this.selectedFood = food;
      } else if (!toggle) {
        this.clear();
      }
      return;
    }

    this.selectedFood = null;
    this.selectedNest = false;
    if (!toggle) this.selected.clear();
    if (toggle && this.selected.has(best)) this.selected.delete(best);
    else this.selected.add(best);
  }

  private showMarker(at: Point, color: number): void {
    const ring = this.scene.add
      .circle(at.x, at.y, 10)
      .setStrokeStyle(2 / this.camera.camera.zoom, color)
      .setDepth(DEPTH.overlay);
    this.scene.tweens.add({
      targets: ring,
      scale: 0.3,
      alpha: 0,
      duration: 450,
      onComplete: () => ring.destroy(),
    });
  }
}
