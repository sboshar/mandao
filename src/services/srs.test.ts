import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sentenceMasteryFromCards,
  sentenceMasteryForMode,
  groupCardsBySentence,
  getFreeReviewQueue,
} from './srs';
import type { SrsCard, ReviewMode } from '../db/schema';
import { card } from '../test/factories';

vi.mock('../db/repo', () => ({
  getSrsCardsByDeckAndStates: vi.fn(),
}));

import * as repo from '../db/repo';

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

describe('getFreeReviewQueue', () => {
  const mockedRepo = vi.mocked(repo);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when sentenceIds is empty', async () => {
    const result = await getFreeReviewQueue({
      deckId: 'd1',
      mode: 'both',
      sentenceIds: [],
    });
    expect(result).toEqual([]);
    expect(mockedRepo.getSrsCardsByDeckAndStates).not.toHaveBeenCalled();
  });

  it('ignores due dates — includes cards due far in the future', async () => {
    const farFuture = Date.now() + 1000 * 60 * 60 * 24 * 365; // 1 year
    const cards = [
      card({ id: 'c1', sentenceId: 's1', due: farFuture, state: 2 }),
      card({ id: 'c2', sentenceId: 's2', due: farFuture, state: 2 }),
    ];
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue(cards);

    const result = await getFreeReviewQueue({
      deckId: 'd1',
      mode: 'both',
      sentenceIds: ['s1', 's2'],
      shuffle: false,
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('filters to sentenceIds', async () => {
    const cards = [
      card({ id: 'c1', sentenceId: 's1' }),
      card({ id: 'c2', sentenceId: 's2' }),
      card({ id: 'c3', sentenceId: 's3' }),
      card({ id: 'c4', sentenceId: 's4' }),
      card({ id: 'c5', sentenceId: 's5' }),
    ];
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue(cards);

    const result = await getFreeReviewQueue({
      deckId: 'd1',
      mode: 'both',
      sentenceIds: ['s2', 's4'],
      shuffle: false,
    });
    expect(result.map((c) => c.id).sort()).toEqual(['c2', 'c4']);
  });

  it("filters by mode when not 'both'", async () => {
    const cards: SrsCard[] = [
      card({ id: 'c1', sentenceId: 's1', reviewMode: 'en-to-zh' }),
      card({ id: 'c2', sentenceId: 's1', reviewMode: 'zh-to-en' }),
      card({ id: 'c3', sentenceId: 's2', reviewMode: 'en-to-zh' }),
      card({ id: 'c4', sentenceId: 's2', reviewMode: 'listen-type' }),
    ];
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue(cards);

    const result = await getFreeReviewQueue({
      deckId: 'd1',
      mode: 'en-to-zh',
      sentenceIds: ['s1', 's2'],
      shuffle: false,
    });
    expect(result.map((c) => c.id).sort()).toEqual(['c1', 'c3']);
    expect(result.every((c) => c.reviewMode === 'en-to-zh')).toBe(true);
  });

  it("includes all modes when mode is 'both'", async () => {
    const allModes: ReviewMode[] = [
      'en-to-zh',
      'zh-to-en',
      'py-to-en-zh',
      'listen-type',
      'speak',
    ];
    const cards: SrsCard[] = allModes.map((m, i) =>
      card({ id: `c${i}`, sentenceId: 's1', reviewMode: m }),
    );
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue(cards);

    const result = await getFreeReviewQueue({
      deckId: 'd1',
      mode: 'both',
      sentenceIds: ['s1'],
      shuffle: false,
    });
    const presentModes = new Set(result.map((c) => c.reviewMode));
    for (const m of allModes) {
      expect(presentModes.has(m)).toBe(true);
    }
  });

  it('respects limit', async () => {
    const cards = [
      card({ id: 'c1', sentenceId: 's1' }),
      card({ id: 'c2', sentenceId: 's2' }),
      card({ id: 'c3', sentenceId: 's3' }),
      card({ id: 'c4', sentenceId: 's4' }),
      card({ id: 'c5', sentenceId: 's5' }),
    ];
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue(cards);

    const result = await getFreeReviewQueue({
      deckId: 'd1',
      mode: 'both',
      sentenceIds: ['s1', 's2', 's3', 's4', 's5'],
      shuffle: false,
      limit: 3,
    });
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result).toHaveLength(3);
  });
});
