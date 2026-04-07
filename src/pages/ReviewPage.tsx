import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useReviewStore } from '../stores/reviewStore';
import { getReviewQueue } from '../services/srs';
import { getAllTags } from '../services/ingestion';
import { ReviewCard } from '../components/ReviewCard';
import { MeaningCard } from '../components/MeaningCard';
import type { ReviewMode } from '../db/schema';
import { ensureDefaultDeck } from '../db/repo';

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
  const [mode, setMode] = useState<ModeOption>('en-to-zh');
  const [started, setStarted] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<ModeOption | null>(null);

  useEffect(() => {
    getAllTags().then(setAllTags);
  }, []);

  const startReview = async (selectedMode: ModeOption) => {
    setLoading(true);
    setLoadingMode(selectedMode);
    try {
      const effectiveDeckId = deckId ?? (await ensureDefaultDeck());
      const queue = await getReviewQueue(
        effectiveDeckId,
        selectedMode,
        filterTags.length > 0 ? filterTags : null
      );
      setQueue(queue);
      setStarted(true);
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  useEffect(() => {
    return () => reset();
  }, []);

  if (!started) {
    return (
      <div className="p-4 sm:p-6 max-w-md mx-auto">
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
          {allTags.length > 0 && (
            <div className="mb-4">
              <button
                onClick={() => setShowFilter(!showFilter)}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={filterTags.length > 0
                  ? { background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }
                  : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                }
              >
                Filter by tag{filterTags.length > 0 ? ` (${filterTags.length})` : ''} {showFilter ? '\u25B2' : '\u25BC'}
              </button>
              {showFilter && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button
                    onClick={() => setFilterTags([])}
                    className="px-2.5 py-1 text-xs rounded-full transition-colors"
                    style={filterTags.length === 0
                      ? { background: 'var(--text-primary)', color: 'var(--bg-surface)' }
                      : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                    }
                  >
                    All sentences
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setFilterTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )}
                      className="px-2.5 py-1 text-xs rounded-full transition-colors"
                      style={filterTags.includes(tag)
                        ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                        : { background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))', color: 'var(--accent)' }
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Choose review mode:
          </p>

          {([
            { key: 'en-to-zh' as ModeOption, label: 'English \u2192 Chinese', desc: 'See English, produce characters + pinyin' },
            { key: 'zh-to-en' as ModeOption, label: 'Chinese \u2192 English', desc: 'See characters, produce English meaning' },
            { key: 'py-to-en-zh' as ModeOption, label: 'Pinyin \u2192 English + Chinese', desc: 'See pinyin (tone sandhi), produce meaning + characters' },
            { key: 'both' as ModeOption, label: 'All (mixed)', desc: 'Interleave all directions' },
          ]).map((opt) => {
            const isSelected = loadingMode === opt.key;
            const baseBgClass =
              isSelected ? '' : mode === opt.key ? 'bg-[var(--bg-inset)]' : 'bg-[var(--bg-surface)]';
            return (
              <button
                key={opt.key}
                onClick={() => { setMode(opt.key); startReview(opt.key); }}
                disabled={loading}
                className={`w-full p-3 sm:p-4 rounded-lg text-left transition-colors active:scale-[0.98] active:transition-transform ${baseBgClass} ${loading ? '' : 'surface-hover'}`}
                style={{
                  ...(isSelected
                    ? { background: `color-mix(in srgb, ${MODE_COLORS[opt.key]} 15%, var(--bg-inset))` }
                    : {}),
                  border: `2px solid ${isSelected ? MODE_COLORS[opt.key] : mode === opt.key ? MODE_COLORS[opt.key] : 'var(--border)'}`,
                  opacity: loading && !isSelected ? 0.5 : 1,
                }}
              >
                <div className="font-medium">{opt.label}{isSelected ? ' ...' : ''}</div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6 max-w-2xl mx-auto">
        <button
          onClick={() => {
            reset();
            setStarted(false);
            setLoading(false);
            setLoadingMode(null);
          }}
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
