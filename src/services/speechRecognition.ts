/**
 * Speech recognition service using Web Speech API.
 * Chrome-only. Captures spoken Mandarin and returns recognized text.
 */

// Chrome exposes SpeechRecognition under webkit prefix
const SpeechRecognitionClass =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export function isSpeechRecognitionSupported(): boolean {
  return !!SpeechRecognitionClass;
}

let activeRecognition: any = null;
let cancelCallback: (() => void) | null = null;

/**
 * Stop any active recognition session.
 */
export function stopRecognition(): void {
  if (activeRecognition) {
    try { activeRecognition.abort(); } catch {}
    activeRecognition = null;
  }
  if (cancelCallback) {
    cancelCallback();
    cancelCallback = null;
  }
}

/**
 * Start listening for Chinese speech. Returns the recognized text.
 */
export function recognizeChinese(): Promise<string> {
  // Kill any previous session first
  stopRecognition();

  return new Promise((resolve, reject) => {
    cancelCallback = () => {
      reject(new Error('Cancelled'));
    };
    if (!SpeechRecognitionClass) {
      reject(new Error('Speech recognition not supported'));
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let settled = false;

    recognition.onresult = (event: any) => {
      if (settled) return;
      settled = true;
      activeRecognition = null;
      cancelCallback = null;
      const transcript = event.results[0]?.[0]?.transcript || '';
      resolve(transcript);
    };

    recognition.onerror = (event: any) => {
      if (settled) return;
      settled = true;
      activeRecognition = null;
      cancelCallback = null;
      if (event.error === 'aborted') {
        reject(new Error('Cancelled'));
        return;
      }
      reject(new Error(event.error || 'Recognition failed'));
    };

    recognition.onnomatch = () => {
      if (settled) return;
      settled = true;
      activeRecognition = null;
      cancelCallback = null;
      reject(new Error('No speech detected. Try again.'));
    };

    recognition.onend = () => {
      if (settled) return;
      settled = true;
      activeRecognition = null;
      cancelCallback = null;
      reject(new Error('Cancelled'));
    };

    activeRecognition = recognition;
    recognition.start();
  });
}
