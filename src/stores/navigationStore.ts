/**
 * Navigation store for recursive meaning exploration.
 * Stack-based back/forward like a browser.
 */
import { create } from 'zustand';

export interface NavigationEntry {
  type: 'meaning' | 'sentence' | 'pinyin' | 'english';
  /** meaning id, sentence id, pinyinNumeric string, or english word */
  id: string;
}

interface NavigationState {
  stack: NavigationEntry[];
  currentIndex: number;
  isOpen: boolean;

  push: (entry: NavigationEntry) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  current: () => NavigationEntry | null;
  close: () => void;
  open: (entry: NavigationEntry) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  stack: [],
  currentIndex: -1,
  isOpen: false,

  push: (entry) => {
    const { stack, currentIndex } = get();
    // Truncate any forward history
    const newStack = stack.slice(0, currentIndex + 1);
    newStack.push(entry);
    set({ stack: newStack, currentIndex: newStack.length - 1 });
  },

  goBack: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },

  goForward: () => {
    const { stack, currentIndex } = get();
    if (currentIndex < stack.length - 1) {
      set({ currentIndex: currentIndex + 1 });
    }
  },

  canGoBack: () => get().currentIndex > 0,
  canGoForward: () => get().currentIndex < get().stack.length - 1,
  current: () => {
    const { stack, currentIndex } = get();
    return currentIndex >= 0 ? stack[currentIndex] : null;
  },

  close: () => set({ isOpen: false, stack: [], currentIndex: -1 }),
  open: (entry) => set({ isOpen: true, stack: [entry], currentIndex: 0 }),
}));
