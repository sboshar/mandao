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
import type { SrsCard, ReviewLog, ReviewMode } from '../db/schema';
import { v4 as uuid } from 'uuid';

const params = generatorParameters();
const scheduler = fsrs(params);

export { Rating };
export type { Grade };

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

/** Review a card with a given rating. Updates the card and logs the review. */
export async function reviewCard(
  cardId: string,
  rating: Grade
): Promise<void> {
  const card = await repo.getSrsCard(cardId);
  if (!card) throw new Error(`Card not found: ${cardId}`);

  const fsrsCard = toFSRSCard(card);
  const now = new Date();
  const result = scheduler.repeat(fsrsCard, now);
  const next = result[rating].card;

  // Update card
  await repo.updateSrsCard(cardId, {
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    lastReview: now.getTime(),
  });

  // Log the review
  const log: ReviewLog = {
    id: uuid(),
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

  const [newCards, reviewCards, learningCards] = await Promise.all([
    repo.getSrsCardsByDeckAndState(deckId, 0),
    repo.getSrsCardsByDeckAndState(deckId, 2),
    repo.getSrsCardsByDeckAndStates(deckId, [1, 3]),
  ]);

  return {
    newCount: newCards.length,
    reviewCount: reviewCards.filter((c) => c.due <= now).length,
    learningCount: learningCards.filter((c) => c.due <= now).length,
  };
}
