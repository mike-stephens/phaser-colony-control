# Colony Control

A browser-based real-time strategy game inspired by SimAnt. Lead the black ant colony in a backyard: explore through fog of war, gather food, raise workers, soldiers and queens, and wipe out the red colony, while spiders and other wildlife roam the map.

Built with [Phaser 4](https://phaser.io), TypeScript and Vite.

## Running locally

Requires Node 20+.

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # simulation unit tests
npm run build      # typecheck + production build into dist/
```

Dev shortcut: add `?seed=12345` to the URL to skip the menu and load that exact map.

## Controls (current)

| Input | Action |
|---|---|
| WASD / arrow keys, right-drag | Pan |
| Mouse wheel | Zoom |
| Esc | Back to menu |

## Roadmap

- [x] **Phase 0:** project scaffold, start screen, seeded random map, camera
- [ ] **Phase 1:** better map generation (noise-based terrain), minimap
- [ ] **Phase 2:** ant units, group selection, move orders, A* pathfinding
- [ ] **Phase 3:** fog of war, exploring, food sources, gathering with worker counts
- [ ] **Phase 4:** colony economy: food stockpile, spawning, upkeep
- [ ] **Phase 5:** combat, soldiers, red AI colony (easy / medium / hard), win/lose
- [ ] **Phase 6:** neutral creatures (spiders), pebble walls, save/load
- [ ] **Phase 7:** underground view (auto-growing first), queens founding new colonies
- [ ] Real art: free asset packs and/or custom sprites
