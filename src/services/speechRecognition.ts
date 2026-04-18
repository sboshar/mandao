/**
 * Speech recognition service using Web Speech API.
 * Chrome-only. Captures spoken Mandarin and returns recognized text.
 */

// Chrome exposes SpeechRecognition under webkit prefix
const SpeechRecognitionClass =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export const CANCELLED_MESSAGE = 'Cancelled';

export function isSpeechRecognitionSupported(): boolean {
  return !!SpeechRecognitionClass;
}

let activeRecognition: any = null;

export interface StreamingHandle {
  /** Stop recognition and resolve with the final transcript. */
  stop: () => Promise<string>;
  /** Abort recognition without producing a final transcript. */
  cancel: () => void;
}

export interface StreamingOptions {
  /** Called with the current best-guess transcript as the user speaks. */
  onInterim?: (text: string) => void;
  /** Called each time a chunk is finalized (e.g. after a pause). */
  onFinalChunk?: (text: string) => void;
}

/**
 * Start a long-running recognition session that streams interim results
 * until the caller invokes stop(). Used for "speak a whole sentence"
 * flows where the user may pause between words.
 */
export function startStreamingRecognition(opts: StreamingOptions = {}): StreamingHandle {
  stopRecognition();

  if (!SpeechRecognitionClass) {
    throw new Error('Speech recognition not supported');
  }

  const recognition = new SpeechRecognitionClass();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalTranscript = '';
  let settled = false;
  let resolveStop: ((text: string) => void) | null = null;

  recognition.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript || '';
      if (result.isFinal) {
        finalTranscript += text;
        opts.onFinalChunk?.(text);
      } else {
        interim += text;
      }
    }
    opts.onInterim?.(finalTranscript + interim);
  };

  recognition.onerror = (event: any) => {
    // 'no-speech' fires frequently during pauses — ignore, recognition continues.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (settled) return;
    settled = true;
    activeRecognition = null;
    resolveStop?.(finalTranscript);
  };

  recognition.onend = () => {
    if (settled) return;
    settled = true;
    activeRecognition = null;
    resolveStop?.(finalTranscript);
  };

  activeRecognition = recognition;
  recognition.start();

  const stop = () =>
    new Promise<string>((resolve) => {
      if (settled) {
        resolve(finalTranscript);
        return;
      }
      resolveStop = resolve;
      try { recognition.stop(); } catch { resolve(finalTranscript); }
    });

  const cancel = () => {
    try { recognition.abort(); } catch {}
    settled = true;
    activeRecognition = null;
  };

  return { stop, cancel };
}

/**
 * Stop any active recognition session.
 */
export function stopRecognition(): void {
  if (activeRecognition) {
    try { activeRecognition.abort(); } catch {}
    activeRecognition = null;
  }
}

