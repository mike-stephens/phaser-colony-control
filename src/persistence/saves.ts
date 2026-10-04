import type { Difficulty } from '../sim/difficulty';
import { GameState, STATE_VERSION } from '../sim/state';

/**
 * Save games live in the browser's localStorage (per device/browser; clearing
 * site data deletes them). A save is just the JSON of GameState; a small
 * summary is stored beside it so the menu can list saves without parsing them.
 */
export type SaveSlot = 'manual' | 'auto';
export const SAVE_SLOTS: SaveSlot[] = ['manual', 'auto'];

export interface SaveSummary {
  slot: SaveSlot;
  savedAt: number;
  difficulty: Difficulty;
  tick: number;
  version: number;
}

const dataKey = (slot: SaveSlot) => `colony-control:save:${slot}`;
const metaKey = (slot: SaveSlot) => `colony-control:meta:${slot}`;

export function writeSave(slot: SaveSlot, state: GameState): boolean {
  try {
    const summary: SaveSummary = {
      slot,
      savedAt: Date.now(),
      difficulty: state.difficulty,
      tick: state.tick,
      version: state.version,
    };
    localStorage.setItem(dataKey(slot), JSON.stringify(state));
    localStorage.setItem(metaKey(slot), JSON.stringify(summary));
    return true;
  } catch {
    return false;
  }
}

/** The saved game, or null if missing, corrupt, or from an incompatible version. */
export function readSave(slot: SaveSlot): GameState | null {
  try {
    const raw = localStorage.getItem(dataKey(slot));
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    return state?.version === STATE_VERSION ? state : null;
  } catch {
    return null;
  }
}

export function deleteSave(slot: SaveSlot): void {
  try {
    localStorage.removeItem(dataKey(slot));
    localStorage.removeItem(metaKey(slot));
  } catch {
    // Storage unavailable; nothing to delete.
  }
}

/** Loadable saves, newest first. */
export function listSaves(): SaveSummary[] {
  const out: SaveSummary[] = [];
  for (const slot of SAVE_SLOTS) {
    try {
      const raw = localStorage.getItem(metaKey(slot));
      if (!raw) continue;
      const meta = JSON.parse(raw) as SaveSummary;
      if (meta.version === STATE_VERSION) out.push(meta);
    } catch {
      // Skip unreadable entries.
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
