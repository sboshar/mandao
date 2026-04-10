import { useEffect, useState } from 'react';
import type { Sentence, SentenceToken, Meaning } from '../db/schema';
import * as repo from '../db/repo';
import { getTokensForSentence, updateSentenceTags } from '../services/ingestion';
import { TokenSpan } from './TokenSpan';
import { PinyinDisplay } from './PinyinDisplay';
import { AudioButton } from './AudioButton';
import { TagInput } from './TagInput';
import { useReviewStore } from '../stores/reviewStore';
import { ClickableEnglish } from './ClickableEnglish';
import { reviewCard, commitReview, undoReview, type Grade } from '../services/srs';

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

export function ReviewCard() {
  const { currentCard, isFlipped, flip, next, prev, remaining, undoInfo, clearUndo } = useReviewStore();
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);
  const [editingTags, setEditingTags] = useState(false);
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  const card = currentCard();

  useEffect(() => {
    if (!card) return;
    let cancelled = false;

    async function load() {
      const s = await repo.getSentence(card!.sentenceId);
      if (cancelled || !s) return;
      setSentence(s);
      const t = await getTokensForSentence(s.id);
      if (!cancelled) setTokens(t);
    }

    setEditingTags(false);
    setRateError(null);
    load();
    return () => { cancelled = true; };
  }, [card?.id]);

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

  const isEnToZh = card.reviewMode === 'en-to-zh';
  const isPyToEnZh = card.reviewMode === 'py-to-en-zh';

  const handleFlip = () => {
    if (undoInfo) commitReview(undoInfo).catch(console.error);
    clearUndo();
    flip();
  };

  const handleTagsChange = async (newTags: string[]) => {
    await updateSentenceTags(sentence!.id, newTags);
    setSentence((prev) => prev ? { ...prev, tags: newTags } : prev);
  };

  const handleRate = async (rating: Grade) => {
    setRateError(null);
    setPendingRating(rating);
    try {
      const [, undo] = await Promise.all([
        undoInfo ? commitReview(undoInfo) : undefined,
        reviewCard(card.id, rating),
      ]);
      next(undo);
    } catch {
      setRateError('Could not save this review. Check your connection and try again.');
    } finally {
      setPendingRating(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="text-sm text-center mb-4" style={{ color: 'var(--text-tertiary)' }}>
        {remaining()} cards remaining
        <span className="ml-2 text-xs">
          ({card.reviewMode === 'en-to-zh' ? 'EN \u2192 ZH' : card.reviewMode === 'py-to-en-zh' ? 'PY \u2192 EN+ZH' : 'ZH \u2192 EN'})
        </span>
      </div>

      {/* Card */}
      <div className="surface rounded-xl shadow-lg p-4 sm:p-8 min-h-[250px] sm:min-h-[300px] flex flex-col">
        {/* Front */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {isEnToZh ? (
            <div className="text-xl text-center">
              <ClickableEnglish text={sentence.english} />
            </div>
          ) : isPyToEnZh ? (
            <div className="text-center">
              <PinyinDisplay pinyin={sentence.pinyinSandhi} className="text-2xl" />
            </div>
          ) : (
            <div className="text-3xl text-center tracking-wider">
              {sentence.chinese}
            </div>
          )}
        </div>

        {/* Flip / Answer */}
        {!isFlipped ? (
          <div className="mt-6 space-y-2">
            <button
              onClick={handleFlip}
              className="w-full py-3 rounded-lg font-medium transition-all active:scale-[0.98] active:brightness-90"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Show Answer
            </button>
            {undoInfo && (
              <button
                onClick={handleUndo}
                disabled={undoing || pendingRating !== null}
                className="w-full py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {undoing ? 'Undoing...' : 'Undo last card'}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mt-6 pt-6 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
              {(isEnToZh || isPyToEnZh) && (
                <div className="flex flex-wrap justify-center gap-1">
                  {tokens.map((t) => (
                    <TokenSpan
                      key={t.id}
                      meaningId={t.meaningId}
                      surfaceForm={t.surfaceForm}
                      pinyin={t.meaning.pinyin}
                      pinyinNumeric={t.meaning.pinyinNumeric}

                      showPinyin={!isPyToEnZh}
                    />
                  ))}
                </div>
              )}

              {!isEnToZh && (
                <div className="text-xl text-center">
                  <ClickableEnglish text={sentence.english} />
                </div>
              )}

              {!isPyToEnZh && (
                <div className="text-center">
                  <PinyinDisplay
                    pinyin={sentence.pinyinSandhi}
                    basePinyin={sentence.pinyin}
                    className="text-base"
                  />
                </div>
              )}

              <div className="text-center">
                <AudioButton text={sentence.chinese} />
              </div>

              {/* Tags */}
              <div className="flex items-center justify-center gap-1 flex-wrap">
                {sentence.tags && sentence.tags.length > 0 && !editingTags && (
                  <>
                    {sentence.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 text-xs rounded-full"
                        style={{ background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }}>
                        {tag}
                      </span>
                    ))}
                  </>
                )}
                {!editingTags ? (
                  <button
                    onClick={() => setEditingTags(true)}
                    className="text-xs transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {sentence.tags && sentence.tags.length > 0 ? 'edit' : '+ tag'}
                  </button>
                ) : (
                  <div className="w-full max-w-xs">
                    <TagInput
                      tags={sentence.tags || []}
                      onChange={handleTagsChange}
                      compact
                    />
                  </div>
                )}
              </div>

              {!isEnToZh && !isPyToEnZh && (
                <div className="flex flex-wrap justify-center gap-1">
                  {tokens.map((t) => (
                    <TokenSpan
                      key={t.id}
                      meaningId={t.meaningId}
                      surfaceForm={t.surfaceForm}
                      pinyin={t.meaning.pinyin}
                      pinyinNumeric={t.meaning.pinyinNumeric}

                      showPinyin
                    />
                  ))}
                </div>
              )}
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
