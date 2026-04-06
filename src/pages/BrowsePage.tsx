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
          className="px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
      </div>

      <TutorialBanner visibleAt={3}>
        Here are your sentences. Click on <strong>"她花了很多钱买花。"</strong> to expand it
        and see the word-by-word breakdown.
      </TutorialBanner>

      <TutorialBanner visibleAt={4}>
        Now <strong>click on one of the 花 characters</strong> to open the meaning explorer.
        You'll see that 花 has two separate meaning entries. You can also click on the
        <strong> shì</strong> pinyin to see all characters that share that sound.
      </TutorialBanner>

      {sentences.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>
          No sentences yet.{' '}
          <button
            onClick={() => navigate('/add')}
            style={{ color: 'var(--accent)' }}
            className="underline"
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
                className={`surface rounded-lg ${isTutorialTarget ? 'ring-2 ring-offset-2' : ''}`}
                style={isTutorialTarget ? { '--tw-ring-color': 'var(--accent)' } as React.CSSProperties : undefined}
              >
                <button
                  onClick={() => handleExpand(s.id)}
                  className="w-full text-left p-4 surface-hover transition-colors rounded-lg"
                >
                  <div className="text-lg">{s.chinese}</div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <ClickableEnglish text={s.english} />
                  </div>
                </button>

                {expandedId === s.id && (
                  <div className="px-4 pb-4 pt-0" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
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
                      className="mt-3 text-sm transition-colors"
                      style={{ color: 'var(--accent)' }}
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
