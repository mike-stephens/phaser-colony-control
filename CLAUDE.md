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
- **Colonies have several nests** (`colony.nests`, `nests[0]` = main). Training queue, rally point, HP and underground are per nest; food, upkeep and capacity are per colony. Use `nearestNest` / `findNest` / `nestCenter` from `state.ts`; never assume one nest. Attack targets reference nests by id. A colony is out when `nests` is empty.
- The underground (`src/sim/underground.ts`) is real sim state: chambers set colony capacity (`colonyCapacity`), and `updateDigging` adds chambers automatically when crowded. `UndergroundScene` only draws it. Founding rules live in `src/sim/founding.ts`.
- Wildlife (`src/sim/wildlife.ts`) is not a colony: creatures have their own list, ignore fog, and attack any ant.
- **Saves** are `JSON.stringify(GameState)` in localStorage (`src/persistence/saves.ts`). Any change to GameState's shape must bump `STATE_VERSION` (older saves are then hidden), and state must stay JSON-safe: no `Infinity`, `NaN`, `Map`, class instances or functions. Derived caches (regions, visibility) are WeakMaps rebuilt after load. The save round-trip test in `phase6.test.ts` guards this.
- In dev builds `window.game` is the Phaser.Game, for console poking and automated browser checks.
- **HUD** (`HudScene` + `src/ui/`): top bar, minimap (`Minimap.ts`), selection panel (`SelectionPanel.ts`) and command card (`commandCard.ts`). The world camera's viewport sits between the bars (`HUD_TOP` / `HUD_BOTTOM` in `ui/theme.ts`), so convert pointers with `CameraController.screenToWorld`. New player actions should be added to `commandsFor()` with a hotkey and tooltip; letter keys are routed GameScene.onKey -> HudScene.pressHotkey, so don't bind letters elsewhere. Targeted commands use `selection.targeting` and resolve in `GameScene.orderAt`.
- **All randomness goes through `Rng` (`src/sim/rng.ts`)** so a seed reproduces a game. Never use `Math.random()` inside `src/sim/`.
- The world is a tile grid (`TILE_SIZE` px per tile, see `src/config.ts`). Terrain, pathfinding, fog of war and resources all key off tile coordinates; units move in continuous world pixels.
- The AI colony should play through the same command interface as the player.
- **Art** lives in `src/art/`: SVG generators for sprites, a per-pixel painter for terrain, and `manifest.ts` listing every texture (key, frame size, frames) plus `ART_OVERRIDES` for user-supplied images. `PreloadScene` builds it all before the menu. Sprites are authored at 2x and displayed at `ART_SCALE` (0.5); they face +x. New visuals should get a manifest entry rather than being drawn ad hoc with Graphics.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest unit tests for `src/sim/`
- `npm run typecheck` / `npm run build`
- `npm run playtest`: scripted playthroughs (`src/sim/playtest/`, not part of `npm test`). Run it after combat/AI/economy balance changes and compare how many attack waves destroy their nest.
