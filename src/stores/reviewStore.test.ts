import { describe, it, expect, beforeEach } from 'vitest';
import { useReviewStore } from './reviewStore';
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

describe('useReviewStore — requeueCurrent', () => {
  beforeEach(() => {
    useReviewStore.getState().reset();
  });

  it('moves current card to the end of the queue, leaves index pointing at next card', () => {
    const cards = [
      card({ id: 'a' }),
      card({ id: 'b' }),
      card({ id: 'c' }),
    ];
    const store = useReviewStore.getState();
    store.setQueue(cards, { freeReview: true });

    store.requeueCurrent();

    const { queue, currentIndex } = useReviewStore.getState();
    expect(queue[currentIndex].id).toBe('b');
    expect(queue[queue.length - 1].id).toBe('a');
    expect(queue).toHaveLength(3);
  });

  it('single-card queue ends the session instead of looping', () => {
    const cards = [card({ id: 'only' })];
    const store = useReviewStore.getState();
    store.setQueue(cards, { freeReview: true });

    store.requeueCurrent();

    const state = useReviewStore.getState();
    expect(state.currentCard()).toBeNull();
    expect(state.remaining()).toBe(0);
  });

  it('clears isFlipped and undoInfo', () => {
    const cards = [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })];
    const store = useReviewStore.getState();
    store.setQueue(cards, { freeReview: true });

    // Flip first
    store.flip();
    expect(useReviewStore.getState().isFlipped).toBe(true);

    store.requeueCurrent();

    const after = useReviewStore.getState();
    expect(after.isFlipped).toBe(false);
    expect(after.undoInfo).toBeNull();
  });
});
