import Phaser from 'phaser';
import { buildArt, queueOverrides } from '../art/loadArt';

/** Loads any art overrides, paints the built-in art, then opens the menu. */
export class PreloadScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super('Preload');
  }

  preload(): void {
    this.label = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Painting the backyard...', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#cccccc',
      })
      .setOrigin(0.5);
    queueOverrides(this);
  }

  create(): void {
    buildArt(this, (done, total) => this.label.setText(`Painting the backyard... ${Math.round((done / total) * 100)}%`))
      .then(() => this.scene.start('Menu'))
      .catch((err: unknown) => {
        this.label.setText(`Could not prepare the art: ${String(err)}`);
      });
  }
}
