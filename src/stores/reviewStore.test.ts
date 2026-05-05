import { describe, it, expect, beforeEach } from 'vitest';
import { useReviewStore } from './reviewStore';
import { card } from '../test/factories';

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
