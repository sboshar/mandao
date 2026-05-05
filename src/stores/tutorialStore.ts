import { create } from 'zustand';
import { deleteTutorialSentences } from '../services/ingestion';
import { hasSentenceNotFromSource } from '../db/repo';
import { TUTORIAL_SOURCE } from '../data/tutorialSentences';

/**
 * Tutorial steps:
 * 0 = intro modal (theory + example sentences in proper format)
 * 1 = add sentence page (tutorial mode, walk through adding first sentence)
 * 2 = dashboard: other 2 sentences seeded, point to Browse
 * 3 = browse: expand the 花 sentence
 * 4 = browse expanded: click on 花 character
 * 5 = meaning card: explain explorer + note multiple meanings
 * 6 = dashboard wrap-up
 * 7 = done
 */
export type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STORAGE_KEY = 'mandao_tutorial_step';
const MAX_STEP = 7;

function loadStep(): TutorialStep {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return 0;
  const n = parseInt(raw, 10);
  return (n >= 0 && n <= MAX_STEP ? n : MAX_STEP) as TutorialStep;
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
      const next = Math.min(s.step + 1, MAX_STEP) as TutorialStep;
      localStorage.setItem(STORAGE_KEY, String(next));
      if (s.step === 6) deleteTutorialSentences();
      return { step: next };
    }),
  skipAll: () => {
    localStorage.setItem(STORAGE_KEY, String(MAX_STEP));
    deleteTutorialSentences();
    set({ step: MAX_STEP as TutorialStep });
  },
}));

/**
 * Skip the tutorial on devices where the user already has data, so a
 * returning user signing in on a fresh browser doesn't get re-onboarded.
 * No-op if any explicit progress is already persisted on this device —
 * we don't want to advance a user mid-tutorial.
 */
export async function skipTutorialIfReturningUser(): Promise<void> {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  if (!(await hasSentenceNotFromSource(TUTORIAL_SOURCE))) return;
  localStorage.setItem(STORAGE_KEY, String(MAX_STEP));
  useTutorialStore.setState({ step: MAX_STEP as TutorialStep });
}
