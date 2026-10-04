# Colony Control: notes for Claude

SimAnt-style RTS in Phaser 4 + TypeScript + Vite. See README.md for the roadmap.

## Architecture rules

- **`src/sim/` is pure game logic and must never import Phaser.** All game state lives in `GameState` (`src/sim/state.ts`) as plain, JSON-serializable data. Save/load = serialize `GameState`.
- **`src/scenes/`, `src/render/`, `src/input/` are the Phaser side.** They read `GameState` and turn input into `Command`s (`src/sim/commands.ts`); they never change game state directly. UI-only state (current selection, camera) lives here, not in `GameState`.
- The simulation advances in fixed `TICK_MS` steps (`src/sim/simulation.ts`); rendering interpolates between ticks using each ant's `prevX/prevY`.
- Pathfinding: A* on tiles (`src/sim/pathfinding.ts`), budgeted per tick by node count. Path requests are queued on `ant.moveTarget`. Reachability uses precomputed regions (`src/sim/regions.ts`), so call `invalidateRegions(map)` after any change to terrain.
- Ant behaviour beyond walking lives in `ant.task` (`idle` / `explore` / `gather` / `attack`). Gather/explore are advanced by `src/sim/tasks.ts`; fighting, deaths, nest HP and elimination by `src/sim/combat.ts`. An `attack` task's `then` resumes whatever it interrupted. Simulation randomness uses `state.rngState` so games replay deterministically.
- Fog of war is per colony: `state.fog[colony]` is the saved explored grid; current visibility is derived each tick (`src/sim/fog.ts`). Commands must respect fog (e.g. you can only gather food you have explored) so the AI can't cheat.
- Economy (training queue, upkeep/starvation, food regrowth) is in `src/sim/economy.ts`; balance numbers live there as constants. `state.rules` switches whole systems off (tests use this for exact food totals).
- Difficulty only changes AI behaviour plus a disclosed gathering multiplier (`src/sim/difficulty.ts`).
- The AI (`src/sim/ai.ts`) runs inside the simulation tick, issues `Command`s like the player, and reads only its own fog. After changing AI or economy numbers, simulate ~20 seeds for 10+ minutes and check the AI doesn't starve.
- Walls (`src/sim/walls.ts`) live in `state.walls` keyed by tile index. They never change `regions`: a colony's own ants pass its walls, everyone else pays `WALL_PATH_PENALTY` in A* and chews through on contact (`blockedWall`, handled in `simulation.walk` + `combat.chewWalls`). Ants and creatures share movement via the `Mover` shape in `simulation.ts`.
- Wildlife (`src/sim/wildlife.ts`) is not a colony: creatures have their own list, ignore fog, and attack any ant.
- **Saves** are `JSON.stringify(GameState)` in localStorage (`src/persistence/saves.ts`). Any change to GameState's shape must bump `STATE_VERSION` (older saves are then hidden), and state must stay JSON-safe: no `Infinity`, `NaN`, `Map`, class instances or functions. Derived caches (regions, visibility) are WeakMaps rebuilt after load. The save round-trip test in `phase6.test.ts` guards this.
- In dev builds `window.game` is the Phaser.Game, for console poking and automated browser checks.
- HUD text belongs in `HudScene` (its own camera) so it doesn't zoom with the world.
- **All randomness goes through `Rng` (`src/sim/rng.ts`)** so a seed reproduces a game. Never use `Math.random()` inside `src/sim/`.
- The world is a tile grid (`TILE_SIZE` px per tile, see `src/config.ts`). Terrain, pathfinding, fog of war and resources all key off tile coordinates; units move in continuous world pixels.
- The AI colony should play through the same command interface as the player.
- Art is placeholder (coloured shapes). Keep visuals behind small render helpers so sprites can be swapped in later.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest unit tests for `src/sim/`
- `npm run typecheck` / `npm run build`
