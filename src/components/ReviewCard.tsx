import { useEffect, useState } from 'react';
import type { Sentence, SentenceToken, Meaning } from '../db/schema';
import { db } from '../db/db';
import { getTokensForSentence } from '../services/ingestion';
import { TokenSpan } from './TokenSpan';
import { PinyinDisplay } from './PinyinDisplay';
import { AudioButton } from './AudioButton';
import { useReviewStore } from '../stores/reviewStore';
import { ClickableEnglish } from './ClickableEnglish';
import { reviewCard, Rating } from '../services/srs';

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

export function ReviewCard() {
  const { currentCard, isFlipped, flip, next, remaining } = useReviewStore();
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);

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

    load();
    return () => { cancelled = true; };
  }, [card?.id]);

  if (!card || !sentence) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        {remaining() === 0
          ? 'No cards to review. Add some sentences first!'
          : 'Loading...'}
      </div>
    );
  }

  const isEnToZh = card.reviewMode === 'en-to-zh';
  const isPyToEnZh = card.reviewMode === 'py-to-en-zh';

  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    await reviewCard(card.id, rating as unknown as typeof Rating.Again);
    next();
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="text-sm text-gray-400 text-center mb-4">
        {remaining()} cards remaining
        <span className="ml-2 text-xs">
          ({card.reviewMode === 'en-to-zh' ? 'EN → ZH' : card.reviewMode === 'py-to-en-zh' ? 'PY → EN+ZH' : 'ZH → EN'})
        </span>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl shadow-lg p-8 min-h-[300px] flex flex-col">
        {/* Front */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {isEnToZh ? (
            // English → Chinese: show English on front
            <div className="text-xl text-center">
              <ClickableEnglish text={sentence.english} />
            </div>
          ) : isPyToEnZh ? (
            // Pinyin → English + Chinese: show pinyin on front
            <div className="text-center">
              <PinyinDisplay
                pinyin={sentence.pinyinSandhi}
                className="text-2xl"
              />
            </div>
          ) : (
            // Chinese → English: show characters on front
            <div className="text-3xl text-center tracking-wider">
              {sentence.chinese}
            </div>
          )}
        </div>

        {/* Flip / Answer */}
        {!isFlipped ? (
          <button
            onClick={flip}
            className="mt-6 w-full py-3 rounded-lg bg-blue-500 text-white font-medium
              hover:bg-blue-600 transition-colors"
          >
            Show Answer
          </button>
        ) : (
          <>
            {/* Back */}
            <div className="mt-6 pt-6 border-t space-y-4">
              {/* Characters with clickable tokens (EN→ZH and PY→EN+ZH) */}
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

              {/* English (for ZH→EN and PY→EN+ZH modes) */}
              {!isEnToZh && (
                <div className="text-xl text-center">
                  <ClickableEnglish text={sentence.english} />
                </div>
              )}

              {/* Pinyin sandhi with differences highlighted (skip for PY mode — already on front) */}
              {!isPyToEnZh && (
                <div className="text-center">
                  <PinyinDisplay
                    pinyin={sentence.pinyinSandhi}
                    basePinyin={sentence.pinyin}
                    className="text-base"
                  />
                </div>
              )}

              {/* Audio */}
              <div className="text-center">
                <AudioButton text={sentence.chinese} />
              </div>

              {/* Pinyin with clickable tokens (for ZH→EN mode) */}
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
              <button
                onClick={() => handleRate(1)}
                className="py-3 rounded-lg bg-red-100 text-red-700 hover:bg-red-200
                  font-medium transition-colors"
              >
                Again
              </button>
              <button
                onClick={() => handleRate(2)}
                className="py-3 rounded-lg bg-orange-100 text-orange-700 hover:bg-orange-200
                  font-medium transition-colors"
              >
                Hard
              </button>
              <button
                onClick={() => handleRate(3)}
                className="py-3 rounded-lg bg-green-100 text-green-700 hover:bg-green-200
                  font-medium transition-colors"
              >
                Good
              </button>
              <button
                onClick={() => handleRate(4)}
                className="py-3 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200
                  font-medium transition-colors"
              >
                Easy
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
