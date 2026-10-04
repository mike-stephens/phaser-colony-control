import { antKey, foodKey, nestKey, wallKey } from '../art/manifest';
import { buildersOf, gatherersOf } from '../sim/commands';
import { ANT_COST, trainBlocker } from '../sim/economy';
import { MAX_NESTS } from '../sim/state';
import type { GameScene } from '../scenes/GameScene';

/** One button on the 5 x 3 command card. */
export interface CardCommand {
  /** 0..14, row-major (top row 0-4). */
  slot: number;
  hotkey: string;
  title: string;
  /** Extra tooltip lines (what it does, cost). */
  detail: string;
  icon: { key: string; frame?: number };
  enabled: boolean;
  /** Why it's disabled, shown in the tooltip. */
  reason?: string;
  /** Highlighted (e.g. the targeting mode in progress). */
  active?: boolean;
  run: () => void;
}

const CANCEL_SLOT = 14;

/** The commands available for whatever is currently selected. */
export function commandsFor(game: GameScene): CardCommand[] {
  const { selection, state, player } = game;
  const card: CardCommand[] = [];
  const add = (c: CardCommand) => card.push(c);

  if (selection.targeting) {
    add({
      slot: CANCEL_SLOT,
      hotkey: 'ESCAPE',
      title: 'Cancel (Esc)',
      detail: 'Cancel the pending command. Right-clicking the map also cancels.',
      icon: { key: 'icon-cancel' },
      enabled: true,
      run: () => (selection.targeting = null),
    });
  }

  if (selection.buildMode) {
    const builders = buildersOf(state, player.id).length;
    add({
      slot: 0,
      hotkey: 'E',
      title: 'Add builder (E)',
      detail: 'Put another worker on wall building: idle workers first.',
      icon: { key: 'icon-plus' },
      enabled: true,
      run: () => game.issue({ type: 'setBuilders', count: builders + 1 }),
    });
    add({
      slot: 1,
      hotkey: 'D',
      title: 'Remove builder (D)',
      detail: 'Send one builder back to idle.',
      icon: { key: 'icon-minus' },
      enabled: builders > 0,
      reason: 'No builders',
      run: () => game.issue({ type: 'setBuilders', count: Math.max(0, builders - 1) }),
    });
    add({
      slot: 4,
      hotkey: 'B',
      title: 'Done building (B)',
      detail: 'Leave wall-planning mode. Builders keep working on the plans.',
      icon: { key: 'icon-done' },
      enabled: true,
      run: () => game.setBuildMode(false),
    });
    return card;
  }

  const ants = game.selectedAnts;
  if (ants.length > 0) {
    const workers = ants.filter((a) => a.type === 'worker');
    const queens = ants.filter((a) => a.type === 'queen');
    const target = (kind: Parameters<GameScene['beginTargeting']>[0]) => () => game.beginTargeting(kind);
    add({
      slot: 0,
      hotkey: 'M',
      title: 'Move (M)',
      detail: 'Click a spot to walk there, ignoring enemies on the way (use it to retreat).',
      icon: { key: 'icon-move' },
      enabled: true,
      active: selection.targeting === 'move',
      run: target('move'),
    });
    add({
      slot: 1,
      hotkey: 'S',
      title: 'Stop (S)',
      detail: 'Drop the current job and stand still.',
      icon: { key: 'icon-stop' },
      enabled: true,
      run: () => game.stopSelected(),
    });
    add({
      slot: 2,
      hotkey: 'A',
      title: 'Attack (A)',
      detail: 'Click an enemy, spider or nest to attack it, or the ground to attack-move\n(walk there, fighting anything met on the way).',
      icon: { key: 'icon-attack' },
      enabled: true,
      active: selection.targeting === 'attack',
      run: target('attack'),
    });
    add({
      slot: 3,
      hotkey: 'X',
      title: 'Explore (X)',
      detail: 'Click an area: the ants spread out and uncover it, then stop.',
      icon: { key: 'icon-explore' },
      enabled: true,
      active: selection.targeting === 'explore',
      run: target('explore'),
    });
    add({
      slot: 5,
      hotkey: 'G',
      title: 'Gather (G)',
      detail: 'Click a food source: workers carry it home 5 at a time.\nOther ants escort them.',
      icon: { key: foodKey('seeds') },
      enabled: workers.length > 0,
      reason: 'Only workers gather',
      active: selection.targeting === 'gather',
      run: target('gather'),
    });
    add({
      slot: 6,
      hotkey: 'R',
      title: 'Return to nest (R)',
      detail: 'Walk back to the nearest nest (dropping off any food).',
      icon: { key: nestKey(player.id) },
      enabled: player.nests.length > 0,
      run: () => game.returnSelectedHome(),
    });
    add({
      slot: 7,
      hotkey: 'B',
      title: 'Build walls (B)',
      detail: 'Plan pebble walls: drag to place, right-drag to remove.',
      icon: { key: wallKey(player.id) },
      enabled: true,
      run: () => game.setBuildMode(true),
    });
    if (queens.length > 0) {
      const atLimit = player.nests.length >= MAX_NESTS;
      add({
        slot: 10,
        hotkey: 'F',
        title: 'Found a nest (F)',
        detail: 'Click a spot at least 15 tiles from every nest.\nThe queen walks there and becomes a new nest.',
        icon: { key: antKey(player.id, 'queen') },
        enabled: !atLimit,
        reason: `At most ${MAX_NESTS} nests`,
        active: selection.targeting === 'found',
        run: target('found'),
      });
    }
    return card;
  }

  const nest = game.selectedNest;
  if (nest) {
    (['worker', 'soldier', 'queen'] as const).forEach((type, i) => {
      const blocked = trainBlocker(state, player, nest, type);
      const name = type[0].toUpperCase() + type.slice(1);
      const blurb = {
        worker: 'Gathers food, explores and builds walls.',
        soldier: 'Fights. Guards on its own when idle.',
        queen: 'Can fly off to found a new nest.',
      }[type];
      add({
        slot: i,
        hotkey: name[0],
        title: `Train ${name} (${name[0]})`,
        detail: `${ANT_COST[type].food} food, ${ANT_COST[type].ticks / 20} s.  ${blurb}`,
        icon: { key: antKey(player.id, type) },
        enabled: blocked === null,
        reason: blocked ?? undefined,
        run: () => game.issue({ type: 'train', antType: type, nestId: nest.id }),
      });
    });
    add({
      slot: 5,
      hotkey: 'R',
      title: 'Set rally point (R)',
      detail: 'Click where this nest\'s new ants should gather.\n(Right-clicking the map with the nest selected does the same.)',
      icon: { key: 'icon-rally' },
      enabled: true,
      active: selection.targeting === 'rally',
      run: () => game.beginTargeting('rally'),
    });
    add({
      slot: 6,
      hotkey: 'U',
      title: 'Underground (U)',
      detail: 'Look inside this nest: chambers, eggs, food store, resting ants.',
      icon: { key: 'icon-underground' },
      enabled: true,
      run: () => game.openUnderground(),
    });
    add({
      slot: 7,
      hotkey: 'B',
      title: 'Build walls (B)',
      detail: 'Plan pebble walls: drag to place, right-drag to remove.',
      icon: { key: wallKey(player.id) },
      enabled: true,
      run: () => game.setBuildMode(true),
    });
    return card;
  }

  const foodId = selection.selectedFood;
  const food = state.food.find((f) => f.id === foodId);
  if (food) {
    const count = gatherersOf(state, player.id, food.id).length;
    add({
      slot: 0,
      hotkey: 'E',
      title: 'Add gatherer (E)',
      detail: 'Assign one more worker to this food: idle workers first, nearest first.',
      icon: { key: 'icon-plus' },
      enabled: true,
      run: () => game.issue({ type: 'setGatherers', foodId: food.id, count: count + 1 }),
    });
    add({
      slot: 1,
      hotkey: 'D',
      title: 'Remove gatherer (D)',
      detail: 'Send one gatherer home.',
      icon: { key: 'icon-minus' },
      enabled: count > 0,
      reason: 'Nobody is gathering here',
      run: () => game.issue({ type: 'setGatherers', foodId: food.id, count: Math.max(0, count - 1) }),
    });
    return card;
  }

  // Nothing selected: colony-wide shortcuts.
  add({
    slot: 0,
    hotkey: 'B',
    title: 'Build walls (B)',
    detail: 'Plan pebble walls: drag to place, right-drag to remove.',
    icon: { key: wallKey(player.id) },
    enabled: player.nests.length > 0,
    run: () => game.setBuildMode(true),
  });
  add({
    slot: 1,
    hotkey: 'U',
    title: 'Underground (U)',
    detail: 'Look inside your main nest.',
    icon: { key: 'icon-underground' },
    enabled: player.nests.length > 0,
    run: () => game.openUnderground(),
  });
  return card;
}
