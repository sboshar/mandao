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
import { db } from '../db/db';
import type { SrsCard, ReviewLog, ReviewMode } from '../db/schema';
import { v4 as uuid } from 'uuid';

const params = generatorParameters();
const scheduler = fsrs(params);

export { Rating };

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
  const card = await db.srsCards.get(cardId);
  if (!card) throw new Error(`Card not found: ${cardId}`);

  const fsrsCard = toFSRSCard(card);
  const now = new Date();
  const result = scheduler.repeat(fsrsCard, now);
  const next = result[rating].card;

  // Update card
  await db.srsCards.update(cardId, {
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
  await db.reviewLogs.add(log);
}

/** Get review queue for a deck, optionally filtered by review mode and/or tags */
export async function getReviewQueue(
  deckId: string,
  modeFilter?: ReviewMode | 'both',
  tagFilter?: string[] | null
): Promise<SrsCard[]> {
  const now = Date.now();
  const deck = await db.decks.get(deckId);
  if (!deck) return [];

  // If filtering by tags, get the set of matching sentence IDs (union of all selected tags)
  let tagSentenceIds: Set<string> | null = null;
  if (tagFilter && tagFilter.length > 0) {
    const tagged = await db.sentences
      .where('tags')
      .anyOf(tagFilter)
      .toArray();
    tagSentenceIds = new Set(tagged.map((s) => s.id));
  }

  const modeOk = (c: SrsCard) =>
    !modeFilter || modeFilter === 'both' || c.reviewMode === modeFilter;
  const tagOk = (c: SrsCard) =>
    !tagSentenceIds || tagSentenceIds.has(c.sentenceId);
  const ok = (c: SrsCard) => modeOk(c) && tagOk(c);

  // Learning cards (state=1, due now)
  const learningCards = await db.srsCards
    .where('[deckId+state]')
    .equals([deckId, 1])
    .filter((c) => c.due <= now && ok(c))
    .toArray();

  // Relearning cards (state=3, due now)
  const relearningCards = await db.srsCards
    .where('[deckId+state]')
    .equals([deckId, 3])
    .filter((c) => c.due <= now && ok(c))
    .toArray();

  // Review cards (state=2, due now)
  const reviewCards = await db.srsCards
    .where('[deckId+state]')
    .equals([deckId, 2])
    .filter((c) => c.due <= now && ok(c))
    .limit(deck.reviewsPerDay)
    .toArray();

  // New cards (state=0) up to daily limit
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayNewReviewed = await db.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(todayStart.getTime())
    .toArray();

  const todayNewCardIds = new Set(todayNewReviewed.map((r) => r.cardId));
  const newReviewedToday = (
    await Promise.all(
      [...todayNewCardIds].map((id) => db.srsCards.get(id))
    )
  ).filter((c) => c && c.reps === 1).length;

  const remaining = Math.max(0, deck.newCardsPerDay - newReviewedToday);
  const newCards = await db.srsCards
    .where('[deckId+state]')
    .equals([deckId, 0])
    .filter((c) => ok(c))
    .limit(remaining)
    .toArray();

  // Priority: learning/relearning > review > new
  return [...learningCards, ...relearningCards, ...reviewCards, ...newCards];
}

/** Get counts for dashboard display */
export async function getDueCounts(
  deckId: string
): Promise<{ newCount: number; reviewCount: number; learningCount: number }> {
  const now = Date.now();

  const newCount = await db.srsCards
    .where('[deckId+state]')
    .equals([deckId, 0])
    .count();

  const reviewCount = await db.srsCards
    .where('[deckId+state]')
    .equals([deckId, 2])
    .filter((c) => c.due <= now)
    .count();

  const learningCount = await db.srsCards
    .where('[deckId+state]')
    .anyOf([
      [deckId, 1],
      [deckId, 3],
    ])
    .filter((c) => c.due <= now)
    .count();

  return { newCount, reviewCount, learningCount };
}
