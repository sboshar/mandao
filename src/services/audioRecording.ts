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
 * iOS Safari grants playback permission per-element on the first .play()
 * within a user gesture, then allows subsequent plays on that element
 * even when triggered after async work (e.g., await fetchAudioBlob).
 * Creating a new Audio() per play would re-trigger the gesture check
 * every time, which silently fails on iOS once the user-gesture context
 * is lost across an `await`.
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

/** Smallest valid silent WAV (~60 bytes). WAV is the most universally
 *  decoded format on iOS — picky MP3 frame parsing is a known pitfall
 *  for unlock-style data URLs, so we avoid it. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=';

/**
 * Call from inside a user-gesture handler (any click / touchstart) to
 * unlock audio playback for the rest of the session. No-op after the
 * first successful unlock. Safe to call repeatedly.
 */
export function unlockAudio(): void {
  if (audioUnlocked) return;
  const audio = getSharedAudio();
  audio.muted = true;
  audio.src = SILENT_WAV;
  const p = audio.play();
  // Older browsers return undefined; newer ones return a promise.
  Promise.resolve(p)
    .then(() => {
      audio.pause();
      audio.muted = false;
      audio.removeAttribute('src');
      audio.load();
      audioUnlocked = true;
    })
    .catch(() => {
      audio.muted = false;
      // Wasn't a real gesture, or browser denied — try again next click.
    });
}

/** True after at least one successful unlock. Useful for diagnostics. */
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

/**
 * Play an audio blob. Returns a stop() function. Revokes the object URL
 * when playback ends or is stopped.
 */
export function playBlob(blob: Blob, onEnded?: () => void): () => void {
  const audio = getSharedAudio();
  // Stop whatever is playing on the shared element.
  try { audio.pause(); } catch {}
  if (pendingObjectUrl) {
    URL.revokeObjectURL(pendingObjectUrl);
    pendingObjectUrl = null;
  }

  const url = URL.createObjectURL(blob);
  pendingObjectUrl = url;
  audio.src = url;

  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (pendingObjectUrl === url) {
      URL.revokeObjectURL(url);
      pendingObjectUrl = null;
    }
    onEnded?.();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  audio.play().catch(cleanup);

  return () => {
    try { audio.pause(); } catch {}
    cleanup();
  };
}
