/** Draw order for world-space layers. */
export const DEPTH = {
  terrain: 0,
  nests: 1,
  food: 1.5,
  selectionRings: 2,
  ants: 3,
  carried: 3.5,
  fog: 5,
  overlay: 10,
} as const;
