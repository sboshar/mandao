/**
 * SRS service using FSRS v5 (ts-fsrs).
 */
import {
  fsrs,
  generatorParameters,
  type Card as FSRSCard,
  type Grade,
  Rating,
} from 'ts-fsrs';
import * as repo from '../db/repo';
import { enqueueSync } from '../db/repo';
import type { SrsCard, ReviewLog, ReviewMode } from '../db/schema';
import { v4 as uuid } from 'uuid';
import { getDeviceId } from '../db/syncEngine';
import { useFSRSSettingsStore, toFSRSParams } from '../stores/fsrsSettingsStore';
import { getNewLimitBumpToday, getReviewLimitBumpToday } from '../lib/dailyLimits';

function getScheduler() {
  const settings = useFSRSSettingsStore.getState();
  const params = generatorParameters(toFSRSParams(settings));
  return fsrs(params);
}

export { Rating };
export type { Grade };

export interface UndoInfo {
  cardId: string;
  logId: string;
  oldCardState: Partial<SrsCard>;
  /** The opId of the sync op in the outbox — used to delete it on undo. */
  syncOpId: string;
}

/** Convert our SrsCard to an FSRS Card for scheduling */
function toFSRSCard(card: SrsCard): FSRSCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as 0 | 1 | 2 | 3,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  } as FSRSCard;
}

/** Review a card with a given rating. Updates the card and logs the review. Returns undo info. */
export async function reviewCard(
  cardId: string,
  rating: Grade
): Promise<UndoInfo> {
  const card = await repo.getSrsCard(cardId);
  if (!card) throw new Error(`Card not found: ${cardId}`);

  const fsrsCard = toFSRSCard(card);
  const now = new Date();
  const result = getScheduler().repeat(fsrsCard, now);
  const next = result[rating].card;

  const newCardState = {
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    lastReview: now.getTime(),
  };

  const oldCardState: Partial<SrsCard> = {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
  };

  await repo.updateSrsCard(cardId, newCardState);

  const logId = uuid();
  const opId = uuid();
  const log: ReviewLog = {
    id: logId,
    cardId,
    rating: rating as 1 | 2 | 3 | 4,
    state: card.state,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reviewedAt: now.getTime(),
  };
  await repo.insertReviewLog(log);

  // Enqueue sync immediately so it persists even if the tab closes.
  // If the user undoes, we delete the outbox entry (compensating transaction).
  await enqueueSync({
    op: 'reviewCard',
    payload: {
      id: logId,
      card_id: cardId,
      rating: rating as number,
      state: card.state,
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsedDays,
      scheduled_days: card.scheduledDays,
      reviewed_at: now.getTime(),
      op_id: opId,
      device_id: getDeviceId(),
      new_due: newCardState.due,
      new_stability: newCardState.stability,
      new_difficulty: newCardState.difficulty,
      new_elapsed_days: newCardState.elapsedDays,
      new_scheduled_days: newCardState.scheduledDays,
      new_reps: newCardState.reps,
      new_lapses: newCardState.lapses,
      new_state: newCardState.state,
    },
  });

  return { cardId, logId, oldCardState, syncOpId: opId };
}

/** Undo the most recent review — reverts local state and removes the pending sync op. */
export async function undoReview(undo: UndoInfo): Promise<void> {
  await repo.updateSrsCard(undo.cardId, undo.oldCardState);
  await repo.deleteReviewLog(undo.logId);
  await repo.deletePendingSyncOp(undo.syncOpId);
}

/**
 * How many new cards the user can still see today, deck-wide. The cap is
 * shared across review modes — matches Anki's "new cards/day" semantic.
 * Adds any "Increase today's new card limit" bump the user has applied.
 */
async function newCardsRemainingToday(deckId: string, newCardsPerDay: number): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayLogs = await repo.getReviewLogsSince(todayStart.getTime());
  const todayNewCardIds = new Set(todayLogs.map((r) => r.cardId));
  const todayCards = await repo.getSrsCardsByIds([...todayNewCardIds]);
  const newReviewedToday = todayCards.filter((c) => c.reps === 1).length;
  const cap = newCardsPerDay + getNewLimitBumpToday(deckId);
  return Math.max(0, cap - newReviewedToday);
}

/** Get review queue for a deck, optionally filtered by review mode and/or tags */
export async function getReviewQueue(
  deckId: string,
  modeFilter?: ReviewMode | 'both',
  tagFilter?: string[] | null
): Promise<SrsCard[]> {
  const now = Date.now();
  const deck = await repo.getDeck(deckId);
  if (!deck) return [];

  // If filtering by tags, get the set of matching sentence IDs (union of all selected tags)
  let tagSentenceIds: Set<string> | null = null;
  if (tagFilter && tagFilter.length > 0) {
    const tagged = await repo.getSentencesByTags(tagFilter);
    tagSentenceIds = new Set(tagged.map((s) => s.id));
  }

  const modeOk = (c: SrsCard) =>
    !modeFilter || modeFilter === 'both' || c.reviewMode === modeFilter;
  const tagOk = (c: SrsCard) =>
    !tagSentenceIds || tagSentenceIds.has(c.sentenceId);
  const ok = (c: SrsCard) => modeOk(c) && tagOk(c);

  // Fetch all cards for this deck in relevant states
  // Learning (1) + Relearning (3) + Review (2) + New (0)
  const [learningRelearning, reviewCards, newCards, newRemaining] = await Promise.all([
    repo.getSrsCardsByDeckAndStates(deckId, [1, 3]),
    repo.getSrsCardsByDeckAndState(deckId, 2),
    repo.getSrsCardsByDeckAndState(deckId, 0),
    newCardsRemainingToday(deckId, deck.newCardsPerDay),
  ]);

  const reviewLimit = deck.reviewsPerDay + getReviewLimitBumpToday(deckId);

  // Anki's daily-cap rule: interday learning/relearning shares the
  // reviewsPerDay budget with state-2 reviews and gets first dibs;
  // intraday learning bypasses the cap entirely.
  const dueLearning = learningRelearning.filter((c) => c.due <= now && ok(c));
  const intraday = dueLearning.filter(isIntradayLearning);
  const interday = dueLearning.filter((c) => !isIntradayLearning(c));
  const dueReview = reviewCards.filter((c) => c.due <= now && ok(c));
  const reviewBucket = [...interday, ...dueReview].slice(0, reviewLimit);

  // Anki default: new cards also count against reviewsPerDay (the
  // "newCardsIgnoreReviewLimit" toggle reverts to two independent caps).
  const ignoreReviewLimit = useFSRSSettingsStore.getState().newCardsIgnoreReviewLimit;
  const newCap = ignoreReviewLimit
    ? newRemaining
    : Math.min(newRemaining, Math.max(0, reviewLimit - reviewBucket.length));
  const dueNew = newCards.filter((c) => ok(c)).slice(0, newCap);

  return [...intraday, ...reviewBucket, ...dueNew];
}

/**
 * Per Anki, a learning/relearning card is intraday only when its step both
 * (a) is sub-day AND (b) does not cross the day boundary between
 * lastReview and due. From the Anki docs:
 *
 *   "if the step crosses a day boundary, the delay is automatically
 *   converted to days" (deck-options#day-boundaries)
 *
 * Anki rewrites the scheduled interval at scheduling time so a 6-hour step
 * taken at 11pm becomes a 1-day step; ts-fsrs does not. We detect the same
 * condition by comparing lastReview's calendar day with due's. Different
 * days → step crossed midnight → interday.
 */
function isIntradayLearning(c: SrsCard): boolean {
  if (c.scheduledDays >= 1) return false;
  if (!c.lastReview) return true;
  return startOfDayMs(c.lastReview) === startOfDayMs(c.due);
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bonus queue of cards that aren't due yet but are coming up soonest. The
 * regular queue is empty (or close to it) and the user wants to keep going.
 *
 * Ratings still write to FSRS as normal early reviews — elapsed-time is
 * meaningful, so this isn't cram-mode. New cards (state 0) are excluded;
 * they aren't "ahead", they're always available and have their own daily cap.
 */
export async function getStudyAheadQueue(
  deckId: string,
  modeFilter?: ReviewMode | 'both',
  tagFilter?: string[] | null,
  limit?: number,
): Promise<SrsCard[]> {
  const now = Date.now();

  let tagSentenceIds: Set<string> | null = null;
  if (tagFilter && tagFilter.length > 0) {
    const tagged = await repo.getSentencesByTags(tagFilter);
    tagSentenceIds = new Set(tagged.map((s) => s.id));
  }

  const modeOk = (c: SrsCard) =>
    !modeFilter || modeFilter === 'both' || c.reviewMode === modeFilter;
  const tagOk = (c: SrsCard) =>
    !tagSentenceIds || tagSentenceIds.has(c.sentenceId);

  const [learningRelearning, reviewCards] = await Promise.all([
    repo.getSrsCardsByDeckAndStates(deckId, [1, 3]),
    repo.getSrsCardsByDeckAndState(deckId, 2),
  ]);

  const future = [...learningRelearning, ...reviewCards]
    .filter((c) => c.due > now && modeOk(c) && tagOk(c))
    .sort((a, b) => a.due - b.due);

  return typeof limit === 'number' ? future.slice(0, limit) : future;
}

export interface FreeReviewQueueArgs {
  deckId: string;
  mode: ReviewMode | 'both';
  sentenceIds: string[];
  shuffle?: boolean;
  limit?: number | null;
}

/**
 * Build a queue for free review. Unlike {@link getReviewQueue} this ignores
 * due dates and daily limits — the user is opting in to drill specific cards.
 * Cards returned here are NEVER passed to FSRS scheduling; the caller must
 * skip {@link reviewCard} writes.
 */
export async function getFreeReviewQueue(args: FreeReviewQueueArgs): Promise<SrsCard[]> {
  const { deckId, mode, sentenceIds, shuffle = true, limit } = args;
  if (sentenceIds.length === 0) return [];

  const restrict = new Set(sentenceIds);
  const all = await repo.getSrsCardsByDeckAndStates(deckId, [0, 1, 2, 3]);
  let filtered = all.filter(
    (c) => (mode === 'both' || c.reviewMode === mode) && restrict.has(c.sentenceId)
  );

  if (shuffle) {
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
  }

  if (limit && limit > 0) filtered = filtered.slice(0, limit);
  return filtered;
}

/** Get counts for dashboard display */
export async function getDueCounts(
  deckId: string
): Promise<{ newCount: number; reviewCount: number; learningCount: number }> {
  const now = Date.now();

  const [newCount, reviewCount, learningCount] = await Promise.all([
    repo.countSrsCardsByDeckAndState(deckId, 0),
    repo.countDueSrsCardsByDeckAndStates(deckId, [2], now),
    repo.countDueSrsCardsByDeckAndStates(deckId, [1, 3], now),
  ]);

  return { newCount, reviewCount, learningCount };
}

/** Per-card mastery — 0 for new, saturates near 1 around ~30 days of stability. */
function cardMastery(card: SrsCard): number {
  if (card.state === 0) return 0;
  return Math.tanh(card.stability / 30);
}

/**
 * Overall per-sentence mastery derived from its 4 SRS cards (one per review mode).
 *
 * Averages the per-card mastery across all modes, so weak modes drag the score
 * down — "I can read it but can't produce it" shouldn't count as fully known.
 * A sentence fresh across every mode scores 0; fully mature scores near 1.
 */
export function sentenceMasteryFromCards(cards: SrsCard[]): number {
  if (cards.length === 0) return 0;
  const total = cards.reduce((sum, c) => sum + cardMastery(c), 0);
  return total / cards.length;
}

/**
 * Mastery for a single review mode — useful when the user wants to drill one
 * direction (e.g. sort by "least known EN→ZH"). Returns 0 if no card exists
 * for the given mode, since having no card is equivalent to having a new one.
 */
export function sentenceMasteryForMode(cards: SrsCard[], mode: ReviewMode): number {
  const card = cards.find((c) => c.reviewMode === mode);
  return card ? cardMastery(card) : 0;
}

/** Group all SrsCards by their sentenceId for bulk mastery scoring. */
export function groupCardsBySentence(cards: SrsCard[]): Map<string, SrsCard[]> {
  const map = new Map<string, SrsCard[]>();
  for (const card of cards) {
    const existing = map.get(card.sentenceId);
    if (existing) existing.push(card);
    else map.set(card.sentenceId, [card]);
  }
  return map;
}

export type ModeCounts = Record<ReviewMode, number>;

/**
 * Per-mode counts. The first three are what the user can review *right now*
 * (cap-applied, matches getReviewQueue). The "*Backlog" / futureCount fields
 * are what *could* be reviewed via Custom Study actions — used by the
 * Dashboard to decide which Custom Study rows to show when due === 0.
 */
export interface ModeStateCounts {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  /** Unseen new cards held back by the daily new-card cap. */
  newBacklog: number;
  /** Already-due review cards held back by the daily review cap. */
  reviewBacklog: number;
  /** Cards scheduled in the future (study-ahead candidates). */
  futureCount: number;
}

export const EMPTY_MODE_STATE: ModeStateCounts = {
  newCount: 0, learningCount: 0, reviewCount: 0,
  newBacklog: 0, reviewBacklog: 0, futureCount: 0,
};

export interface DueBreakdown {
  byMode: ModeCounts;
  byModeAndState: Record<ReviewMode | 'all', ModeStateCounts>;
}

/**
 * Due card counts broken down by review mode and card state. Counts are
 * cap-aware: they reflect what `getReviewQueue` would actually return for
 * each mode, so "X due (today)" matches what clicking Study delivers.
 *
 * Also surfaces "what could be unlocked": newBacklog/reviewBacklog (cards
 * the daily caps are holding back) and futureCount (study-ahead candidates).
 */
export async function getDueBreakdown(deckId: string): Promise<DueBreakdown> {
  const now = Date.now();
  const deck = await repo.getDeck(deckId);
  if (!deck) {
    const empty = EMPTY_MODE_STATE;
    const byModeAndState = {
      'all': empty, 'en-to-zh': empty, 'zh-to-en': empty,
      'py-to-en-zh': empty, 'listen-type': empty, 'speak': empty,
    };
    return {
      byMode: { 'en-to-zh': 0, 'zh-to-en': 0, 'py-to-en-zh': 0, 'listen-type': 0, 'speak': 0 },
      byModeAndState,
    };
  }

  const [newCards, learningCards, reviewCards, newRemaining] = await Promise.all([
    repo.getSrsCardsByDeckAndState(deckId, 0),
    repo.getSrsCardsByDeckAndStates(deckId, [1, 3]),
    repo.getSrsCardsByDeckAndState(deckId, 2),
    newCardsRemainingToday(deckId, deck.newCardsPerDay),
  ]);

  const reviewLimit = deck.reviewsPerDay + getReviewLimitBumpToday(deckId);
  const ignoreReviewLimit = useFSRSSettingsStore.getState().newCardsIgnoreReviewLimit;

  const dueLearning = learningCards.filter((c) => c.due <= now);
  const intraday = dueLearning.filter(isIntradayLearning);
  const interday = dueLearning.filter((c) => !isIntradayLearning(c));
  const dueReview = reviewCards.filter((c) => c.due <= now);
  const futureCards = [...learningCards, ...reviewCards].filter((c) => c.due > now);

  const modes: (ReviewMode | 'all')[] = ['all', 'en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type', 'speak'];
  const byMode: ModeCounts = { 'en-to-zh': 0, 'zh-to-en': 0, 'py-to-en-zh': 0, 'listen-type': 0, 'speak': 0 };
  const byModeAndState = {} as DueBreakdown['byModeAndState'];

  for (const m of modes) {
    const modeOk = (c: SrsCard) => m === 'all' || c.reviewMode === m;
    const modeNewTotal = newCards.filter(modeOk).length;
    const modeIntradayTotal = intraday.filter(modeOk).length;
    const modeInterdayTotal = interday.filter(modeOk).length;
    const modeDueReviewTotal = dueReview.filter(modeOk).length;
    const modeReviewBucketTotal = modeInterdayTotal + modeDueReviewTotal;

    const rc = Math.min(modeReviewBucketTotal, reviewLimit);
    const reviewBacklog = Math.max(0, modeReviewBucketTotal - reviewLimit);

    const newSlots = ignoreReviewLimit
      ? newRemaining
      : Math.min(newRemaining, Math.max(0, reviewLimit - rc));
    const nc = Math.min(modeNewTotal, newSlots);

    byModeAndState[m] = {
      newCount: nc,
      learningCount: modeIntradayTotal,
      reviewCount: rc,
      newBacklog: Math.max(0, modeNewTotal - newSlots),
      reviewBacklog,
      futureCount: futureCards.filter(modeOk).length,
    };
    if (m !== 'all') byMode[m] = nc + modeIntradayTotal + rc;
  }

  return { byMode, byModeAndState };
}
