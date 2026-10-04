# Colony Control

A browser-based real-time strategy game inspired by SimAnt. Lead the black ant colony in a backyard: explore through fog of war, gather food, raise workers, soldiers and queens, and wipe out the red colony, while spiders and other wildlife roam the map.

Built with [Phaser 4](https://phaser.io), TypeScript and Vite.

**Play:** https://mike-stephens.github.io/phaser-colony-control/ (deployed automatically on every push to `main`)

## Running locally

Requires Node 20+.

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # simulation unit tests
npm run build      # typecheck + production build into dist/
```

Dev shortcut: add `?seed=12345` (optionally `&difficulty=easy|medium|hard`) to the URL to skip the menu and load that exact map.

## How the colony works

- **Food** is your only resource. Workers gather it (5 per trip) and you spend it to train ants: worker 10, soldier 25, queen 100.
- **Upkeep:** every 30 s each ant eats (worker 1, soldier 2, queen 4). If the store runs short the colony is **starving**: unfed ants lose a third of their health per missed meal and die after three. Fed ants heal.
- New food sources appear around the yard over time, so the map never runs completely dry.
- The red colony runs the same economy under the same rules (fog of war, costs, upkeep).

## Combat and winning

- **Soldiers** (25 HP, 4 damage/s) guard on their own: idle soldiers attack enemies within 5 tiles, but won't chase more than ~8 tiles before returning. **Workers** (10 HP, 1 damage/s) only fight back when bitten while idle.
- Right-click a **visible enemy ant** to attack it, or a **discovered enemy nest** to raid it: raiders fight through anything in their way, then return to the nest. A plain move ignores enemies, so you can always retreat.
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

Works with a trackpad or a mouse.

| Input | Action |
|---|---|
| Left-click an ant | Select it (Shift+click toggles it in the selection) |
| Left-drag | Box-select your ants (Shift adds to the selection) |
| Left-click a food source | Select it; use **−** / **+** in the panel to set how many workers gather it |
| Left-click a nest, or press **H** (again to cycle nests) | Select it: train workers / soldiers / queens there, click a queued ant to cancel (refunded) |
| U | Underground view of the selected nest (U / Esc to return) |
| F (with a queen selected) | Pick a site for the queen to found a new nest |
| Right-click / two-finger click / Ctrl+click | Order selected ants: on an **enemy ant, spider or nest** attack it, on **food** gather it, in **black fog** explore that area, otherwise move. With the nest selected: set the rally point |
| Two-finger swipe, mouse wheel, WASD / arrows, right- or middle-drag | Pan |
| Pinch, Ctrl+wheel, Q / E | Zoom |
| B | Wall build mode: drag to plan walls, right-drag (or Ctrl-drag) to remove |
| Esc | Back out: leave build mode, then clear the selection, then pause (Save / Save & quit) |
| P | Pause / resume |

## Roadmap

- [x] **Phase 0:** project scaffold, start screen, seeded random map, camera
- [ ] **Phase 1:** better map generation (noise-based terrain), minimap
- [x] **Phase 2:** ant units, group selection, move orders, A* pathfinding
- [x] **Phase 3:** fog of war, exploring, food sources, gathering with worker counts
- [x] **Phase 4:** colony economy: food stockpile, spawning, upkeep
- [x] **Phase 5:** combat, soldiers, red AI colony (easy / medium / hard), win/lose
- [x] **Phase 6:** neutral creatures (spiders), pebble walls, save/load
- [x] **Phase 7:** underground view (auto-growing first), queens founding new colonies
- [ ] Real art: free asset packs and/or custom sprites
- [ ] Player-directed digging underground (choose which chambers to dig)
