import { create } from 'zustand';
import type { Steps } from 'ts-fsrs';

const STORAGE_KEY = 'mandao_fsrs_settings';

export interface FSRSSettings {
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningSteps: string[];
  relearningSteps: string[];
}

const DEFAULTS: FSRSSettings = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  enableFuzz: false,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
};

function load(): FSRSSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: FSRSSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface FSRSSettingsState extends FSRSSettings {
  update: (patch: Partial<FSRSSettings>) => void;
  reset: () => void;
}

export const useFSRSSettingsStore = create<FSRSSettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    const next = { ...get(), ...patch };
    save(next);
    set(patch);
  },
  reset: () => {
    save(DEFAULTS);
    set({ ...DEFAULTS });
  },
}));

/** Convert store state to ts-fsrs generatorParameters input */
export function toFSRSParams(s: FSRSSettings) {
  return {
    request_retention: s.requestRetention,
    maximum_interval: s.maximumInterval,
    enable_fuzz: s.enableFuzz,
    enable_short_term: s.enableShortTerm,
    learning_steps: s.learningSteps as Steps,
    relearning_steps: s.relearningSteps as Steps,
  };
}
