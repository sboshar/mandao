/**
 * Audio service using Web Speech API for TTS.
 * Prioritizes Google Translate voice for natural-sounding Mandarin.
 */

let voices: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const available = speechSynthesis.getVoices();
    if (available.length > 0) {
      resolve(available);
      return;
    }
    speechSynthesis.onvoiceschanged = () => {
      resolve(speechSynthesis.getVoices());
    };
  });
}

/** Get the best available Chinese voice, preferring Google's */
async function getChineseVoice(): Promise<SpeechSynthesisVoice | null> {
  if (voices.length === 0) {
    voices = await loadVoices();
  }

  const zhVoices = voices.filter(
    (v) => v.lang === 'zh-CN' || v.lang === 'zh_CN' || v.lang.startsWith('zh')
  );

  // Priority: Google voice > Apple premium > any zh-CN voice
  return (
    zhVoices.find((v) => v.name.toLowerCase().includes('google')) ||
    zhVoices.find((v) => v.name.toLowerCase().includes('tingting')) ||
    zhVoices.find((v) => v.name.toLowerCase().includes('lili')) ||
    zhVoices.find((v) => v.name.toLowerCase().includes('meijia')) ||
    zhVoices.find((v) => v.lang === 'zh-CN') ||
    zhVoices[0] ||
    null
  );
}

/** Speak Chinese text using Web Speech API */
export async function speakChinese(text: string): Promise<void> {
  const voice = await getChineseVoice();

  // Debug: run localStorage.setItem('tts_debug','1') in console or visit ?tts_debug
  if (new URLSearchParams(window.location.search).has('tts_debug')) {
    localStorage.setItem('tts_debug', '1');
  }
  if (localStorage.getItem('tts_debug')) {
    const zhNames = voices.filter(v => v.lang.startsWith('zh')).map(v => v.name).join(', ');
    alert(`Voice: ${voice?.name ?? 'none'}\nAll zh: ${zhNames}`);
  }
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    if (voice) utterance.voice = voice;

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e);

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}
