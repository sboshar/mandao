import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getDueCounts } from '../services/srs';
import * as repo from '../db/repo';
import { TutorialBanner } from '../components/TutorialBanner';
import { useTutorialStore } from '../stores/tutorialStore';
import { useAuthStore } from '../stores/authStore';


export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [counts, setCounts] = useState({
    newCount: 0,
    reviewCount: 0,
    learningCount: 0,
  });
  const [totalSentences, setTotalSentences] = useState(0);
  const [totalMeanings, setTotalMeanings] = useState(0);

  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const deckId = await repo.ensureDefaultDeck();
      const c = await getDueCounts(deckId);
      setCounts(c);
      setTotalSentences(await repo.getSentencesCount());
      setTotalMeanings(await repo.getMeaningsCount());
    }
    load();
  }, [user]);

  const totalDue = counts.newCount + counts.reviewCount + counts.learningCount;

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
          { value: totalDue, label: 'Due today' },
        ].map((s) => (
          <div key={s.label}>
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Default Deck */}
      <div className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Default Deck</h2>
          <div className="flex gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--state-new)' }}>{counts.newCount} new</span>
            <span style={{ color: 'var(--state-learning)' }}>{counts.learningCount} learning</span>
            <span style={{ color: 'var(--state-review)' }}>{counts.reviewCount} review</span>
          </div>
        </div>
        <button
          onClick={() => navigate('/review')}
          disabled={totalDue === 0}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {totalDue > 0 ? `Study (${totalDue} cards)` : 'No cards due'}
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
        <div className="relative">
          <button
            onClick={() => navigate('/speak')}
            className="w-full py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-strong)',
            }}
          >
            Speak
          </button>
          <span className="absolute -top-3 -right-3 cursor-default group/beta" style={{ fontSize: '1.5rem', lineHeight: 1 }}>
            ✦
            <span
              className="hidden group-hover/beta:block absolute bottom-full right-0 mb-1 px-2 py-1 rounded text-xs whitespace-nowrap z-10"
              style={{ background: 'var(--text-primary)', color: 'var(--bg-surface)' }}
            >
              This feature is in beta
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
