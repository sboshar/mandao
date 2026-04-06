import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useReviewStore } from '../stores/reviewStore';
import { getReviewQueue } from '../services/srs';
import { ReviewCard } from '../components/ReviewCard';
import { MeaningCard } from '../components/MeaningCard';
import { DEFAULT_DECK_ID } from '../db/schema';
import type { ReviewMode } from '../db/schema';

type ModeOption = ReviewMode | 'both';

const MODE_COLORS: Record<ModeOption, string> = {
  'en-to-zh': 'var(--accent)',
  'zh-to-en': 'var(--success)',
  'py-to-en-zh': 'var(--warning)',
  'both': '#8b5cf6',
};

export function ReviewPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { setQueue, remaining, reset } = useReviewStore();
  const effectiveDeckId = deckId || DEFAULT_DECK_ID;
  const [mode, setMode] = useState<ModeOption>('en-to-zh');
  const [started, setStarted] = useState(false);

  const startReview = async (selectedMode: ModeOption) => {
    const queue = await getReviewQueue(effectiveDeckId, selectedMode);
    setQueue(queue);
    setStarted(true);
  };

  useEffect(() => {
    return () => reset();
  }, []);

  if (!started) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1 rounded text-sm surface-hover transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold">Review</h1>
          <div />
        </div>

        <div className="space-y-3">
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Choose review mode:
          </p>

          {([
            { key: 'en-to-zh' as ModeOption, label: 'English \u2192 Chinese', desc: 'See English, produce characters + pinyin' },
            { key: 'zh-to-en' as ModeOption, label: 'Chinese \u2192 English', desc: 'See characters, produce English meaning' },
            { key: 'py-to-en-zh' as ModeOption, label: 'Pinyin \u2192 English + Chinese', desc: 'See pinyin (tone sandhi), produce meaning + characters' },
            { key: 'both' as ModeOption, label: 'All (mixed)', desc: 'Interleave all directions' },
          ]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => { setMode(opt.key); startReview(opt.key); }}
              className="w-full p-4 rounded-lg text-left transition-colors"
              style={{
                background: mode === opt.key ? 'var(--bg-inset)' : 'var(--bg-surface)',
                border: `2px solid ${mode === opt.key ? MODE_COLORS[opt.key] : 'var(--border)'}`,
              }}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 max-w-2xl mx-auto">
        <button
          onClick={() => { reset(); setStarted(false); }}
          className="px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold">Review</h1>
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{remaining()} left</div>
      </div>

      <ReviewCard />
      <MeaningCard />
    </div>
  );
}
