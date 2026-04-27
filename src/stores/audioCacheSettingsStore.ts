import { create } from 'zustand';

const STORAGE_KEY = 'mandao_audio_cache_settings';

export type AudioCacheCapMB = 100 | 200 | 500;

export interface AudioCacheSettings {
  capMB: AudioCacheCapMB;
}

const DEFAULTS: AudioCacheSettings = {
  capMB: 200,
};

const VALID_CAPS: AudioCacheCapMB[] = [100, 200, 500];

function load(): AudioCacheSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioCacheSettings>;
    const cap = parsed.capMB;
    if (typeof cap === 'number' && VALID_CAPS.includes(cap as AudioCacheCapMB)) {
      return { capMB: cap as AudioCacheCapMB };
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: AudioCacheSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface AudioCacheSettingsState extends AudioCacheSettings {
  setCapMB: (cap: AudioCacheCapMB) => void;
}

export const useAudioCacheSettingsStore = create<AudioCacheSettingsState>((set) => ({
  ...load(),
  setCapMB: (capMB) => {
    save({ capMB });
    set({ capMB });
  },
}));

export function getAudioCacheCapBytes(): number {
  return useAudioCacheSettingsStore.getState().capMB * 1024 * 1024;
}
