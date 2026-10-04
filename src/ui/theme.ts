import Phaser from 'phaser';

/** Heights of the HUD bars; the world camera's viewport sits between them. */
export const HUD_TOP = 40;
export const HUD_BOTTOM = 184;

export const COLORS = {
  panel: 0x1b1712,
  panelEdge: 0x6b5a3f,
  panelInner: 0x0f0c09,
  accent: 0xffe14d,
  button: 0x3a3226,
  buttonHover: 0x564a36,
  buttonDisabled: 0x241f18,
  danger: 0xd94a4a,
  good: 0x6ad04a,
};

export const FONT = 'monospace';

export const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT,
  fontSize: '14px',
  color: '#f2ead8',
};

export const SMALL: Phaser.Types.GameObjects.Text.TextStyle = { ...TEXT, fontSize: '12px', color: '#c9bea6' };
