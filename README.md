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

## Controls

Works with a trackpad or a mouse.

| Input | Action |
|---|---|
| Left-click an ant | Select it (Shift+click toggles it in the selection) |
| Left-drag | Box-select your ants (Shift adds to the selection) |
| Left-click a food source | Select it; use **−** / **+** in the panel to set how many workers gather it |
| Left-click your nest, or press **H** | Select the nest: train workers / soldiers / queens, click a queued ant to cancel (refunded) |
| Right-click / two-finger click / Ctrl+click | Order selected ants: on an **enemy ant or nest** attack it, on **food** gather it, in **black fog** explore that area, otherwise move. With the nest selected: set the rally point |
| Two-finger swipe, mouse wheel, WASD / arrows, right- or middle-drag | Pan |
| Pinch, Ctrl+wheel, Q / E | Zoom |
| Esc | Clear the selection (press again for the menu) |

## Roadmap

- [x] **Phase 0:** project scaffold, start screen, seeded random map, camera
- [ ] **Phase 1:** better map generation (noise-based terrain), minimap
- [x] **Phase 2:** ant units, group selection, move orders, A* pathfinding
- [x] **Phase 3:** fog of war, exploring, food sources, gathering with worker counts
- [x] **Phase 4:** colony economy: food stockpile, spawning, upkeep
- [x] **Phase 5:** combat, soldiers, red AI colony (easy / medium / hard), win/lose
- [ ] **Phase 6:** neutral creatures (spiders), pebble walls, save/load
- [ ] **Phase 7:** underground view (auto-growing first), queens founding new colonies
- [ ] Real art: free asset packs and/or custom sprites
