import Phaser from 'phaser';
import { ANT_STATS } from '../sim/ants';
import { Point } from '../sim/map';
import type { ColonyId, GameState } from '../sim/state';
import { CameraController } from './CameraController';

/** Screen pixels the pointer must travel before a press counts as a drag. */
const DRAG_THRESHOLD = 6;
const BOX_COLOR = 0x7dff6a;
const DEPTH_OVERLAY = 10;

type Gesture = 'none' | 'select' | 'command';

/**
 * Mouse/trackpad unit control:
 *   left-click             select one ant (Shift toggles it in the selection)
 *   left-drag              box-select (Shift adds to the selection)
 *   right-click / two-finger click / Ctrl+click   move selected ants here
 *   right- or middle-drag  pan the camera
 */
export class SelectionController {
  readonly selected = new Set<number>();
  private gesture: Gesture = 'none';
  private start = new Phaser.Math.Vector2();
  private dragging = false;
  private box: Phaser.GameObjects.Graphics;

  constructor(
    private scene: Phaser.Scene,
    private camera: CameraController,
    private getState: () => GameState,
    private colony: ColonyId,
    private onMove: (antIds: number[], target: Point) => void,
  ) {
    this.box = scene.add.graphics().setDepth(DEPTH_OVERLAY);
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

  clear(): void {
    this.selected.clear();
  }

  /** Drops ids of ants that no longer exist. */
  prune(): void {
    if (this.selected.size === 0) return;
    const alive = new Set(this.getState().ants.map((a) => a.id));
    for (const id of this.selected) if (!alive.has(id)) this.selected.delete(id);
  }

  private onDown(p: Phaser.Input.Pointer): void {
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
      if (ids.length > 0) {
        const target = this.camera.screenToWorld(p.x, p.y);
        this.onMove(ids, target);
        this.showMoveMarker(target);
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
    for (const ant of this.getState().ants) {
      if (ant.colony === this.colony && ant.x >= x0 && ant.x <= x1 && ant.y >= y0 && ant.y <= y1) {
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
    for (const ant of this.getState().ants) {
      if (ant.colony !== this.colony) continue;
      const d = Math.hypot(ant.x - w.x, ant.y - w.y);
      if (d <= ANT_STATS[ant.type].radius + slop && d < bestDist) {
        best = ant.id;
        bestDist = d;
      }
    }

    if (!toggle) this.selected.clear();
    if (best === null) return;
    if (toggle && this.selected.has(best)) this.selected.delete(best);
    else this.selected.add(best);
  }

  private showMoveMarker(at: Point): void {
    const ring = this.scene.add
      .circle(at.x, at.y, 10)
      .setStrokeStyle(2 / this.camera.camera.zoom, BOX_COLOR)
      .setDepth(DEPTH_OVERLAY);
    this.scene.tweens.add({
      targets: ring,
      scale: 0.3,
      alpha: 0,
      duration: 450,
      onComplete: () => ring.destroy(),
    });
  }
}
