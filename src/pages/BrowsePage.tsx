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
import { useTutorialStore } from '../stores/tutorialStore';
import { TutorialBanner } from '../components/TutorialBanner';
import type { SentenceToken, Meaning } from '../db/schema';

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

export function BrowsePage() {
  const navigate = useNavigate();
  const { open } = useNavigationStore();
  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);

  useEffect(() => {
    db.sentences.orderBy('createdAt').reverse().toArray().then(setSentences);
  }, []);

  // Find the 花 sentence for tutorial highlighting
  const huaSentence = sentences.find((s) => s.chinese === '她花了很多钱买花。');

  const handleExpand = async (sentenceId: string) => {
    if (expandedId === sentenceId) {
      setExpandedId(null);
      return;
    }
    if (tutorialStep === 3) advanceTutorial();
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

      <TutorialBanner visibleAt={3}>
        Here are your sentences. Click on <strong>"她花了很多钱买花。"</strong> to expand it
        and see the word-by-word breakdown. This is the sentence where 花 has two different
        meanings!
      </TutorialBanner>

      <TutorialBanner visibleAt={4}>
        Now <strong>click on one of the 花 characters</strong> (the large Chinese text) to
        open the meaning explorer. You'll see that 花 has two separate meaning entries &mdash;
        "to spend" and "flower." You can also click on the <strong>shì</strong> pinyin to see
        all characters that share that sound.
      </TutorialBanner>

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
          {sentences.map((s) => {
            const isTutorialTarget = tutorialStep === 3 && huaSentence && s.id === huaSentence.id;

            return (
              <div
                key={s.id}
                className={`bg-white rounded-lg shadow ${
                  isTutorialTarget ? 'ring-2 ring-blue-300 ring-offset-2' : ''
                }`}
              >
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
            );
          })}
        </div>
      )}

      <MeaningCard />
    </div>
  );
}
