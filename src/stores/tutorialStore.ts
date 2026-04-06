import { create } from 'zustand';

/**
 * Tutorial steps:
 * 0 = intro modal showing
 * 1 = dashboard: "Click Browse to see the example sentences"
 * 2 = browse: "Click on a sentence to expand it"
 * 3 = browse (expanded): "Click on any character to explore its meaning"
 * 4 = meaning card open: explain the explorer
 * 5 = done
 */
export type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5;

const STORAGE_KEY = 'mandao_tutorial_step';

function loadStep(): TutorialStep {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return 0;
  const n = parseInt(raw, 10);
  return (n >= 0 && n <= 5 ? n : 5) as TutorialStep;
}

interface TutorialState {
  step: TutorialStep;
  advance: () => void;
  skipAll: () => void;
}

export const useTutorialStore = create<TutorialState>((set) => ({
  step: loadStep(),
  advance: () =>
    set((s) => {
      const next = Math.min(s.step + 1, 5) as TutorialStep;
      localStorage.setItem(STORAGE_KEY, String(next));
      return { step: next };
    }),
  skipAll: () => {
    localStorage.setItem(STORAGE_KEY, '5');
    set({ step: 5 });
  },
}));
