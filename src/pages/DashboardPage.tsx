import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getDueBreakdown, type DueBreakdown } from '../services/srs';
import * as repo from '../db/repo';
import { TutorialBanner } from '../components/TutorialBanner';
import { useTutorialStore } from '../stores/tutorialStore';
import { useAuthStore } from '../stores/authStore';
import type { ReviewMode } from '../db/schema';

type ModeOption = ReviewMode | 'all';

const MODE_CYCLE: ModeOption[] = ['all', 'en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type', 'speak'];
const MODE_LABEL: Record<ModeOption, string> = {
  'all': 'All',
  'en-to-zh': 'EN→ZH',
  'zh-to-en': 'ZH→EN',
  'py-to-en-zh': 'PY→',
  'listen-type': 'Listen',
  'speak': 'Speak',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [breakdown, setBreakdown] = useState<DueBreakdown | null>(null);
  const [mode, setMode] = useState<ModeOption>('all');
  const [totalSentences, setTotalSentences] = useState(0);
  const [totalMeanings, setTotalMeanings] = useState(0);

  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const deckId = await repo.ensureDefaultDeck();
      setBreakdown(await getDueBreakdown(deckId));
      setTotalSentences(await repo.getSentencesCount());
      setTotalMeanings(await repo.getMeaningsCount());
    }
    load();
  }, [user]);

  const states = breakdown?.byModeAndState[mode] ?? { newCount: 0, learningCount: 0, reviewCount: 0 };
  const dueForMode = states.newCount + states.learningCount + states.reviewCount;
  const totalAll = breakdown
    ? breakdown.byMode['en-to-zh'] + breakdown.byMode['zh-to-en'] + breakdown.byMode['py-to-en-zh'] + (breakdown.byMode['listen-type'] ?? 0) + (breakdown.byMode['speak'] ?? 0)
    : 0;

  const reviewParam = mode === 'all' ? 'both' : mode;

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight mb-10">ManDao</h1>

      <TutorialBanner visibleAt={2}>
        Your 3 example sentences are in the deck. Click <strong>Browse</strong> below
        to see them and explore how the app breaks down each sentence.
      </TutorialBanner>

      <TutorialBanner visibleAt={6}>
        You've seen how Mandao works! Every sentence you add gets broken down
        into clickable characters and meanings, with tone sandhi tracked automatically.
        <div className="mt-2">
          Click <strong>+ Add Sentence</strong> to add your own, or <strong>Study</strong> to
          start reviewing the example sentences with spaced repetition.
        </div>
      </TutorialBanner>

      {/* Stats — subtle inline row */}
      <div className="flex gap-4 sm:gap-8 mb-10">
        {[
          { value: totalSentences, label: 'Sentences' },
          { value: totalMeanings, label: 'Meanings' },
          { value: totalAll, label: 'Due today' },
        ].map((s) => (
          <div key={s.label}>
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Default Deck */}
      <div className="mb-10">
        <div className="flex items-baseline justify-between mb-2">
          <div className="flex gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--state-new)' }}>{states.newCount} new</span>
            <span style={{ color: 'var(--state-learning)' }}>{states.learningCount} learning</span>
            <span style={{ color: 'var(--state-review)' }}>{states.reviewCount} review</span>
          </div>
        </div>
        <div className="flex gap-1 mb-3 flex-wrap">
          {MODE_CYCLE.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
              style={{
                background: mode === m ? 'var(--accent)' : 'var(--bg-inset)',
                color: mode === m ? '#fff' : 'var(--text-tertiary)',
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button
          onClick={() => navigate(`/review?mode=${reviewParam}`)}
          disabled={dueForMode === 0}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-30"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {dueForMode > 0 ? `Study (${dueForMode} cards)` : 'No cards due'}
        </button>
      </div>

      {/* Quick actions — ghost buttons */}
      <div className="grid grid-cols-3 sm:flex gap-2">
        {[
          { label: '+ Add', path: '/add', onClick: () => navigate('/add') },
          {
            label: 'Browse',
            path: '/browse',
            onClick: () => {
              if (tutorialStep === 2) advanceTutorial();
              navigate('/browse');
            },
            highlight: tutorialStep === 2,
          },
          { label: 'Graph', path: '/graph', onClick: () => navigate('/graph') },
          { label: 'Stats', path: '/stats', onClick: () => navigate('/stats') },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.onClick}
            className={`flex-1 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
              btn.highlight ? 'ring-1' : ''
            }`}
            style={{
              background: btn.highlight ? 'var(--accent-subtle)' : 'transparent',
              color: btn.highlight ? 'var(--accent)' : 'var(--text-secondary)',
              border: `1px solid ${btn.highlight ? 'var(--accent)' : 'var(--border-strong)'}`,
              ...(btn.highlight ? { '--tw-ring-color': 'var(--accent)' } as React.CSSProperties : {}),
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
