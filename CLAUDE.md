# Colony Control: notes for Claude

SimAnt-style RTS in Phaser 4 + TypeScript + Vite. See README.md for the roadmap.

## Architecture rules

- **`src/sim/` is pure game logic and must never import Phaser.** All game state lives in `GameState` (`src/sim/state.ts`) as plain, JSON-serializable data. Save/load = serialize `GameState`.
- **`src/scenes/` renders state and turns input into commands.** Scenes read from `GameState`; they do not own game rules.
- **All randomness goes through `Rng` (`src/sim/rng.ts`)** so a seed reproduces a game. Never use `Math.random()` inside `src/sim/`.
- The world is a tile grid (`TILE_SIZE` px per tile, see `src/config.ts`). Terrain, pathfinding, fog of war and resources all key off tile coordinates; units move in continuous world pixels.
- The AI colony should play through the same command interface as the player.
- Art is placeholder (coloured shapes). Keep visuals behind small render helpers so sprites can be swapped in later.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest unit tests for `src/sim/`
- `npm run typecheck` / `npm run build`
