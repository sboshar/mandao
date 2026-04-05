import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../db/db';
import type { Sentence } from '../db/schema';
import { getTokensForSentence } from '../services/ingestion';
import { TokenSpan } from '../components/TokenSpan';
import { PinyinDisplay } from '../components/PinyinDisplay';
import { MeaningCard } from '../components/MeaningCard';
import { ClickableEnglish } from '../components/ClickableEnglish';
import { useNavigationStore } from '../stores/navigationStore';
import type { SentenceToken, Meaning } from '../db/schema';

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

export function BrowsePage() {
  const navigate = useNavigate();
  const { open } = useNavigationStore();
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);

  useEffect(() => {
    db.sentences.orderBy('createdAt').reverse().toArray().then(setSentences);
  }, []);

  const handleExpand = async (sentenceId: string) => {
    if (expandedId === sentenceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sentenceId);
    const t = await getTokensForSentence(sentenceId);
    setTokens(t);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Browse Sentences</h1>
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
        >
          &larr; Back
        </button>
      </div>

      {sentences.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          No sentences yet.{' '}
          <button
            onClick={() => navigate('/add')}
            className="text-blue-500 underline"
          >
            Add one
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sentences.map((s) => (
            <div key={s.id} className="bg-white rounded-lg shadow">
              <button
                onClick={() => handleExpand(s.id)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="text-lg">{s.chinese}</div>
                <div className="text-sm text-gray-500">
                  <ClickableEnglish text={s.english} />
                </div>
              </button>

              {expandedId === s.id && (
                <div className="px-4 pb-4 pt-0 border-t">
                  <div className="text-sm text-gray-500 mb-2">
                    <PinyinDisplay
                      pinyin={s.pinyinSandhi}
                      basePinyin={s.pinyin}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
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
                  <button
                    onClick={() => open({ type: 'sentence', id: s.id })}
                    className="mt-3 text-sm text-blue-500 hover:text-blue-700 transition-colors"
                  >
                    View sentence card &rarr;
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <MeaningCard />
    </div>
  );
}
