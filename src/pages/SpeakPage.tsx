import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as repo from '../db/repo';
import type { Sentence } from '../db/schema';
import { getAllTags } from '../services/ingestion';
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

  // Setup state
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [mode, setMode] = useState<'sentence' | 'free' | null>(null);

  // Practice state
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CharResult[] | null>(null);
  const [showPinyin, setShowPinyin] = useState(false);
  const [recognizedPinyin, setRecognizedPinyin] = useState<string | null>(null);
  const [expectedPinyin, setExpectedPinyin] = useState<string[]>([]);
  const [heardPinyin, setHeardPinyin] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    getAllTags().then(setAllTags);
  }, []);

  const lookupPinyinForChars = async (chars: string[]): Promise<string[]> => {
    const parts: string[] = [];
    for (const char of chars) {
      // Try app's meanings DB first
      const meanings = await repo.getMeaningsByHeadword(char);
      const meaning = meanings[0] ?? null;
      if (meaning) {
        parts.push(meaning.pinyin);
        continue;
      }
      // Fall back to CC-CEDICT dictionary
      const entries = lookup(char);
      if (entries.length > 0) {
        parts.push(numericStringToDiacritic(entries[0].pinyin));
        continue;
      }
      parts.push(char);
    }
    return parts;
  };

  const lookupPinyin = async (text: string) => {
    const chars = [...text.replace(/[\s，。！？、；：""''（）,.!?;:()"']/g, '')];
    const parts = await lookupPinyinForChars(chars);
    setRecognizedPinyin(parts.join(' '));
  };

  const supported = isSpeechRecognitionSupported();
  const started = mode !== null;
  const sentence = sentences[currentIndex] ?? null;
  const remaining = sentences.length - currentIndex;
  const done = mode === 'sentence' && started && currentIndex >= sentences.length;

  const startPractice = async () => {
    let sents: Sentence[];
    if (filterTags.length > 0) {
      const raw = await repo.getSentencesByTags(filterTags);
      const seen = new Set<string>();
      sents = raw.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    } else {
      sents = await repo.getAllSentences();
    }
    if (sents.length === 0) {
      setError('No sentences found. Add some first!');
      return;
    }
    setSentences(shuffle(sents));
    setCurrentIndex(0);
    setMode('sentence');
    resetResult();
  };

  const resetResult = () => {
    setRecognizedText(null);
    setRecognizedPinyin(null);
    setExpectedPinyin([]);
    setHeardPinyin([]);
    setComparison(null);
    setError('');
  };

  const streamHandleRef = useRef<StreamingHandle | null>(null);

  const finalizeText = async (text: string) => {
    setRecognizedText(text);
    lookupPinyin(text);
    if (mode === 'sentence' && sentence) {
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
    setShowPinyin(false);
  };

  const handleListen = async () => {
    if (!sentence || isPlaying) return;
    setIsPlaying(true);
    try {
      await speakChinese(sentence.chinese);
    } catch {}
    setIsPlaying(false);
  };

  // Unsupported browser
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

  // Setup screen
  if (!started) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="grid grid-cols-3 items-center mb-8">
          <button
            onClick={() => navigate('/')}
            className="justify-self-start px-3 py-1 rounded text-sm transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold text-center">Speak</h1>
          <div />
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setMode('free')}
            className="w-full p-4 rounded-lg text-left transition-colors"
            style={{ background: 'var(--bg-surface)', border: '2px solid var(--border)' }}
          >
            <div className="font-medium">Free Speak</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Say anything in Chinese and see what was recognized
            </div>
          </button>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ borderTop: '1px solid var(--border)' }} />
            </div>
            <div className="relative flex justify-center">
              <span className="px-2 text-xs" style={{ background: 'var(--bg-base)', color: 'var(--text-tertiary)' }}>or practice sentences</span>
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="mb-2">
              <button
                onClick={() => setShowFilter(!showFilter)}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={filterTags.length > 0
                  ? { background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }
                  : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                }
              >
                Filter by tag{filterTags.length > 0 ? ` (${filterTags.length})` : ''} {showFilter ? '\u25B2' : '\u25BC'}
              </button>
              {showFilter && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button
                    onClick={() => setFilterTags([])}
                    className="px-2.5 py-1 text-xs rounded-full transition-colors"
                    style={filterTags.length === 0
                      ? { background: 'var(--text-primary)', color: 'var(--bg-surface)' }
                      : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                    }
                  >
                    All sentences
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setFilterTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )}
                      className="px-2.5 py-1 text-xs rounded-full transition-colors"
                      style={filterTags.includes(tag)
                        ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                        : { background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))', color: 'var(--accent)' }
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded text-sm" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button
            onClick={startPractice}
            className="w-full py-3 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            Start Sentence Practice
          </button>
        </div>
      </div>
    );
  }

  // Free speak mode
  if (mode === 'free') {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="grid grid-cols-3 items-center mb-8">
          <button
            onClick={() => { setMode(null); resetResult(); }}
            className="justify-self-start px-3 py-1 rounded text-sm transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold text-center">Free Speak</h1>
          <div />
        </div>

        <p className="text-center text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          Say something in Chinese and check what was recognized.
        </p>

        {/* Recognized result */}
        {recognizedText !== null && (
          <div className="text-center mb-6 p-4 rounded-lg" style={{ background: 'var(--bg-inset)' }}>
            <div className="text-3xl tracking-wider mb-2">{recognizedText || '(nothing heard)'}</div>
            {recognizedPinyin && (
              <div className="text-lg" style={{ color: 'var(--text-secondary)' }}>{recognizedPinyin}</div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded text-sm text-center" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
            {error}
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
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>

        {recognizedText !== null && (
          <div className="flex gap-2 justify-center">
            <button
              onClick={resetResult}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    );
  }

  // Done screen
  if (done) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Practice Complete</h1>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          You practiced {sentences.length} sentence{sentences.length !== 1 ? 's' : ''}.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => { setMode(null); resetResult(); setCurrentIndex(0); }}
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

  // Practice screen
  const pct = comparison ? matchPercent(comparison) : null;
  const passed = pct !== null && pct >= 80;

  return (
    <div className="max-w-md mx-auto p-6">
      {/* Header */}
      <div className="grid grid-cols-3 items-center mb-8">
        <button
          onClick={() => { setMode(null); resetResult(); setCurrentIndex(0); }}
          className="justify-self-start px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-center">Speak</h1>
        <div className="justify-self-end text-sm" style={{ color: 'var(--text-tertiary)' }}>{remaining} left</div>
      </div>

      {/* Sentence */}
      {sentence && (
        <div className="text-center mb-8">
          {!comparison ? (
            <>
              <div className="text-3xl tracking-wider mb-3">{sentence.chinese}</div>
              {showPinyin && (
                <div className="mb-2">
                  <PinyinDisplay
                    pinyin={sentence.pinyinSandhi}
                    basePinyin={sentence.pinyin}
                    className="text-base"
                  />
                </div>
              )}
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
                      {/* Expected pinyin */}
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {expectedPinyin[i] || ''}
                      </div>
                      {/* Expected char */}
                      <div className="text-2xl" style={{ color }}>{r.char}</div>
                      {/* Divider */}
                      {(isMismatch || isMissing) && (
                        <>
                          <div className="w-full" style={{ borderTop: '1px solid var(--border)' }} />
                          {/* Heard char */}
                          <div className="text-2xl" style={{ color: 'var(--danger)', opacity: isMissing ? 0.3 : 1 }}>
                            {r.heard || '\u2013'}
                          </div>
                          {/* Heard pinyin */}
                          <div className="text-xs" style={{ color: 'var(--danger)', opacity: 0.7 }}>
                            {isMissing ? '' : heardPinyin[i] || ''}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Score */}
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
            </>
          )}

          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {sentence.english}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded text-sm text-center" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
          {error}
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
        <button
          onClick={() => setShowPinyin(!showPinyin)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          {showPinyin ? 'Hide Pinyin' : 'Show Pinyin'}
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
