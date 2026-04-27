import { create } from 'zustand';

const STORAGE_KEY = 'mandao_audio_cache_settings';

export type AudioCacheCapMB = 100 | 200 | 500;

/** Hard cap on a single recording's duration. Bounded so we stay safely
 *  under the 2 MiB per-file Storage limit at any plausible browser bitrate. */
export const RECORDING_CAP_SEC_MIN = 5;
export const RECORDING_CAP_SEC_MAX = 60;
export const RECORDING_CAP_SEC_DEFAULT = 20;

export interface AudioCacheSettings {
  capMB: AudioCacheCapMB;
  /** Per-recording length cap, in seconds. */
  recordingCapSec: number;
}

const DEFAULTS: AudioCacheSettings = {
  capMB: 200,
  recordingCapSec: RECORDING_CAP_SEC_DEFAULT,
};

const VALID_CAPS: AudioCacheCapMB[] = [100, 200, 500];

function clampRecordingCap(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return RECORDING_CAP_SEC_DEFAULT;
  return Math.min(RECORDING_CAP_SEC_MAX, Math.max(RECORDING_CAP_SEC_MIN, Math.round(v)));
}

function load(): AudioCacheSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioCacheSettings>;
    const cap = parsed.capMB;
    const validCap =
      typeof cap === 'number' && VALID_CAPS.includes(cap as AudioCacheCapMB)
        ? (cap as AudioCacheCapMB)
        : DEFAULTS.capMB;
    return {
      capMB: validCap,
      recordingCapSec: clampRecordingCap(parsed.recordingCapSec),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: AudioCacheSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface AudioCacheSettingsState extends AudioCacheSettings {
  setCapMB: (cap: AudioCacheCapMB) => void;
  setRecordingCapSec: (sec: number) => void;
}

export const useAudioCacheSettingsStore = create<AudioCacheSettingsState>((set, get) => ({
  ...load(),
  setCapMB: (capMB) => {
    const next = { ...get(), capMB };
    save(next);
    set({ capMB });
  },
  setRecordingCapSec: (sec) => {
    const recordingCapSec = clampRecordingCap(sec);
    const next = { ...get(), recordingCapSec };
    save(next);
    set({ recordingCapSec });
  },
}));

export function getAudioCacheCapBytes(): number {
  return useAudioCacheSettingsStore.getState().capMB * 1024 * 1024;
}

export function getRecordingCapMs(): number {
  return useAudioCacheSettingsStore.getState().recordingCapSec * 1000;
}
