import { useEffect, useState, useRef } from 'react';
import type { Sentence } from '../db/schema';
import * as repo from '../db/repo';
import { useReviewStore } from '../stores/reviewStore';
import { reviewCard, undoReview, type Grade } from '../services/srs';
import { AudioButton } from './AudioButton';
import { speakChinese } from '../services/audio';
import { comparePinyin, type SyllableResult } from '../lib/pinyinCompare';

export function ListenTypeCard() {
  const { currentCard, next, prev, remaining, undoInfo, clearUndo } = useReviewStore();
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [userInput, setUserInput] = useState('');
  const [results, setResults] = useState<SyllableResult[] | null>(null);
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoPlayed = useRef<string | null>(null);

  const card = currentCard();

  useEffect(() => {
    if (!card) return;
    let cancelled = false;

    async function load() {
      const s = await repo.getSentence(card!.sentenceId);
      if (cancelled || !s) return;
      setSentence(s);

      // Auto-play audio when a new card loads
      if (autoPlayed.current !== card!.id) {
        autoPlayed.current = card!.id;
        try {
          await speakChinese(s.chinese);
        } catch {
          // TTS may fail silently
        }
      }
    }

    setUserInput('');
    setResults(null);
    setRateError(null);
    load();

    return () => { cancelled = true; };
  }, [card?.id]);

  // Focus input when card loads and results are cleared
  useEffect(() => {
    if (!results && inputRef.current) {
      inputRef.current.focus();
    }
  }, [results, card?.id]);

  const handleUndo = async () => {
    if (!undoInfo || undoing || pendingRating !== null) return;
    setUndoing(true);
    try {
      await undoReview(undoInfo);
      prev();
    } catch {
      setRateError('Could not undo. Check your connection and try again.');
    } finally {
      setUndoing(false);
    }
  };

  if (!card || !sentence) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--text-tertiary)' }}>
        {remaining() === 0
          ? 'No cards to review. Add some sentences first!'
          : 'Loading...'}
        {remaining() === 0 && undoInfo && (
          <button
            onClick={handleUndo}
            disabled={undoing}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{
              background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
              color: 'var(--accent)',
            }}
          >
            {undoing ? 'Undoing...' : 'Undo last rating'}
          </button>
        )}
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || results) return;
    clearUndo();
    const comparison = comparePinyin(userInput, sentence.pinyinSandhi);
    setResults(comparison);
  };

  const handleRate = async (rating: Grade) => {
    setRateError(null);
    setPendingRating(rating);
    try {
      const undo = await reviewCard(card.id, rating);
      next(undo);
    } catch {
      setRateError('Could not save this review. Check your connection and try again.');
    } finally {
      setPendingRating(null);
    }
  };

  const allCorrect = results?.every((r) => r.correct) ?? false;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="text-sm text-center mb-4" style={{ color: 'var(--text-tertiary)' }}>
        {remaining()} cards remaining
        <span className="ml-2 text-xs">(Listen &amp; Type)</span>
      </div>

      {/* Card */}
      <div className="surface rounded-xl shadow-lg p-4 sm:p-8 min-h-[250px] sm:min-h-[300px] flex flex-col">
        {/* Audio prompt */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Listen and type the pinyin:
          </p>
          <AudioButton text={sentence.chinese} className="text-2xl" />
        </div>

        {/* Input form */}
        {!results && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Type pinyin here (e.g. ni3 hao3)"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full px-4 py-3 rounded-lg text-center text-lg outline-none transition-colors"
              style={{
                background: 'var(--bg-inset)',
                border: '2px solid var(--border)',
                color: 'var(--text-primary)',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--accent)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--border)';
              }}
            />
            <button
              type="submit"
              disabled={!userInput.trim()}
              className="w-full py-3 rounded-lg font-medium transition-all active:scale-[0.98] active:brightness-90 disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Check
            </button>
            {undoInfo && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoing || pendingRating !== null}
                className="w-full py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {undoing ? 'Undoing...' : 'Undo last card'}
              </button>
            )}
          </form>
        )}

        {/* Results */}
        {results && (
          <>
            <div className="mt-6 pt-6 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
              {/* Overall verdict */}
              <div className="text-center">
                {allCorrect ? (
                  <span className="text-lg font-semibold" style={{ color: 'var(--success)' }}>
                    Perfect!
                  </span>
                ) : (
                  <span className="text-lg font-semibold" style={{ color: 'var(--danger)' }}>
                    Not quite
                  </span>
                )}
              </div>

              {/* Syllable-by-syllable comparison */}
              <div className="space-y-2">
                {/* Your answer row */}
                <div className="text-center">
                  <span className="text-xs block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Your answer
                  </span>
                  <div className="flex flex-wrap justify-center gap-1">
                    {results.map((r, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 rounded text-lg font-mono"
                        style={{
                          background: r.correct
                            ? 'color-mix(in srgb, var(--success) 15%, var(--bg-surface))'
                            : r.baseMatch
                            ? 'color-mix(in srgb, var(--warning) 15%, var(--bg-surface))'
                            : 'color-mix(in srgb, var(--danger) 15%, var(--bg-surface))',
                          color: r.correct
                            ? 'var(--success)'
                            : r.baseMatch
                            ? 'var(--warning)'
                            : 'var(--danger)',
                        }}
                        title={
                          r.correct
                            ? 'Correct'
                            : r.baseMatch
                            ? 'Right syllable, wrong tone'
                            : 'Incorrect'
                        }
                      >
                        {r.typed || '\u00A0?\u00A0'}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Correct answer row */}
                <div className="text-center">
                  <span className="text-xs block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Correct
                  </span>
                  <div className="flex flex-wrap justify-center gap-1">
                    {results.map((r, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 rounded text-lg font-mono"
                        style={{
                          background: 'var(--bg-inset)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {r.expected || '\u00A0?\u00A0'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Show the Chinese characters + English */}
              <div className="text-center space-y-1 pt-2">
                <div className="text-2xl tracking-wider">{sentence.chinese}</div>
                <div className="text-base" style={{ color: 'var(--text-secondary)' }}>
                  {sentence.english}
                </div>
              </div>

              {/* Replay audio */}
              <div className="text-center">
                <AudioButton text={sentence.chinese} />
              </div>
            </div>

            {rateError && (
              <p className="mt-4 text-sm text-center" style={{ color: 'var(--danger)' }} role="alert">
                {rateError}
              </p>
            )}

            {/* Rating buttons */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { rating: 1 as const, label: 'Again', color: 'var(--rating-again)' },
                { rating: 2 as const, label: 'Hard', color: 'var(--rating-hard)' },
                { rating: 3 as const, label: 'Good', color: 'var(--rating-good)' },
                { rating: 4 as const, label: 'Easy', color: 'var(--rating-easy)' },
              ]).map((btn) => {
                const isSelected = pendingRating === btn.rating;
                const isDisabled = pendingRating !== null || undoing;
                return (
                  <button
                    key={btn.rating}
                    onClick={() => handleRate(btn.rating)}
                    disabled={isDisabled}
                    className="py-3 min-h-[44px] rounded-lg font-medium transition-all active:scale-[0.95]"
                    style={{
                      background: isSelected
                        ? `color-mix(in srgb, ${btn.color} 50%, var(--bg-surface))`
                        : `color-mix(in srgb, ${btn.color} 15%, var(--bg-surface))`,
                      color: isSelected ? 'var(--text-inverted)' : btn.color,
                      opacity: isDisabled && !isSelected ? 0.4 : 1,
                    }}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
