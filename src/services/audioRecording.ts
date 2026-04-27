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

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  const cleanupStream = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  let capTimer: ReturnType<typeof setTimeout> | null = null;
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
  const clearCapTimer = () => {
    if (capTimer != null) {
      clearTimeout(capTimer);
      capTimer = null;
    }
  };

  const stop = () =>
    new Promise<RecordingResult>((resolve, reject) => {
      if (cancelled) {
        clearCapTimer();
        reject(new Error('Recording cancelled'));
        return;
      }
      recorder.onstop = () => {
        clearCapTimer();
        cleanupStream();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        resolve({ blob, mimeType: type, durationMs: Date.now() - startedAt });
      };
      recorder.onerror = (e: any) => {
        clearCapTimer();
        cleanupStream();
        reject(e?.error || new Error('Recording failed'));
      };
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        // Already stopped (e.g. duration cap fired); produce what we have.
        clearCapTimer();
        cleanupStream();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        resolve({ blob: new Blob(chunks, { type }), mimeType: type, durationMs: Date.now() - startedAt });
      }
    });

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
 * Play an audio blob. Returns a stop() function.
 * Revokes the object URL when playback ends or is stopped.
 */
export function playBlob(blob: Blob, onEnded?: () => void): () => void {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    URL.revokeObjectURL(url);
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
