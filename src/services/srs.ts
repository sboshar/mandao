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
  const [learningRelearning, reviewCards, newCards] = await Promise.all([
    repo.getSrsCardsByDeckAndStates(deckId, [1, 3]),
    repo.getSrsCardsByDeckAndState(deckId, 2),
    repo.getSrsCardsByDeckAndState(deckId, 0),
  ]);

  // Learning cards (state=1 or 3, due now)
  const duelearning = learningRelearning.filter((c) => c.due <= now && ok(c));

  // Review cards (state=2, due now, up to daily limit)
  const dueReview = reviewCards
    .filter((c) => c.due <= now && ok(c))
    .slice(0, deck.reviewsPerDay);

  // New cards (state=0) up to daily limit
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayLogs = await repo.getReviewLogsSince(todayStart.getTime());

  const todayNewCardIds = new Set(todayLogs.map((r) => r.cardId));
  const todayCards = await repo.getSrsCardsByIds([...todayNewCardIds]);
  const newReviewedToday = todayCards.filter((c) => c.reps === 1).length;

  const remaining = Math.max(0, deck.newCardsPerDay - newReviewedToday);
  const dueNew = newCards.filter((c) => ok(c)).slice(0, remaining);

  // Priority: learning/relearning > review > new
  return [...duelearning, ...dueReview, ...dueNew];
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

export interface DueBreakdown {
  byMode: ModeCounts;
  /** Per-state counts keyed by mode ('all' includes every mode) */
  byModeAndState: Record<ReviewMode | 'all', { newCount: number; learningCount: number; reviewCount: number }>;
}

/** Get due card counts broken down by review mode and card state */
export async function getDueBreakdown(deckId: string): Promise<DueBreakdown> {
  const now = Date.now();

  const [newCards, learningCards, reviewCards] = await Promise.all([
    repo.getSrsCardsByDeckAndState(deckId, 0),
    repo.getSrsCardsByDeckAndStates(deckId, [1, 3]),
    repo.getSrsCardsByDeckAndState(deckId, 2),
  ]);

  const dueNew = newCards;
  const dueLearning = learningCards.filter((c) => c.due <= now);
  const dueReview = reviewCards.filter((c) => c.due <= now);

  const modes: (ReviewMode | 'all')[] = ['all', 'en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type', 'speak'];
  const byMode: ModeCounts = { 'en-to-zh': 0, 'zh-to-en': 0, 'py-to-en-zh': 0, 'listen-type': 0, 'speak': 0 };
  const byModeAndState = {} as DueBreakdown['byModeAndState'];

  for (const m of modes) {
    const modeOk = (c: SrsCard) => m === 'all' || c.reviewMode === m;
    const nc = dueNew.filter(modeOk).length;
    const lc = dueLearning.filter(modeOk).length;
    const rc = dueReview.filter(modeOk).length;
    byModeAndState[m] = { newCount: nc, learningCount: lc, reviewCount: rc };
    if (m !== 'all') byMode[m] = nc + lc + rc;
  }

  return { byMode, byModeAndState };
}
