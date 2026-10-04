import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { UndergroundScene } from './scenes/UndergroundScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1a1a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [MenuScene, GameScene, HudScene, UndergroundScene],
});

// Debug handle for the browser console and automated checks; dev builds only.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
