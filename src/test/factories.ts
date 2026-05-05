import type { SrsCard, ReviewMode } from '../db/schema';

export function card(overrides: Partial<SrsCard> = {}): SrsCard {
  return {
    id: 'c',
    sentenceId: 's',
    deckId: 'd',
    reviewMode: 'en-to-zh' as ReviewMode,
    due: 0,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    createdAt: 0,
    ...overrides,
  };
}
