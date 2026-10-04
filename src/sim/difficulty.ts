export type Difficulty = 'easy' | 'medium' | 'hard';

export interface AiProfile {
  /** Ticks between AI decisions. */
  thinkInterval: number;
  /** No attack waves before this tick. */
  firstAttackTick: number;
  /** Idle soldiers needed before a wave launches. */
  waveSize: number;
  /** AI keeps at most one soldier per this many workers. */
  workersPerSoldier: number;
  /** Workers the AI wants before it trains any soldiers. */
  minWorkersForSoldiers: number;
  /**
   * Multiplier on food the AI's workers bring home. The only place the AI is
   * not on equal terms with the player; shown in the menu so it's no secret.
   */
  gatherMultiplier: number;
  /** Most nests the AI will found (1 = never expands). */
  maxNests: number;
}

const MINUTE = 20 * 60;

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    thinkInterval: 80,
    firstAttackTick: 10 * MINUTE,
    waveSize: 8,
    workersPerSoldier: 3,
    minWorkersForSoldiers: 15,
    gatherMultiplier: 0.8,
    maxNests: 1,
  },
  medium: {
    thinkInterval: 40,
    firstAttackTick: 6 * MINUTE,
    waveSize: 12,
    workersPerSoldier: 2,
    minWorkersForSoldiers: 12,
    gatherMultiplier: 1,
    maxNests: 2,
  },
  hard: {
    thinkInterval: 20,
    firstAttackTick: 4 * MINUTE,
    waveSize: 16,
    workersPerSoldier: 1,
    minWorkersForSoldiers: 10,
    gatherMultiplier: 1.25,
    maxNests: 3,
  },
};
