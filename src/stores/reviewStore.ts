/**
 * Review session store.
 */
import { create } from 'zustand';
import type { SrsCard } from '../db/schema';

interface ReviewState {
  queue: SrsCard[];
  currentIndex: number;
  isFlipped: boolean;
  isLoading: boolean;

  setQueue: (cards: SrsCard[]) => void;
  flip: () => void;
  next: () => void;
  currentCard: () => SrsCard | null;
  remaining: () => number;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  isFlipped: false,
  isLoading: false,

  setQueue: (cards) =>
    set({ queue: cards, currentIndex: 0, isFlipped: false, isLoading: false }),

  flip: () => set({ isFlipped: true }),

  next: () => {
    const { currentIndex } = get();
    set({ currentIndex: currentIndex + 1, isFlipped: false });
  },

  currentCard: () => {
    const { queue, currentIndex } = get();
    return currentIndex < queue.length ? queue[currentIndex] : null;
  },

  remaining: () => {
    const { queue, currentIndex } = get();
    return queue.length - currentIndex;
  },

  reset: () =>
    set({ queue: [], currentIndex: 0, isFlipped: false, isLoading: false }),
}));
