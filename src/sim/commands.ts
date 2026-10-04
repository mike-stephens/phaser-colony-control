import { Ant } from './ants';
import { formationSlots } from './formation';
import { Point, worldToTile } from './map';
import { regionAt } from './regions';
import { ColonyId, GameState } from './state';

/**
 * Orders that a colony can give its ants. The player's input and the AI
 * opponent both go through issueCommand, so neither has special powers.
 */
export type Command = { type: 'move'; antIds: number[]; target: Point };

export function issueCommand(state: GameState, colony: ColonyId, command: Command): void {
  switch (command.type) {
    case 'move':
      issueMove(state, colony, command.antIds, command.target);
      break;
  }
}

function issueMove(state: GameState, colony: ColonyId, antIds: number[], target: Point): void {
  const ids = new Set(antIds);
  const ants = state.ants.filter((a) => ids.has(a.id) && a.colony === colony);

  // Ants on different islands can't share a formation; group them by region.
  const byRegion = new Map<number, Ant[]>();
  for (const ant of ants) {
    const region = regionAt(state.map, worldToTile(ant.x), worldToTile(ant.y));
    if (region < 0) continue;
    const group = byRegion.get(region) ?? [];
    group.push(ant);
    byRegion.set(region, group);
  }

  for (const [region, group] of byRegion) {
    const slots = formationSlots(state.map, target, group.length, region);
    // Closest ants take the slots nearest the target so the group stays compact.
    group.sort((a, b) => dist2(a, target) - dist2(b, target) || a.id - b.id);
    group.forEach((ant, i) => {
      const slot = slots[i];
      if (!slot) return;
      ant.moveTarget = slot;
      ant.path = [];
    });
  }
}

function dist2(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
