import Phaser from 'phaser';

const KEY_PAN_SPEED = 800; // screen px per second
const KEY_ZOOM_RATE = 1.5; // zoom multiplier per second
const MAX_ZOOM = 2.5;

/**
 * Camera controls designed to work on both a trackpad and a mouse:
 *   two-finger swipe / mouse wheel    pan
 *   pinch / Ctrl+wheel / Q,E          zoom (toward the cursor)
 *   WASD / arrow keys                 pan
 * Right/middle-drag panning is driven by the SelectionController via panBy().
 */
export class CameraController {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private cleanup: Array<() => void> = [];

  constructor(
    private scene: Phaser.Scene,
    private worldWidth: number,
    private worldHeight: number,
  ) {
    this.camera.setBounds(0, 0, worldWidth, worldHeight);
    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,Q,E') as Record<string, Phaser.Input.Keyboard.Key>;

    scene.input.on('wheel', this.onWheel, this);
    this.cleanup.push(() => scene.input.off('wheel', this.onWheel, this));
    this.listenForSafariPinch();
    const onResize = () => this.zoomAt(this.camera.zoom, this.camera.width / 2, this.camera.height / 2);
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
    if (k.LEFT.isDown || k.A.isDown) dx -= step;
    if (k.RIGHT.isDown || k.D.isDown) dx += step;
    if (k.UP.isDown || k.W.isDown) dy -= step;
    if (k.DOWN.isDown || k.S.isDown) dy += step;
    if (dx || dy) this.panBy(dx, dy);

    const cam = this.camera;
    if (k.E.isDown) this.zoomAt(cam.zoom * KEY_ZOOM_RATE ** dt, cam.width / 2, cam.height / 2);
    if (k.Q.isDown) this.zoomAt(cam.zoom / KEY_ZOOM_RATE ** dt, cam.width / 2, cam.height / 2);
  }

  /** Pans by a distance in screen pixels. */
  panBy(screenDx: number, screenDy: number): void {
    const cam = this.camera;
    cam.scrollX += screenDx / cam.zoom;
    cam.scrollY += screenDy / cam.zoom;
  }

  /** Sets the zoom while keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(zoom: number, sx: number, sy: number): void {
    const cam = this.camera;
    const before = this.screenToWorld(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, MAX_ZOOM));
    cam.scrollX = before.x - cam.width / 2 - (sx - cam.width / 2) / cam.zoom;
    cam.scrollY = before.y - cam.height / 2 - (sy - cam.height / 2) / cam.zoom;
  }

  /**
   * Screen to world conversion computed from the camera's current values
   * (Phaser's own matrix only refreshes at render time, so it lags after a
   * zoom or scroll change made this frame).
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.camera;
    return {
      x: cam.scrollX + cam.width / 2 + (sx - cam.width / 2) / cam.zoom,
      y: cam.scrollY + cam.height / 2 + (sy - cam.height / 2) / cam.zoom,
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
