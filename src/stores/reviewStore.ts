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
  /** When true, ratings/actions must NOT write to FSRS. */
  isFreeReview: boolean;

  setQueue: (cards: SrsCard[], opts?: { freeReview?: boolean }) => void;
  flip: () => void;
  next: (undo?: UndoInfo) => void;
  prev: () => void;
  /** Free-review only: send the current card to the back of the queue and advance. */
  requeueCurrent: () => void;
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
  isFreeReview: false,

  setQueue: (cards, opts) =>
    set({
      queue: cards,
      currentIndex: 0,
      isFlipped: false,
      isLoading: false,
      undoInfo: null,
      isFreeReview: opts?.freeReview ?? false,
    }),

  flip: () => set({ isFlipped: true }),

  next: (undo) => {
    const { currentIndex } = get();
    set({ currentIndex: currentIndex + 1, isFlipped: false, undoInfo: undo ?? null });
  },

  prev: () => {
    const { currentIndex, queue, undoInfo } = get();
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      // Patch the in-memory card with reverted state so the UI isn't stale after undo
      if (undoInfo && queue[prevIndex]?.id === undoInfo.cardId) {
        const patched = [...queue];
        patched[prevIndex] = { ...patched[prevIndex], ...undoInfo.oldCardState };
        set({ queue: patched, currentIndex: prevIndex, isFlipped: false, undoInfo: null });
      } else {
        set({ currentIndex: prevIndex, isFlipped: false, undoInfo: null });
      }
    }
  },

  requeueCurrent: () => {
    const { queue, currentIndex } = get();
    if (currentIndex >= queue.length) return;
    // Only one unconsumed card left: requeueing would put it right back at currentIndex
    // and trap the user. Treat "Again later" as "next" and end the session instead.
    if (queue.length - currentIndex <= 1) {
      set({ currentIndex: queue.length, isFlipped: false, undoInfo: null });
      return;
    }
    const card = queue[currentIndex];
    const next = [...queue.slice(0, currentIndex), ...queue.slice(currentIndex + 1), card];
    // currentIndex stays — what's now at this slot is the next card.
    set({ queue: next, isFlipped: false, undoInfo: null });
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
    set({
      queue: [],
      currentIndex: 0,
      isFlipped: false,
      isLoading: false,
      undoInfo: null,
      isFreeReview: false,
    }),
}));
