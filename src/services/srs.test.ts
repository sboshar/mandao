import { describe, it, expect } from 'vitest';
import { sentenceMasteryFromCards, sentenceMasteryForMode, groupCardsBySentence } from './srs';
import type { SrsCard, ReviewMode } from '../db/schema';

function card(overrides: Partial<SrsCard>): SrsCard {
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

describe('sentenceMasteryFromCards', () => {
  it('returns 0 when a sentence has no cards', () => {
    expect(sentenceMasteryFromCards([])).toBe(0);
  });

  it('scores a fully-new sentence as 0', () => {
    const cards = [0, 1, 2, 3].map(() => card({ state: 0, stability: 10 }));
    expect(sentenceMasteryFromCards(cards)).toBe(0);
  });

  it('penalizes a weak mode — one reviewed card, three new, drags the average down', () => {
    const cards = [
      card({ state: 2, stability: 30 }),
      card({ state: 0, stability: 0 }),
      card({ state: 0, stability: 0 }),
      card({ state: 0, stability: 0 }),
    ];
    const score = sentenceMasteryFromCards(cards);
    // One mature card (tanh(1) ≈ 0.76) averaged with three zeros ≈ 0.19
    expect(score).toBeGreaterThan(0.15);
    expect(score).toBeLessThan(0.25);
  });

  it('approaches 1 for a sentence mature across every mode', () => {
    const cards = [1, 2, 3, 4].map(() => card({ state: 2, stability: 365 }));
    const score = sentenceMasteryFromCards(cards);
    expect(score).toBeGreaterThan(0.95);
  });
});

describe('sentenceMasteryForMode', () => {
  it('scores 0 when no card exists for the mode', () => {
    const cards = [card({ reviewMode: 'zh-to-en', state: 2, stability: 100 })];
    expect(sentenceMasteryForMode(cards, 'en-to-zh')).toBe(0);
  });

  it('ignores other modes — surfaces asymmetric mastery', () => {
    const cards: SrsCard[] = [
      card({ reviewMode: 'zh-to-en', state: 2, stability: 365 }),
      card({ reviewMode: 'en-to-zh', state: 0, stability: 0 }),
    ];
    // The whole-sentence overall would be meh (0.5ish) but EN→ZH alone is 0
    expect(sentenceMasteryForMode(cards, 'en-to-zh')).toBe(0);
    expect(sentenceMasteryForMode(cards, 'zh-to-en')).toBeGreaterThan(0.95);
  });
});

describe('groupCardsBySentence', () => {
  it('buckets cards by sentenceId', () => {
    const cards = [
      card({ id: 'a', sentenceId: 's1' }),
      card({ id: 'b', sentenceId: 's2' }),
      card({ id: 'c', sentenceId: 's1' }),
    ];
    const grouped = groupCardsBySentence(cards);
    expect(grouped.get('s1')?.map((c) => c.id)).toEqual(['a', 'c']);
    expect(grouped.get('s2')?.map((c) => c.id)).toEqual(['b']);
  });
});
