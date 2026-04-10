/**
 * Review session store.
 */
import { create } from 'zustand';
import type { SrsCard } from '../db/schema';
import type { UndoInfo } from '../services/srs';

interface ReviewState {
  queue: SrsCard[];
  currentIndex: number;
  isFlipped: boolean;
  isLoading: boolean;
  undoInfo: UndoInfo | null;

  setQueue: (cards: SrsCard[]) => void;
  flip: () => void;
  next: (undo?: UndoInfo) => void;
  prev: () => void;
  currentCard: () => SrsCard | null;
  remaining: () => number;
  clearUndo: () => void;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  isFlipped: false,
  isLoading: false,
  undoInfo: null,

  setQueue: (cards) =>
    set({ queue: cards, currentIndex: 0, isFlipped: false, isLoading: false, undoInfo: null }),

  flip: () => set({ isFlipped: true }),

  next: (undo) => {
    const { currentIndex } = get();
    set({ currentIndex: currentIndex + 1, isFlipped: false, undoInfo: undo ?? null });
  },

  prev: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1, isFlipped: false, undoInfo: null });
    }
  },

  currentCard: () => {
    const { queue, currentIndex } = get();
    return currentIndex < queue.length ? queue[currentIndex] : null;
  },

  remaining: () => {
    const { queue, currentIndex } = get();
    return queue.length - currentIndex;
  },

  clearUndo: () => set({ undoInfo: null }),

  reset: () =>
    set({ queue: [], currentIndex: 0, isFlipped: false, isLoading: false, undoInfo: null }),
}));
