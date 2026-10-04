import Phaser from 'phaser';

const KEY_PAN_SPEED = 800; // screen px per second
const KEY_ZOOM_RATE = 1.5; // zoom multiplier per second
/** Pointer within this many px of the window edge scrolls the view (StarCraft-style). */
const EDGE_SCROLL_ZONE = 6;
const MAX_ZOOM = 2.5;

/**
 * Camera controls designed to work on both a trackpad and a mouse:
 *   two-finger swipe / mouse wheel    pan
 *   pinch / Ctrl+wheel / + and -      zoom (toward the cursor)
 *   arrow keys, pointer at the edge   pan
 * Right/middle-drag panning is driven by the SelectionController via panBy().
 * Letter keys are left free for the command card's hotkeys.
 */
export class CameraController {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private cleanup: Array<() => void> = [];
  private pointerInside = false;

  constructor(
    private scene: Phaser.Scene,
    private worldWidth: number,
    private worldHeight: number,
  ) {
    this.camera.setBounds(0, 0, worldWidth, worldHeight);
    const kb = scene.input.keyboard!;
    // enableCapture=false so the keys still reach the HUD's hotkey handler.
    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,PLUS,MINUS', false) as Record<string, Phaser.Input.Keyboard.Key>;
    const onOver = () => (this.pointerInside = true);
    const onOut = () => (this.pointerInside = false);
    scene.input.on('gameover', onOver);
    scene.input.on('gameout', onOut);
    this.cleanup.push(() => {
      scene.input.off('gameover', onOver);
      scene.input.off('gameout', onOut);
    });

    scene.input.on('wheel', this.onWheel, this);
    this.cleanup.push(() => scene.input.off('wheel', this.onWheel, this));
    this.listenForSafariPinch();
    const onResize = () =>
      this.zoomAt(this.camera.zoom, this.camera.x + this.camera.width / 2, this.camera.y + this.camera.height / 2);
    scene.scale.on('resize', onResize);
    this.cleanup.push(() => scene.scale.off('resize', onResize));
    scene.events.once('shutdown', () => this.cleanup.forEach((fn) => fn()));
  }

  /** Zooming out stops once the world fills the screen, so there are never empty margins. */
  get minZoom(): number {
    const cam = this.camera;
    return Math.min(MAX_ZOOM, Math.max(cam.width / this.worldWidth, cam.height / this.worldHeight));
  }

  get camera(): Phaser.Cameras.Scene2D.Camera {
    return this.scene.cameras.main;
  }

  update(deltaMs: number): void {
    const k = this.keys;
    const dt = deltaMs / 1000;
    const step = KEY_PAN_SPEED * dt;
    let dx = 0;
    let dy = 0;
    if (k.LEFT.isDown) dx -= step;
    if (k.RIGHT.isDown) dx += step;
    if (k.UP.isDown) dy -= step;
    if (k.DOWN.isDown) dy += step;

    const p = this.scene.input.activePointer;
    const { width, height } = this.scene.scale;
    if (this.pointerInside && !p.isDown && this.edgeScroll) {
      if (p.x <= EDGE_SCROLL_ZONE) dx -= step;
      if (p.x >= width - EDGE_SCROLL_ZONE) dx += step;
      if (p.y <= EDGE_SCROLL_ZONE) dy -= step;
      if (p.y >= height - EDGE_SCROLL_ZONE) dy += step;
    }
    if (dx || dy) this.panBy(dx, dy);

    const cam = this.camera;
    const cx = cam.x + cam.width / 2;
    const cy = cam.y + cam.height / 2;
    if (k.PLUS.isDown) this.zoomAt(cam.zoom * KEY_ZOOM_RATE ** dt, cx, cy);
    if (k.MINUS.isDown) this.zoomAt(cam.zoom / KEY_ZOOM_RATE ** dt, cx, cy);
  }

  /** Edge scrolling can be paused (e.g. while an overlay is open). */
  edgeScroll = true;

  /** Pans by a distance in screen pixels. */
  panBy(screenDx: number, screenDy: number): void {
    const cam = this.camera;
    cam.scrollX += screenDx / cam.zoom;
    cam.scrollY += screenDy / cam.zoom;
  }

  /** Sets the zoom while keeping the world point under screen point (sx, sy) fixed. */
  zoomAt(zoom: number, sx: number, sy: number): void {
    const cam = this.camera;
    const before = this.screenToWorld(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, MAX_ZOOM));
    cam.scrollX = before.x - cam.width / 2 - (sx - cam.x - cam.width / 2) / cam.zoom;
    cam.scrollY = before.y - cam.height / 2 - (sy - cam.y - cam.height / 2) / cam.zoom;
  }

  /** Centres the view on a world point. */
  centerOn(x: number, y: number): void {
    this.camera.centerOn(x, y);
  }

  /** The world rectangle currently in view (for the minimap). */
  get view(): { x: number; y: number; width: number; height: number } {
    const cam = this.camera;
    const w = cam.width / cam.zoom;
    const h = cam.height / cam.zoom;
    return { x: cam.scrollX + cam.width / 2 - w / 2, y: cam.scrollY + cam.height / 2 - h / 2, width: w, height: h };
  }

  /**
   * Screen to world conversion computed from the camera's current values
   * (Phaser's own matrix only refreshes at render time, so it lags after a
   * zoom or scroll change made this frame).
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.camera;
    return {
      x: cam.scrollX + cam.width / 2 + (sx - cam.x - cam.width / 2) / cam.zoom,
      y: cam.scrollY + cam.height / 2 + (sy - cam.y - cam.height / 2) / cam.zoom,
    };
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, dx: number, dy: number): void {
    const event = pointer.event as WheelEvent;
    // Browsers report trackpad pinch as a wheel event with ctrlKey set.
    if (event.ctrlKey) {
      this.zoomAt(this.camera.zoom * Math.exp(-dy * 0.01), pointer.x, pointer.y);
    } else {
      this.panBy(dx, dy);
    }
  }

  /** Safari reports pinch as proprietary gesture events instead of ctrl+wheel. */
  private listenForSafariPinch(): void {
    const canvas = this.scene.game.canvas;
    let startZoom = 1;
    const onStart = (e: Event) => {
      e.preventDefault();
      startZoom = this.camera.zoom;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const rect = canvas.getBoundingClientRect();
      this.zoomAt(startZoom * g.scale, g.clientX - rect.left, g.clientY - rect.top);
    };
    canvas.addEventListener('gesturestart', onStart);
    canvas.addEventListener('gesturechange', onChange);
    this.cleanup.push(() => {
      canvas.removeEventListener('gesturestart', onStart);
      canvas.removeEventListener('gesturechange', onChange);
    });
  }
}
