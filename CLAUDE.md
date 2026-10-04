# Colony Control: notes for Claude

SimAnt-style RTS in Phaser 4 + TypeScript + Vite. See README.md for the roadmap.

## Architecture rules

- **`src/sim/` is pure game logic and must never import Phaser.** All game state lives in `GameState` (`src/sim/state.ts`) as plain, JSON-serializable data. Save/load = serialize `GameState`.
- **`src/scenes/`, `src/render/`, `src/input/` are the Phaser side.** They read `GameState` and turn input into `Command`s (`src/sim/commands.ts`); they never change game state directly. UI-only state (current selection, camera) lives here, not in `GameState`.
- The simulation advances in fixed `TICK_MS` steps (`src/sim/simulation.ts`); rendering interpolates between ticks using each ant's `prevX/prevY`.
- Pathfinding: A* on tiles (`src/sim/pathfinding.ts`), budgeted per tick by node count. Path requests are queued on `ant.moveTarget`. Reachability uses precomputed regions (`src/sim/regions.ts`), so call `invalidateRegions(map)` after any change to terrain.
- HUD text belongs in `HudScene` (its own camera) so it doesn't zoom with the world.
- **All randomness goes through `Rng` (`src/sim/rng.ts`)** so a seed reproduces a game. Never use `Math.random()` inside `src/sim/`.
- The world is a tile grid (`TILE_SIZE` px per tile, see `src/config.ts`). Terrain, pathfinding, fog of war and resources all key off tile coordinates; units move in continuous world pixels.
- The AI colony should play through the same command interface as the player.
- Art is placeholder (coloured shapes). Keep visuals behind small render helpers so sprites can be swapped in later.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest unit tests for `src/sim/`
- `npm run typecheck` / `npm run build`
