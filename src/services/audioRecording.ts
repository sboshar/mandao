/**
 * Audio recording service using MediaRecorder.
 *
 * Two modes:
 *   - startRecording(): capture raw audio only (used by the Browse / review
 *     recording controls).
 *   - startStreamingRecognitionWithAudio(): capture audio AND stream speech
 *     recognition in parallel, so one mic session yields both a transcript
 *     and a keepable audio clip (used by the voice button on Add Sentence).
 */
import {
  startStreamingRecognition,
  type StreamingOptions,
} from './speechRecognition';

export function isAudioRecordingSupported(): boolean {
  return typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';
}

/** Pick a supported audio mime type, preferring webm/opus, falling back as available. */
function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface RecordingHandle {
  /** Stop the recording and resolve with the blob. */
  stop: () => Promise<RecordingResult>;
  /** Abort without producing a blob. */
  cancel: () => void;
  /** True if the recorder auto-stopped because it hit `maxDurationMs`. */
  hitDurationCap: () => boolean;
}

export interface RecordingOptions {
  /** Hard cap on recording length. The recorder auto-stops when reached.
   *  Keeps blob size bounded under the Storage 2 MiB cap; default lives in
   *  the audio settings store. Pass 0 / undefined to disable. */
  maxDurationMs?: number;
  /** Optional callback fired when the cap auto-stop kicks in (so the UI
   *  can finalize and surface a toast). */
  onDurationCap?: () => void;
}

/**
 * Start recording audio from the microphone.
 * Returns a handle; call stop() to finalize and get the blob. If
 * `maxDurationMs` is set, the recorder auto-stops at that limit.
 *
 * The result promise is resolved exactly once by the recorder's onstop /
 * onerror handlers (registered eagerly, before recorder.start()), so
 * concurrent stop() calls — e.g., user click racing the cap timer —
 * share the same outcome instead of overwriting each other's resolvers.
 */
export async function startRecording(
  opts: RecordingOptions = {},
): Promise<RecordingHandle> {
  if (!isAudioRecordingSupported()) {
    throw new Error('Audio recording is not supported in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;
  let capped = false;

  const cleanupStream = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  let capTimer: ReturnType<typeof setTimeout> | null = null;
  const clearCapTimer = () => {
    if (capTimer != null) {
      clearTimeout(capTimer);
      capTimer = null;
    }
  };

  let resolveResult: ((r: RecordingResult) => void) | null = null;
  let rejectResult: ((e: any) => void) | null = null;
  const resultPromise = new Promise<RecordingResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    clearCapTimer();
    cleanupStream();
    if (cancelled) {
      rejectResult?.(new Error('Recording cancelled'));
    } else {
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      resolveResult?.({ blob, mimeType: type, durationMs: Date.now() - startedAt });
    }
    resolveResult = null;
    rejectResult = null;
  };

  recorder.onerror = (e: any) => {
    clearCapTimer();
    cleanupStream();
    rejectResult?.(e?.error || new Error('Recording failed'));
    resolveResult = null;
    rejectResult = null;
  };

  recorder.start();

  if (opts.maxDurationMs && opts.maxDurationMs > 0) {
    capTimer = setTimeout(() => {
      capTimer = null;
      if (cancelled) return;
      if (recorder.state !== 'inactive') {
        capped = true;
        try { recorder.stop(); } catch {}
        opts.onDurationCap?.();
      }
    }, opts.maxDurationMs);
  }

  const stop = (): Promise<RecordingResult> => {
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    return resultPromise;
  };

  const cancel = () => {
    cancelled = true;
    clearCapTimer();
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {}
    cleanupStream();
  };

  return { stop, cancel, hitDurationCap: () => capped };
}

export interface VoiceWithAudioResult {
  transcript: string;
  audio: RecordingResult | null;
}

export interface StreamingWithAudioHandle {
  /** Stop streaming; resolves with final transcript + audio blob. */
  stop: () => Promise<VoiceWithAudioResult>;
  /** Abort and discard both transcript and audio. */
  cancel: () => void;
}

/**
 * Start a streaming recognition session with parallel audio capture.
 * MediaRecorder runs the whole time and SpeechRecognition streams interim
 * results until the caller invokes stop(). Used for the voice button on
 * Add Sentence.
 */
export async function startStreamingRecognitionWithAudio(
  opts: StreamingOptions & RecordingOptions = {}
): Promise<StreamingWithAudioHandle> {
  let recHandle: RecordingHandle | null = null;
  if (isAudioRecordingSupported()) {
    try {
      recHandle = await startRecording({
        maxDurationMs: opts.maxDurationMs,
        onDurationCap: opts.onDurationCap,
      });
    } catch {
      recHandle = null;
    }
  }

  const streamHandle = startStreamingRecognition(opts);

  const stop = async (): Promise<VoiceWithAudioResult> => {
    const transcript = await streamHandle.stop();
    const audio = recHandle ? await recHandle.stop().catch(() => null) : null;
    return { transcript, audio };
  };

  const cancel = () => {
    streamHandle.cancel();
    recHandle?.cancel();
  };

  return { stop, cancel };
}

/**
 * Format duration for display: "0:07", "1:23".
 */
export function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Single shared Audio element for all blob playback.
 *
 * iOS Safari rejects audio.play() for unmuted audio when the call doesn't
 * happen inside a user-gesture event handler — and our playback path
 * always has an `await fetchAudioBlob()` between the click and play(),
 * which loses the gesture.
 *
 * The fix: prime the element with a real (silent-amplitude) MP3 played
 * UNMUTED inside the user gesture. iOS counts that as a "real" play and
 * marks the element as user-authorized. Subsequent play() calls on the
 * same element are then allowed even after async work.
 *
 * (Earlier attempts: a 0-data-byte WAV data URL — iOS rejects those;
 * a muted-then-unmute trick — iOS silently keeps the element muted
 * because un-mute outside a gesture isn't honored.)
 */
let sharedAudio: HTMLAudioElement | null = null;
let pendingObjectUrl: string | null = null;
let audioUnlocked = false;

function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/** Diagnostic-only escape hatch: lets the audio diagnostic attach listeners
 *  to the same Audio element the real playback path uses. Don't call this
 *  from production UI; use playBlob/unlockAudio. */
export function _getSharedAudioForDiagnostic(): HTMLAudioElement {
  return getSharedAudio();
}

/** Global debug log buffer. Populated when ?audioDebug=1 is on the URL.
 *  A debug overlay reads this to show what's happening during playback. */
const DEBUG_RING_SIZE = 200;
const debugLog: string[] = [];
const debugListeners = new Set<() => void>();

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (sessionStorage.getItem('mandao_audio_debug') === '1') return true;
  if (new URLSearchParams(window.location.search).get('audioDebug') === '1') {
    sessionStorage.setItem('mandao_audio_debug', '1');
    return true;
  }
  return false;
}

function debugPush(line: string) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toLocaleTimeString().slice(-8) + '.' + String(Date.now() % 1000).padStart(3, '0');
  debugLog.push(`[${stamp}] ${line}`);
  if (debugLog.length > DEBUG_RING_SIZE) debugLog.shift();
  for (const cb of debugListeners) { try { cb(); } catch { /* noop */ } }
}

export function getAudioDebugLog(): string[] {
  return debugLog.slice();
}

export function clearAudioDebugLog() {
  debugLog.length = 0;
  for (const cb of debugListeners) { try { cb(); } catch { /* noop */ } }
}

export function subscribeAudioDebug(cb: () => void): () => void {
  debugListeners.add(cb);
  return () => debugListeners.delete(cb);
}

export function audioDebugEnabled(): boolean {
  return isDebugEnabled();
}

/** Write a line to the audio debug log when ?audioDebug=1 is set. No-op
 *  in normal operation. Called from SentenceAudioControls and similar
 *  to surface what's happening alongside playBlob's own events. */
export function audioDebugPush(line: string): void {
  debugPush(line);
}

/** Imperative toggle for the floating audio debug overlay. Flipping
 *  this from a button bypasses the URL-flag friction on mobile. */
export function setAudioDebugEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) sessionStorage.setItem('mandao_audio_debug', '1');
  else sessionStorage.removeItem('mandao_audio_debug');
  for (const cb of debugListeners) { try { cb(); } catch { /* noop */ } }
}

/** Real 50ms silent-amplitude MP3 served from /public. iOS plays it
 *  successfully and the user hears nothing. */
const SILENT_MP3_URL = '/silent.mp3';

/**
 * Call from inside a user-gesture handler before any async work that
 * needs to be followed by audio.play(). The first call primes the
 * shared Audio element by playing a silent MP3 so iOS authorizes
 * subsequent plays. No-op once unlocked.
 */
export function unlockAudio(): void {
  if (audioUnlocked) return;
  const audio = getSharedAudio();
  audio.src = SILENT_MP3_URL;
  audio.play().then(() => {
    // Element is now user-authorized for the rest of the page.
    audioUnlocked = true;
    audio.pause();
  }).catch(() => {
    // Wasn't a real gesture, network blocked, or browser denied —
    // try again on next interaction.
  });
}

/** True after at least one successful unlock. Used by the diagnostic. */
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

/**
 * Play an audio blob. Returns a stop() function. Revokes the object URL
 * when playback ends or is stopped.
 *
 * Creates a fresh Audio element per call. Tried sharing one element
 * across plays to preserve iOS gesture authorization — turned out iOS
 * Safari poisons the element after the first play and rejects every
 * subsequent play() with NotSupportedError, no matter how aggressively
 * we reset src/load. The original async-vs-gesture problem that
 * motivated sharing is already solved by the eager blobMap in
 * SentenceAudioControls (no await between click and playBlob), so a
 * fresh element each time is both simpler and reliable.
 */
export function playBlob(blob: Blob, onEnded?: () => void): () => void {
  debugPush(`playBlob() called — blob ${blob.size}B ${blob.type}`);
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;

  // Hook every interesting event when debug is on.
  let trackedListeners: Array<{ type: string; fn: EventListener }> | null = null;
  if (audioDebugEnabled()) {
    trackedListeners = [];
    const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'pause', 'ended', 'error', 'stalled', 'suspend', 'abort', 'emptied'];
    for (const evt of events) {
      const fn = () => {
        let detail = '';
        if (evt === 'error') {
          const code = audio.error?.code;
          detail = ` (MediaError ${code})`;
        }
        if (evt === 'pause') {
          detail = ` (currentTime=${audio.currentTime.toFixed(2)}s)`;
        }
        debugPush(`event: ${evt}${detail}`);
      };
      audio.addEventListener(evt, fn);
      trackedListeners.push({ type: evt, fn });
    }
  }

  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    debugPush(`cleanup() — currentTime=${audio.currentTime.toFixed(2)}s readyState=${audio.readyState}`);
    if (trackedListeners) {
      for (const l of trackedListeners) audio.removeEventListener(l.type, l.fn);
    }
    URL.revokeObjectURL(url);
    onEnded?.();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  audio.play()
    .then(() => debugPush(`audio.play() resolved`))
    .catch((e: unknown) => {
      const err = e as { name?: string; message?: string };
      debugPush(`audio.play() rejected: ${err?.name ?? '?'} ${err?.message ?? ''}`);
      cleanup();
    });

  return () => {
    debugPush(`stop() called externally`);
    try { audio.pause(); } catch { /* noop */ }
    cleanup();
  };
}
