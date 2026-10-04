import { isExploredBy } from './fog';
import { isWalkable } from './map';
import { regionAt } from './regions';
import { ColonyId, GameState, MAX_NESTS, MIN_NEST_SPACING, getColony } from './state';

/** Why `colony` can't found a nest on tile (x, y), or null if it can. */
export function foundBlocker(state: GameState, colony: ColonyId, x: number, y: number): string | null {
  const { map } = state;
  const own = getColony(state, colony);
  if (own.nests.length >= MAX_NESTS) return `At most ${MAX_NESTS} nests`;
  if (!isWalkable(map, x, y)) return 'Not open ground';
  if (!isExploredBy(state, colony, x, y)) return 'Unexplored';
  if (state.walls[y * map.width + x]) return 'Wall in the way';
  const home = own.nests[0];
  if (home && regionAt(map, x, y) !== regionAt(map, home.tile.x, home.tile.y)) return 'Unreachable';
  for (const c of state.colonies) {
    for (const n of c.nests) {
      if (Math.hypot(n.tile.x - x, n.tile.y - y) < MIN_NEST_SPACING) return 'Too close to a nest';
    }
  }
  return null;
}
