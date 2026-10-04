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

Dev shortcut: add `?seed=12345` to the URL to skip the menu and load that exact map.

## How the colony works

- **Food** is your only resource. Workers gather it (5 per trip) and you spend it to train ants: worker 10, soldier 25, queen 100.
- **Upkeep:** every 30 s each ant eats (worker 1, soldier 2, queen 4). If the store runs short the colony is **starving**: unfed ants lose a third of their health per missed meal and die after three. Fed ants heal.
- New food sources appear around the yard over time, so the map never runs completely dry.
- The red colony runs the same economy under the same rules (fog of war, costs, upkeep).

## Controls

Works with a trackpad or a mouse.

| Input | Action |
|---|---|
| Left-click an ant | Select it (Shift+click toggles it in the selection) |
| Left-drag | Box-select your ants (Shift adds to the selection) |
| Left-click a food source | Select it; use **−** / **+** in the panel to set how many workers gather it |
| Left-click your nest, or press **H** | Select the nest: train workers / soldiers / queens, click a queued ant to cancel (refunded) |
| Right-click / two-finger click / Ctrl+click | Order selected ants: on **food** gather it, in **black fog** explore that area, otherwise move. With the nest selected: set the rally point |
| Two-finger swipe, mouse wheel, WASD / arrows, right- or middle-drag | Pan |
| Pinch, Ctrl+wheel, Q / E | Zoom |
| Esc | Clear the selection (press again for the menu) |

## Roadmap

- [x] **Phase 0:** project scaffold, start screen, seeded random map, camera
- [ ] **Phase 1:** better map generation (noise-based terrain), minimap
- [x] **Phase 2:** ant units, group selection, move orders, A* pathfinding
- [x] **Phase 3:** fog of war, exploring, food sources, gathering with worker counts
- [x] **Phase 4:** colony economy: food stockpile, spawning, upkeep
- [ ] **Phase 5:** combat, soldiers, red AI colony (easy / medium / hard), win/lose
- [ ] **Phase 6:** neutral creatures (spiders), pebble walls, save/load
- [ ] **Phase 7:** underground view (auto-growing first), queens founding new colonies
- [ ] Real art: free asset packs and/or custom sprites
