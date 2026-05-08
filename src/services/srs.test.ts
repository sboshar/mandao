import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sentenceMasteryFromCards,
  sentenceMasteryForMode,
  groupCardsBySentence,
  getFreeReviewQueue,
  getReviewQueue,
  getDueBreakdown,
} from './srs';
import type { SrsCard, ReviewMode } from '../db/schema';
import { card } from '../test/factories';
import { useFSRSSettingsStore } from '../stores/fsrsSettingsStore';

vi.mock('../db/repo', () => ({
  getSrsCardsByDeckAndStates: vi.fn(),
  getSrsCardsByDeckAndState: vi.fn(),
  getSrsCardsByIds: vi.fn(),
  getDeck: vi.fn(),
  getReviewLogsSince: vi.fn(),
  getSentencesByTags: vi.fn(),
}));
vi.mock('../lib/dailyLimits', () => ({
  getNewLimitBumpToday: vi.fn(() => 0),
  getReviewLimitBumpToday: vi.fn(() => 0),
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

describe('getReviewQueue daily-cap semantics', () => {
  const mockedRepo = vi.mocked(repo);
  const past = Date.now() - 1000;

  function setupDeck(reviewsPerDay = 5, newCardsPerDay = 0) {
    mockedRepo.getDeck.mockResolvedValue({
      id: 'd1',
      name: 'd',
      description: '',
      newCardsPerDay,
      reviewsPerDay,
      createdAt: 0,
    });
    mockedRepo.getReviewLogsSince.mockResolvedValue([]);
    mockedRepo.getSrsCardsByIds.mockResolvedValue([]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useFSRSSettingsStore.setState({ newCardsIgnoreReviewLimit: false });
  });

  it('caps interday-learning + reviews together, leaves intraday uncapped', async () => {
    setupDeck(5);
    const intraday = Array.from({ length: 3 }, (_, i) =>
      card({ id: `i${i}`, state: 1, scheduledDays: 0, due: past, lastReview: past }),
    );
    const interday = Array.from({ length: 4 }, (_, i) =>
      card({ id: `r${i}`, state: 3, scheduledDays: 2, due: past, lastReview: past }),
    );
    const reviews = Array.from({ length: 4 }, (_, i) =>
      card({ id: `v${i}`, state: 2, scheduledDays: 30, due: past, lastReview: past }),
    );
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([...intraday, ...interday]);
    mockedRepo.getSrsCardsByDeckAndState.mockImplementation(async (_d, state) =>
      state === 2 ? reviews : [],
    );

    const result = await getReviewQueue('d1');
    // intraday (3, uncapped) + cap-of-5 from (interday 4 + review 4 = 8)
    expect(result).toHaveLength(3 + 5);
    expect(result.slice(0, 3).map((c) => c.id)).toEqual(['i0', 'i1', 'i2']);
    expect(result.slice(3, 7).map((c) => c.id)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(result.slice(7).map((c) => c.id)).toEqual(['v0']);
  });

  it('relearning (state=3) with multi-day step counts against the cap', async () => {
    setupDeck(2);
    const relearning = Array.from({ length: 5 }, (_, i) =>
      card({ id: `r${i}`, state: 3, scheduledDays: 2, due: past, lastReview: past }),
    );
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue(relearning);
    mockedRepo.getSrsCardsByDeckAndState.mockResolvedValue([]);

    const result = await getReviewQueue('d1');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['r0', 'r1']);
  });

  it('classifies a sub-day step that crossed midnight as interday', async () => {
    // ts-fsrs leaves scheduledDays=0 for sub-day steps even when due lands
    // tomorrow. We detect cross-midnight via lastReview vs due calendar day.
    setupDeck(1);
    const yesterdayLate = new Date();
    yesterdayLate.setHours(0, 0, 0, 0);
    yesterdayLate.setTime(yesterdayLate.getTime() - 60 * 60 * 1000); // 11pm yesterday
    const todayEarly = new Date();
    todayEarly.setHours(0, 0, 0, 0);
    todayEarly.setTime(todayEarly.getTime() + 60 * 60 * 1000); // 1am today
    const crossMidnight = card({
      id: 'x0',
      state: 1,
      scheduledDays: 0,
      lastReview: yesterdayLate.getTime(),
      due: todayEarly.getTime(),
    });
    const sameDayStep = card({
      id: 's0',
      state: 1,
      scheduledDays: 0,
      lastReview: todayEarly.getTime(),
      due: past,
    });
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([crossMidnight, sameDayStep]);
    mockedRepo.getSrsCardsByDeckAndState.mockResolvedValue([]);

    const result = await getReviewQueue('d1');
    // sameDayStep is intraday (uncapped); crossMidnight takes the only
    // review-bucket slot.
    expect(result.map((c) => c.id).sort()).toEqual(['s0', 'x0']);
  });

  it('shared budget: new cards stop appearing once the review bucket fills', async () => {
    setupDeck(3, 10);
    const reviews = Array.from({ length: 3 }, (_, i) =>
      card({ id: `r${i}`, state: 2, scheduledDays: 30, due: past, lastReview: past }),
    );
    const news = Array.from({ length: 5 }, (_, i) => card({ id: `n${i}`, state: 0 }));
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([]);
    mockedRepo.getSrsCardsByDeckAndState.mockImplementation(async (_d, state) =>
      state === 2 ? reviews : state === 0 ? news : [],
    );

    const result = await getReviewQueue('d1');
    // Reviews fill the 3-slot cap; no slots left for new cards.
    expect(result).toHaveLength(3);
    expect(result.every((c) => c.state === 2)).toBe(true);
  });

  it('independent budgets when newCardsIgnoreReviewLimit is on', async () => {
    setupDeck(3, 10);
    useFSRSSettingsStore.setState({ newCardsIgnoreReviewLimit: true });
    const reviews = Array.from({ length: 3 }, (_, i) =>
      card({ id: `r${i}`, state: 2, scheduledDays: 30, due: past, lastReview: past }),
    );
    const news = Array.from({ length: 5 }, (_, i) => card({ id: `n${i}`, state: 0 }));
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([]);
    mockedRepo.getSrsCardsByDeckAndState.mockImplementation(async (_d, state) =>
      state === 2 ? reviews : state === 0 ? news : [],
    );

    const result = await getReviewQueue('d1');
    // Reviews use their full cap, AND new cards still flow up to newCardsPerDay.
    expect(result).toHaveLength(3 + 5);
  });

  it('treats a learning card with no lastReview as intraday (uncapped fallback)', async () => {
    setupDeck(0); // hard cap blocks the review bucket entirely
    const seeded = card({
      id: 'l0',
      state: 1,
      scheduledDays: 0,
      lastReview: null, // no review history yet
      due: past,
    });
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([seeded]);
    mockedRepo.getSrsCardsByDeckAndState.mockResolvedValue([]);

    const result = await getReviewQueue('d1');
    expect(result.map((c) => c.id)).toEqual(['l0']);
  });

  it('applies the cap after mode filtering — modeFilter scopes the bucket', async () => {
    setupDeck(2);
    // 3 zh-to-en interday cards + 3 en-to-zh interday cards. Cap=2 per
    // session. Filtering to zh-to-en should yield 2 zh-to-en, not 2 of
    // any mode.
    const zh = Array.from({ length: 3 }, (_, i) =>
      card({ id: `zh${i}`, state: 3, scheduledDays: 1, due: past, lastReview: past, reviewMode: 'zh-to-en' }),
    );
    const en = Array.from({ length: 3 }, (_, i) =>
      card({ id: `en${i}`, state: 3, scheduledDays: 1, due: past, lastReview: past, reviewMode: 'en-to-zh' }),
    );
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([...zh, ...en]);
    mockedRepo.getSrsCardsByDeckAndState.mockResolvedValue([]);

    const result = await getReviewQueue('d1', 'zh-to-en');
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.reviewMode === 'zh-to-en')).toBe(true);
  });
});

describe('getDueBreakdown reflects the capped queue', () => {
  const mockedRepo = vi.mocked(repo);
  const past = Date.now() - 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    useFSRSSettingsStore.setState({ newCardsIgnoreReviewLimit: false });
    mockedRepo.getDeck.mockResolvedValue({
      id: 'd1',
      name: 'd',
      description: '',
      newCardsPerDay: 0,
      reviewsPerDay: 3,
      createdAt: 0,
    });
    mockedRepo.getReviewLogsSince.mockResolvedValue([]);
    mockedRepo.getSrsCardsByIds.mockResolvedValue([]);
  });

  it('reports learningCount as intraday-only, reviewCount as the capped bucket, and reviewBacklog accordingly', async () => {
    const intraday = Array.from({ length: 2 }, (_, i) =>
      card({ id: `i${i}`, state: 1, scheduledDays: 0, due: past, lastReview: past, reviewMode: 'zh-to-en' }),
    );
    const interday = Array.from({ length: 3 }, (_, i) =>
      card({ id: `j${i}`, state: 3, scheduledDays: 1, due: past, lastReview: past, reviewMode: 'zh-to-en' }),
    );
    const reviews = Array.from({ length: 4 }, (_, i) =>
      card({ id: `r${i}`, state: 2, scheduledDays: 10, due: past, lastReview: past, reviewMode: 'zh-to-en' }),
    );
    mockedRepo.getSrsCardsByDeckAndStates.mockResolvedValue([...intraday, ...interday]);
    mockedRepo.getSrsCardsByDeckAndState.mockImplementation(async (_d, state) =>
      state === 2 ? reviews : [],
    );

    const breakdown = await getDueBreakdown('d1');
    expect(breakdown.byModeAndState['all']).toMatchObject({
      newCount: 0,
      learningCount: 2, // intraday only
      reviewCount: 3, // min(reviewsPerDay=3, interday 3 + review 4 = 7)
      reviewBacklog: 4, // 7 - 3
    });
    expect(breakdown.byMode['zh-to-en']).toBe(5);
  });
});
