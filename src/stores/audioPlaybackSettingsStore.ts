import { create } from 'zustand';
import type { ReviewMode } from '../db/schema';

const STORAGE_KEY = 'mandao_audio_playback_settings';

export interface AudioPlaybackSettings {
  /** Master toggle. When off, no auto-play happens regardless of per-mode flags. */
  masterEnabled: boolean;
  /** Per-mode toggles. Listen-type fires when the card is shown; the rest fire after flip. */
  perMode: Record<ReviewMode, boolean>;
}

const DEFAULTS: AudioPlaybackSettings = {
  masterEnabled: true,
  perMode: {
    'listen-type': true,
    'zh-to-en': true,
    'en-to-zh': true,
    'py-to-en-zh': false,
    'speak': false,
  },
};

const VALID_MODES: ReviewMode[] = ['en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type', 'speak'];

function load(): AudioPlaybackSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<AudioPlaybackSettings>;
    const merged = clone(DEFAULTS);
    if (typeof parsed.masterEnabled === 'boolean') merged.masterEnabled = parsed.masterEnabled;
    if (parsed.perMode && typeof parsed.perMode === 'object') {
      for (const m of VALID_MODES) {
        const v = (parsed.perMode as Record<string, unknown>)[m];
        if (typeof v === 'boolean') merged.perMode[m] = v;
      }
    }
    return merged;
  } catch {
    return clone(DEFAULTS);
  }
}

function clone(s: AudioPlaybackSettings): AudioPlaybackSettings {
  return { masterEnabled: s.masterEnabled, perMode: { ...s.perMode } };
}

function save(s: AudioPlaybackSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface AudioPlaybackSettingsState extends AudioPlaybackSettings {
  setMasterEnabled: (v: boolean) => void;
  setModeEnabled: (mode: ReviewMode, v: boolean) => void;
}

export const useAudioPlaybackSettingsStore = create<AudioPlaybackSettingsState>((set, get) => ({
  ...load(),
  setMasterEnabled: (masterEnabled) => {
    if (get().masterEnabled === masterEnabled) return;
    save({ ...get(), masterEnabled });
    set({ masterEnabled });
  },
  setModeEnabled: (mode, v) => {
    if (get().perMode[mode] === v) return;
    const perMode = { ...get().perMode, [mode]: v };
    save({ ...get(), perMode });
    set({ perMode });
  },
}));
