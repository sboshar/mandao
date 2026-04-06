import { useEffect, useState } from 'react';
import type { Sentence, SentenceToken, Meaning } from '../db/schema';
import { db } from '../db/db';
import { getTokensForSentence, updateSentenceTags } from '../services/ingestion';
import { TokenSpan } from './TokenSpan';
import { PinyinDisplay } from './PinyinDisplay';
import { AudioButton } from './AudioButton';
import { TagInput } from './TagInput';
import { useReviewStore } from '../stores/reviewStore';
import { ClickableEnglish } from './ClickableEnglish';
import { reviewCard, Rating } from '../services/srs';

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

export function ReviewCard() {
  const { currentCard, isFlipped, flip, next, remaining } = useReviewStore();
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);
  const [editingTags, setEditingTags] = useState(false);

  const card = currentCard();

  useEffect(() => {
    if (!card) return;
    let cancelled = false;

    async function load() {
      const s = await db.sentences.get(card!.sentenceId);
      if (cancelled || !s) return;
      setSentence(s);
      const t = await getTokensForSentence(s.id);
      if (!cancelled) setTokens(t);
    }

    setEditingTags(false);
    load();
    return () => { cancelled = true; };
  }, [card?.id]);

  if (!card || !sentence) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
        {remaining() === 0
          ? 'No cards to review. Add some sentences first!'
          : 'Loading...'}
      </div>
    );
  }

  const isEnToZh = card.reviewMode === 'en-to-zh';
  const isPyToEnZh = card.reviewMode === 'py-to-en-zh';

  const handleTagsChange = async (newTags: string[]) => {
    await updateSentenceTags(sentence!.id, newTags);
    setSentence((prev) => prev ? { ...prev, tags: newTags } : prev);
  };

  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    await reviewCard(card.id, rating as unknown as typeof Rating.Again);
    next();
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
      <div className="surface rounded-xl shadow-lg p-8 min-h-[300px] flex flex-col">
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
          <button
            onClick={flip}
            className="mt-6 w-full py-3 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            Show Answer
          </button>
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

            {/* Rating buttons */}
            <div className="mt-6 grid grid-cols-4 gap-2">
              {([
                { rating: 1 as const, label: 'Again', color: 'var(--rating-again)' },
                { rating: 2 as const, label: 'Hard', color: 'var(--rating-hard)' },
                { rating: 3 as const, label: 'Good', color: 'var(--rating-good)' },
                { rating: 4 as const, label: 'Easy', color: 'var(--rating-easy)' },
              ]).map((btn) => (
                <button
                  key={btn.rating}
                  onClick={() => handleRate(btn.rating)}
                  className="py-3 rounded-lg font-medium transition-colors"
                  style={{
                    background: `color-mix(in srgb, ${btn.color} 15%, var(--bg-surface))`,
                    color: btn.color,
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
