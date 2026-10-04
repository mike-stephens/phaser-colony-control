# Colony Control

A browser-based real-time strategy game inspired by SimAnt. Lead the black ant colony in a backyard: explore through fog of war, gather food, raise workers, soldiers and queens, and wipe out the red colony, while spiders and other wildlife roam the map.

Built with [Phaser 4](https://phaser.io), TypeScript and Vite.

**Play:** https://mike-stephens.github.io/phaser-colony-control/ (deployed automatically on every push to `main`)

## Art

All art is built into the code: the insects and props are SVG drawings (`src/art/insects.ts`, `src/art/objects.ts`) and the ground is painted per pixel (`src/art/terrain.ts`), so there are no image files to manage and nothing to license. Ants and spiders have walk cycles; terrain edges blend smoothly thanks to a "dual grid" (each drawn ground tile sits where four map tiles meet).

**Using your own art:** put an image in `public/assets/` and point its entry at it in `ART_OVERRIDES` in `src/art/manifest.ts`, e.g. `'ant-black-worker': 'assets/ant-black-worker.png'`. Anything not overridden keeps the built-in art. Sprites are drawn at **2x** their on-screen size and face **right**; animated ones have their frames side by side. Sizes (one frame, in pixels):

| Key | Size | Frames |
|---|---|---|
| `ant-{black,red}-worker` / `-soldier` / `-queen` | 60x42 / 74x52 / 96x67 | 3 (stand, stride A, stride B) |
| `spider` | 96x96 | 2 |
| `food-{crumbs,seeds,berries,carcass}`, `pebbles`, `wall-{black,red}` | 64x64 | 1 |
| `nest-{black,red}`, `ruin` | 104x104 | 1 |
| `terrain-grass` | 64x64 | 4 variants |
| `terrain-{dirt,water,rock,hole}` | 64x64 | 16 dual-grid tiles (see `src/art/terrain.ts`) |

## Running locally

Requires Node 20+.

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # simulation unit tests
npm run build      # typecheck + production build into dist/
npm run playtest   # ~40 s of scripted playthroughs reporting how attack waves fare
```

Dev shortcut: add `?seed=12345` (optionally `&difficulty=easy|medium|hard`) to the URL to skip the menu and load that exact map.

## How the colony works

- **Food** is your only resource. Workers gather it (5 per trip) and you spend it to train ants: worker 10, soldier 25, queen 100.
- **Upkeep:** every 30 s each ant eats (worker 1, soldier 2, queen 4). If the store runs short the colony is **starving**: unfed ants lose a third of their health per missed meal and die after three. Fed ants heal.
- New food sources appear around the yard over time, so the map never runs completely dry.
- The red colony runs the same economy under the same rules (fog of war, costs, upkeep).

## Combat and winning

- **Soldiers** (25 HP, 4 damage/s, a little slower than workers) guard on their own: idle soldiers attack enemies within 5 tiles, **preferring soldiers and spiders over workers**, won't chase more than ~8 tiles, and give up on a worker that outruns them. **Workers** (10 HP, 1 damage/s) only fight back when bitten while idle.
- **To hit a base, target the nest itself:** once you've scouted it, right-click it (or press A and click it). Raiders stay focused on the nest and surround it, ignore workers walking past, but turn on enemy soldiers that close in (or anything that bites them) before going back to the raid. **Attack-move** (A + click the ground, or the nest) fights everything it meets on the way and then the nest itself; it's better for clearing an army, while a direct raid is better for taking a base. A plain move ignores enemies, so you can always retreat.
- Nests have 1000 HP and slowly regenerate when left alone. **Destroy the red nest to win; lose yours and it's over.** A colony with no ants and no food left to train one is also out.
- **Difficulty** (chosen on the menu) changes when and how hard red attacks: Easy from ~10 min in small groups, Medium from ~6 min, Hard from ~4 min in large waves. Red also gathers 0.8× food on Easy and 1.25× on Hard; otherwise it plays by your rules and only knows what its own fog shows.

## Wildlife, walls and saving

- **Spiders** appear from about 3 minutes in (2 at first, up to 4 later), far from both nests. They hunt any ant that strays within 5 tiles of their territory, whichever colony it belongs to. A group of soldiers can take one down, and a dead spider leaves a 120-food carcass.
- **Walls:** press **B** (or use the nest panel) to enter build mode, drag to plan wall tiles, and set the number of builders with **−/+**. Builders carry pebbles from known pebble piles (found near rocks; one is always near your nest), 3 per wall tile. **Your ants pass through your own walls; enemies (and spiders) must go around, or chew through** (300 HP each). Walls can't block nest entrances.
- **Saving:** **Esc** (with nothing selected) pauses, with Save / Save & quit. The game also autosaves every 2 minutes. Saves live in this browser's local storage; **Load game** on the menu lists them.

## Nests, the underground and queens

- **Underground (U, or the nest panel):** a live cross-section of a nest: queen chamber, nursery (one egg per ant in training), food store, and living chambers with your resting ants.
- **Capacity:** chambers house ants (queen 10, nursery 5, food store 5, living 15). When the colony is nearly full, every nest digs a new chamber automatically, up to the 100-ant cap. Until it finishes, training waits ("Nest full: digging").
- **Queens** (100 food) found new nests: select a queen, press **F** (or the panel button), and click a spot at least 15 tiles from every nest. She walks there and becomes the new nest: 400 HP to start (regenerating to 1000), with its own training queue, rally point and underground. Up to 4 nests.
- Workers drop food at the nearest nest, and nests share one food store. **You only lose when your last nest falls**, so a second nest is insurance as well as faster growth. Red expands too (up to 2 nests on Medium, 3 on Hard).

## Controls

The screen is laid out like StarCraft: **resources across the top** (food and upkeep, ants and capacity, an idle-worker button, Help and Menu), and across the bottom the **minimap**, **details of the selection**, and a **command card** whose buttons show their hotkeys and explain themselves on hover. Press **?** (or F1) in game for the full list.

| Input | Action |
|---|---|
| Left-click / drag | Select ants (Shift adds), or click a nest or food source |
| Right-click / two-finger click / Ctrl+click | Context order: attack an enemy, spider or nest; gather food; explore black fog; otherwise move. With a nest selected: set its rally point |
| Command card letters | M move, S stop, A attack (click a target, or ground to **attack-move**), X explore, G gather, R return home / rally, B walls, F found nest, U underground, W/S/Q train worker/soldier/queen, E/D add/remove gatherers or builders |
| Minimap | Click or drag to look; right-click to order the selection there |
| Swipe / wheel, arrows, right-/middle-drag, pointer at screen edge | Pan |
| Pinch / Ctrl+wheel, + / - | Zoom |
| H / . | Cycle through your nests / select idle workers |
| Esc / P / ? | Back out (cancel, deselect, then pause) / pause / help |

## Roadmap

- [x] **Phase 0:** project scaffold, start screen, seeded random map, camera
- [ ] **Phase 1:** better map generation (noise-based terrain), minimap
- [x] **Phase 2:** ant units, group selection, move orders, A* pathfinding
- [x] **Phase 3:** fog of war, exploring, food sources, gathering with worker counts
- [x] **Phase 4:** colony economy: food stockpile, spawning, upkeep
- [x] **Phase 5:** combat, soldiers, red AI colony (easy / medium / hard), win/lose
- [x] **Phase 6:** neutral creatures (spiders), pebble walls, save/load
- [x] **Phase 7:** underground view (auto-growing first), queens founding new colonies
- [x] Real art: built-in illustrated sprites with walk cycles and blended terrain (overridable with your own images)
- [x] StarCraft-style HUD: top resource bar, minimap, selection panel, command card with hotkeys
- [ ] Player-directed digging underground (choose which chambers to dig)
