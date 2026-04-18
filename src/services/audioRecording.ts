/**
 * Audio recording service using MediaRecorder.
 *
 * Two modes:
 *   - startRecording(): capture raw audio only (used by Browse page).
 *   - recordChineseWithAudio(): capture audio AND run speech recognition
 *     in parallel, so we get a transcript plus a keepable audio clip
 *     from a single mic session (used by the voice button on Add Sentence).
 */
import {
  recognizeChinese,
  stopRecognition,
  startStreamingRecognition,
  CANCELLED_MESSAGE,
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
}

/**
 * Start recording audio from the microphone.
 * Returns a handle; call stop() to finalize and get the blob.
 */
export async function startRecording(): Promise<RecordingHandle> {
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

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  const cleanupStream = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  const stop = () =>
    new Promise<RecordingResult>((resolve, reject) => {
      if (cancelled) {
        reject(new Error('Recording cancelled'));
        return;
      }
      recorder.onstop = () => {
        cleanupStream();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        resolve({ blob, mimeType: type, durationMs: Date.now() - startedAt });
      };
      recorder.onerror = (e: any) => {
        cleanupStream();
        reject(e?.error || new Error('Recording failed'));
      };
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        // Already stopped somehow; produce whatever we have.
        const type = recorder.mimeType || mimeType || 'audio/webm';
        resolve({ blob: new Blob(chunks, { type }), mimeType: type, durationMs: Date.now() - startedAt });
      }
    });

  const cancel = () => {
    cancelled = true;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {}
    cleanupStream();
  };

  return { stop, cancel };
}

export interface VoiceWithAudioResult {
  transcript: string;
  audio: RecordingResult | null;
}

/**
 * Run MediaRecorder and SpeechRecognition in parallel so the user can,
 * from a single mic session, both get their speech transcribed and
 * optionally save the raw audio clip as a named recording.
 *
 * SpeechRecognition resolves when the API detects end-of-speech; we then
 * stop MediaRecorder to produce the blob. If recognition fails, audio is
 * still returned so the user can salvage the recording.
 */
export async function recognizeChineseWithAudio(): Promise<VoiceWithAudioResult> {
  // Start audio capture first so we don't miss the beginning of speech.
  let recHandle: RecordingHandle | null = null;
  if (isAudioRecordingSupported()) {
    try {
      recHandle = await startRecording();
    } catch {
      recHandle = null;
    }
  }

  try {
    const transcript = await recognizeChinese();
    const audio = recHandle ? await recHandle.stop().catch(() => null) : null;
    return { transcript, audio };
  } catch (err: any) {
    if (recHandle) {
      if (err?.message === CANCELLED_MESSAGE) {
        recHandle.cancel();
      } else {
        const audio = await recHandle.stop().catch(() => null);
        if (audio) return { transcript: '', audio };
      }
    }
    throw err;
  }
}

export function abortRecognizeWithAudio(): void {
  stopRecognition();
}

export interface StreamingWithAudioHandle {
  /** Stop streaming; resolves with final transcript + audio blob. */
  stop: () => Promise<VoiceWithAudioResult>;
  /** Abort and discard both transcript and audio. */
  cancel: () => void;
}

/**
 * Streaming counterpart to recognizeChineseWithAudio: MediaRecorder runs the
 * whole time and SpeechRecognition streams interim results until the caller
 * stops it. Used for the "hold-to-talk" voice button on Add Sentence.
 */
export async function startStreamingRecognitionWithAudio(
  opts: StreamingOptions = {}
): Promise<StreamingWithAudioHandle> {
  let recHandle: RecordingHandle | null = null;
  if (isAudioRecordingSupported()) {
    try {
      recHandle = await startRecording();
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
