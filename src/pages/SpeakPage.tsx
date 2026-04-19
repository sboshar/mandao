import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as repo from '../db/repo';
import type { Sentence } from '../db/schema';
import { speakChinese } from '../services/audio';
import {
  isSpeechRecognitionSupported,
  startStreamingRecognition,
  type StreamingHandle,
} from '../services/speechRecognition';
import {
  compareCharacters,
  matchPercent,
  type CharResult,
} from '../lib/charCompare';
import { PinyinDisplay } from '../components/PinyinDisplay';
import { lookup } from '../lib/cedict';
import { numericStringToDiacritic } from '../services/toneSandhi';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function SpeakPage() {
  const navigate = useNavigate();

  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CharResult[] | null>(null);
  const [expectedPinyin, setExpectedPinyin] = useState<string[]>([]);
  const [heardPinyin, setHeardPinyin] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  const supported = isSpeechRecognitionSupported();

  useEffect(() => {
    if (!supported) return;
    repo.getAllSentences().then((sents) => {
      setSentences(sents.length > 0 ? shuffle(sents) : []);
    });
  }, [supported]);

  const lookupPinyinForChars = async (chars: string[]): Promise<string[]> => {
    const parts: string[] = [];
    for (const char of chars) {
      const meanings = await repo.getMeaningsByHeadword(char);
      const meaning = meanings[0] ?? null;
      if (meaning) {
        parts.push(meaning.pinyin);
        continue;
      }
      const entries = lookup(char);
      if (entries.length > 0) {
        parts.push(numericStringToDiacritic(entries[0].pinyin));
        continue;
      }
      parts.push(char);
    }
    return parts;
  };

  const sentence = sentences?.[currentIndex] ?? null;
  const remaining = sentences ? sentences.length - currentIndex : 0;
  const done = sentences !== null && sentences.length > 0 && currentIndex >= sentences.length;
  const empty = sentences !== null && sentences.length === 0;

  const resetResult = () => {
    setRecognizedText(null);
    setExpectedPinyin([]);
    setHeardPinyin([]);
    setComparison(null);
    setError('');
  };

  const streamHandleRef = useRef<StreamingHandle | null>(null);

  const finalizeText = async (text: string) => {
    setRecognizedText(text);
    if (sentence) {
      const comp = compareCharacters(sentence.chinese, text);
      setComparison(comp);
      const expChars = comp.map((r) => r.char);
      const heardChars = comp.map((r) => r.heard || '');
      const [ep, hp] = await Promise.all([
        lookupPinyinForChars(expChars),
        lookupPinyinForChars(heardChars),
      ]);
      setExpectedPinyin(ep);
      setHeardPinyin(hp);
    }
  };

  const handleMic = async () => {
    if (isListening) {
      const handle = streamHandleRef.current;
      streamHandleRef.current = null;
      setIsListening(false);
      if (handle) {
        try {
          const text = await handle.stop();
          await finalizeText(text);
        } catch (e: any) {
          if (e?.message !== 'Cancelled') {
            setError(e?.message || 'Recognition failed');
          }
        }
      }
      return;
    }

    resetResult();
    try {
      const handle = startStreamingRecognition({
        onInterim: (text) => setRecognizedText(text),
      });
      streamHandleRef.current = handle;
      setIsListening(true);
    } catch (e: any) {
      setError(e?.message || 'Recognition failed');
    }
  };

  const handleNext = () => {
    setCurrentIndex((i) => i + 1);
    resetResult();
  };

  const handleListen = async () => {
    if (!sentence || isPlaying) return;
    setIsPlaying(true);
    try {
      await speakChinese(sentence.chinese);
    } catch {}
    setIsPlaying(false);
  };

  if (!supported) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <h1 className="text-xl font-bold mb-4">Speaking Practice</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Speech recognition requires Chrome. Please open this app in Chrome to use speaking practice.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 px-4 py-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <h1 className="text-xl font-bold mb-2">Speak</h1>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          No sentences found. Add some first!
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Practice Complete</h1>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          You practiced {sentences!.length} sentence{sentences!.length !== 1 ? 's' : ''}.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => {
              if (!sentences) return;
              setSentences(shuffle(sentences));
              setCurrentIndex(0);
              resetResult();
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            Practice Again
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!sentence) {
    return (
      <div className="max-w-md mx-auto p-6 text-center" style={{ color: 'var(--text-tertiary)' }}>
        Loading...
      </div>
    );
  }

  const pct = comparison ? matchPercent(comparison) : null;
  const passed = pct !== null && pct >= 80;

  return (
    <div className="max-w-md mx-auto p-6">
      {/* Header */}
      <div className="grid grid-cols-3 items-center mb-8">
        <button
          onClick={() => navigate('/')}
          className="justify-self-start px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-center">Speak</h1>
        <div className="justify-self-end text-sm" style={{ color: 'var(--text-tertiary)' }}>{remaining} left</div>
      </div>

      {/* Sentence */}
      <div className="text-center mb-8">
        {!comparison ? (
          <>
            <div className="text-3xl tracking-wider mb-3">{sentence.chinese}</div>
            <div className="mb-2">
              <PinyinDisplay
                pinyin={sentence.pinyinSandhi}
                basePinyin={sentence.pinyin}
                className="text-base"
              />
            </div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {sentence.english}
            </div>
          </>
        ) : (
          <>
            {/* Per-character comparison grid */}
            <div className="flex flex-wrap justify-center gap-1 mb-4">
              {comparison.map((r, i) => {
                const color = r.status === 'match' ? 'var(--success)' : 'var(--danger)';
                const isMismatch = r.status === 'mismatch';
                const isMissing = r.status === 'missing';
                return (
                  <div key={i} className="flex flex-col items-center gap-0.5 min-w-[2.5rem]">
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {expectedPinyin[i] || ''}
                    </div>
                    <div className="text-2xl" style={{ color }}>{r.char}</div>
                    {(isMismatch || isMissing) && (
                      <>
                        <div className="w-full" style={{ borderTop: '1px solid var(--border)' }} />
                        <div className="text-2xl" style={{ color: 'var(--danger)', opacity: isMissing ? 0.3 : 1 }}>
                          {r.heard || '\u2013'}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--danger)', opacity: 0.7 }}>
                          {isMissing ? '' : heardPinyin[i] || ''}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {pct !== null && (
              <div className="mb-2">
                <span
                  className="inline-block px-3 py-1 rounded-full text-sm font-medium"
                  style={{
                    background: passed
                      ? 'color-mix(in srgb, var(--success) 15%, var(--bg-surface))'
                      : 'color-mix(in srgb, var(--danger) 15%, var(--bg-surface))',
                    color: passed ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {pct}% match
                </span>
              </div>
            )}

            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {sentence.english}
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded text-sm text-center" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Recognized text (interim) */}
      {recognizedText !== null && !comparison && (
        <div className="text-center mb-4 text-lg" style={{ color: 'var(--text-secondary)' }}>
          {recognizedText || '...'}
        </div>
      )}

      {/* Mic button */}
      <div className="flex justify-center mb-6">
        <button
          onClick={handleMic}
          className="w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{
            background: 'transparent',
            border: 'none',
            color: isListening ? 'var(--danger)' : 'var(--text-secondary)',
            animation: isListening ? 'pulse 1.5s ease-in-out infinite' : 'none',
            cursor: 'pointer',
          }}
          title={isListening ? 'Stop' : 'Start speaking'}
        >
          {isListening ? (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          )}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-center flex-wrap">
        <button
          onClick={handleListen}
          disabled={isPlaying}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          {isPlaying ? 'Playing...' : 'Listen'}
        </button>
        {comparison && (
          <>
            <button
              onClick={resetResult}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
            >
              Retry
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}
