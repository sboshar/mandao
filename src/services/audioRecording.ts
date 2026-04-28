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

// ────────────────────────────────────────────────────────────
// Debug log infrastructure
// Off by default. Toggle via Settings → Audio Diagnostic. When on,
// playBlob emits HTMLMediaElement events into a ring buffer that the
// floating overlay (AudioDebugOverlay) renders live. Used to diagnose
// intermittent audio failures on mobile where DevTools is hard.
// ────────────────────────────────────────────────────────────

const DEBUG_RING_SIZE = 200;
const debugLog: string[] = [];
const debugListeners = new Set<() => void>();

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem('mandao_audio_debug') === '1';
}

function debugPush(line: string): void {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toLocaleTimeString().slice(-8) + '.' + String(Date.now() % 1000).padStart(3, '0');
  debugLog.push(`[${stamp}] ${line}`);
  if (debugLog.length > DEBUG_RING_SIZE) debugLog.shift();
  for (const cb of debugListeners) { try { cb(); } catch { /* noop */ } }
}

export function audioDebugEnabled(): boolean { return isDebugEnabled(); }
export function getAudioDebugLog(): string[] { return debugLog.slice(); }
export function clearAudioDebugLog(): void {
  debugLog.length = 0;
  for (const cb of debugListeners) { try { cb(); } catch { /* noop */ } }
}
export function subscribeAudioDebug(cb: () => void): () => void {
  debugListeners.add(cb);
  return () => debugListeners.delete(cb);
}
export function setAudioDebugEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) sessionStorage.setItem('mandao_audio_debug', '1');
  else sessionStorage.removeItem('mandao_audio_debug');
  for (const cb of debugListeners) { try { cb(); } catch { /* noop */ } }
}
/** Push a custom debug line — used by callers (e.g., SentenceAudioControls)
 *  to mark click events alongside playBlob's own event log. */
export function audioDebugPush(line: string): void { debugPush(line); }

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'ABORTED',
  2: 'NETWORK',
  3: 'DECODE',
  4: 'SRC_NOT_SUPPORTED',
};

/** Identify the actual file format from the first ~16 bytes. Catches
 *  cases where the cached blob has been truncated, corrupted, or stored
 *  with the wrong mime type. */
function sniffAudioFormat(b: Uint8Array): string {
  if (b.length < 4) return 'too-short';
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3 (ID3v2)';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const layer = (b[1] >> 1) & 0x03;
    return layer === 0 ? 'aac (ADTS)' : 'mp3 (MPEG audio)';
  }
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4/m4a (ftyp)';
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg (Vorbis/Opus/Speex)';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'wav (RIFF)';
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return 'flac';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm/matroska';
  return 'unknown';
}

/**
 * Play an audio blob. Returns a stop() function. Revokes the object URL
 * when playback ends or is stopped.
 */
export function playBlob(blob: Blob, onEnded?: () => void): () => void {
  const audio = getSharedAudio();
  debugPush(`playBlob() — blob ${blob.size}B ${blob.type || '(no type)'}`);
  if (audioDebugEnabled()) {
    blob.slice(0, 16).arrayBuffer().then((buf) => {
      const b = new Uint8Array(buf);
      const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
      debugPush(`bytes[0..16]: ${hex}; format: ${sniffAudioFormat(b)}`);
    }).catch((e) => debugPush(`byte sniff failed: ${(e as Error).message}`));
  }

  // Bring the element fully back to a clean state before assigning a
  // new source. iOS Safari rejects subsequent plays with
  // NotSupportedError when the element's prior src was set (and
  // especially after the previous URL was revoked) — the transition
  // from the old src to the new one trips an internal "source isn't
  // ready" check that surfaces as the play() promise rejecting. The
  // remove+load pair forces the element to discard the old source
  // synchronously so the new src is the only thing in flight.
  try { audio.pause(); } catch { /* noop */ }
  audio.removeAttribute('src');
  try { audio.load(); } catch { /* noop */ }

  if (pendingObjectUrl) {
    URL.revokeObjectURL(pendingObjectUrl);
    pendingObjectUrl = null;
  }

  const url = URL.createObjectURL(blob);
  pendingObjectUrl = url;
  audio.src = url;

  // Hook every interesting media event when debug is on.
  let trackedListeners: Array<{ type: string; fn: EventListener }> | null = null;
  if (audioDebugEnabled()) {
    trackedListeners = [];
    const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'pause', 'ended', 'error', 'stalled', 'suspend', 'abort', 'emptied'];
    for (const evt of events) {
      const fn = () => {
        let detail = '';
        if (evt === 'error') {
          const code = audio.error?.code;
          detail = ` (MediaError ${code} ${MEDIA_ERROR_NAMES[code as 1 | 2 | 3 | 4] ?? '?'})`;
        }
        if (evt === 'pause') detail = ` (currentTime=${audio.currentTime.toFixed(2)}s)`;
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
    if (pendingObjectUrl === url) {
      URL.revokeObjectURL(url);
      pendingObjectUrl = null;
    }
    onEnded?.();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  audio.play()
    .then(() => debugPush(`audio.play() resolved`))
    .catch((e: unknown) => {
      const err = e as { name?: string; message?: string };
      const mediaErr = audio.error
        ? `MediaError ${audio.error.code} (${MEDIA_ERROR_NAMES[audio.error.code] ?? '?'})`
        : 'no MediaError';
      debugPush(
        `audio.play() rejected: ${err?.name ?? '?'} ${err?.message ?? ''}; ${mediaErr}; networkState=${audio.networkState} readyState=${audio.readyState}`,
      );
      cleanup();
    });

  return () => {
    debugPush(`stop() called externally`);
    try { audio.pause(); } catch { /* noop */ }
    cleanup();
  };
}
