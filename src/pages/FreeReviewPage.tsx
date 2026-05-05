import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useReviewStore } from '../stores/reviewStore';
import { getFreeReviewQueue } from '../services/srs';
import { getAllTags } from '../services/ingestion';
import * as repo from '../db/repo';
import { ReviewCard } from '../components/ReviewCard';
import { MeaningCard } from '../components/MeaningCard';
import type { ReviewMode, Sentence } from '../db/schema';
import { normalizePinyin } from '../lib/pinyinCompare';
import { TagFilterRow } from '../components/TagFilterRow';
import { SearchInput } from '../components/SearchInput';

type ModeOption = ReviewMode | 'both';

interface LocationState {
  /** Sentence IDs forwarded from BrowsePage multi-select. */
  sentenceIds?: string[];
}

export function FreeReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const incomingSentenceIds = (location.state as LocationState | null)?.sentenceIds ?? null;

  const { setQueue, remaining, reset } = useReviewStore();
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [cart, setCart] = useState<Set<string>>(() =>
    incomingSentenceIds ? new Set(incomingSentenceIds) : new Set()
  );
  const [mode, setMode] = useState<ModeOption>('both');
  const [shuffle, setShuffle] = useState(true);
  const [limitInput, setLimitInput] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    repo.getSentencesOrderByCreatedDesc().then(setSentences);
    getAllTags().then(setAllTags);
  }, []);

  // Clear shared review store on unmount so /review later doesn't see free-review state.
  useEffect(() => () => reset(), []);

  // Clear the "no cards match for this mode" message when the user switches modes.
  useEffect(() => {
    setEmpty(false);
  }, [mode]);

  const toggleCart = (sentenceId: string) => {
    setEmpty(false);
    setCart((prev) => {
      const next = new Set(prev);
      if (next.has(sentenceId)) next.delete(sentenceId);
      else next.add(sentenceId);
      return next;
    });
  };

  const filteredSentences = useMemo(() => {
    let base = filterTags.length > 0
      ? sentences.filter((s) => filterTags.some((t) => s.tags?.includes(t)))
      : sentences;
    const q = search.trim();
    if (q) {
      const qLower = q.toLowerCase();
      const qPinyin = normalizePinyin(q);
      base = base.filter((s) =>
        s.chinese.includes(q) ||
        s.english.toLowerCase().includes(qLower) ||
        normalizePinyin(s.pinyin).includes(qPinyin) ||
        normalizePinyin(s.pinyinSandhi).includes(qPinyin)
      );
    }
    return base;
  }, [sentences, filterTags, search]);

  const allFilteredInCart =
    filteredSentences.length > 0 && filteredSentences.every((s) => cart.has(s.id));

  const toggleAllFiltered = () => {
    if (filteredSentences.length === 0) return;
    setEmpty(false);
    setCart((prev) => {
      const next = new Set(prev);
      if (allFilteredInCart) filteredSentences.forEach((s) => next.delete(s.id));
      else filteredSentences.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const start = async () => {
    if (loading || cart.size === 0) return;
    setLoading(true);
    setEmpty(false);
    try {
      const deckId = await repo.ensureDefaultDeck();
      const parsedLimit = parseInt(limitInput, 10);
      const queue = await getFreeReviewQueue({
        deckId,
        mode,
        sentenceIds: [...cart],
        shuffle,
        limit: parsedLimit > 0 ? parsedLimit : null,
      });
      if (queue.length === 0) {
        setEmpty(true);
        return;
      }
      setQueue(queue, { freeReview: true });
      setStarted(true);
    } finally {
      setLoading(false);
    }
  };

  if (!started) {
    return (
      <div className="px-4 pt-12 pb-40 sm:px-6 sm:pt-6 max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1 rounded text-sm surface-hover transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold">Free review</h1>
          <div className="w-12" />
        </div>

        <p className="text-xs mb-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
          Drill cards without affecting your schedule.
        </p>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search Chinese, pinyin, or English"
          className="mb-2"
        />

        <TagFilterRow
          allTags={allTags}
          selected={filterTags}
          onChange={setFilterTags}
          className="mb-3"
        />

        {filteredSentences.length > 0 && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {filteredSentences.length} match{filteredSentences.length === 1 ? '' : 'es'}
            </span>
            <button
              onClick={toggleAllFiltered}
              className="text-xs px-2.5 py-1 rounded-full transition-colors"
              style={
                allFilteredInCart
                  ? { background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }
                  : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
              }
            >
              {allFilteredInCart ? 'Deselect all' : 'Select all'}
            </button>
          </div>
        )}

        {/* Sentence list */}
        <div className="space-y-1.5">
          {filteredSentences.length === 0 ? (
            <p className="text-center py-6 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No sentences match.
            </p>
          ) : (
            filteredSentences.map((s) => {
              const isInCart = cart.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleCart(s.id)}
                  className="w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3"
                  style={{
                    background: isInCart ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))' : 'var(--bg-surface)',
                    border: `1px solid ${isInCart ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
                  }}
                >
                  <div
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: isInCart ? 'var(--accent)' : 'transparent',
                      border: `2px solid ${isInCart ? 'var(--accent)' : 'var(--border-strong)'}`,
                      color: 'var(--text-inverted)',
                    }}
                  >
                    {isInCart && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base truncate">{s.chinese}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {s.english}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Sticky bottom: options + start */}
        <div
          className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pt-3"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
            borderTop: '1px solid var(--border)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="max-w-md mx-auto">
            {showOptions && (
              <div className="mb-3 space-y-3">
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Mode</p>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      { key: 'both' as ModeOption, label: 'All' },
                      { key: 'en-to-zh' as ModeOption, label: 'EN→ZH' },
                      { key: 'zh-to-en' as ModeOption, label: 'ZH→EN' },
                      { key: 'py-to-en-zh' as ModeOption, label: 'PY→' },
                      { key: 'listen-type' as ModeOption, label: 'Listen' },
                      { key: 'speak' as ModeOption, label: 'Speak' },
                    ]).map((opt) => {
                      const selected = mode === opt.key;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => setMode(opt.key)}
                          className="px-2 py-1 rounded text-xs font-medium transition-colors"
                          style={
                            selected
                              ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                              : { background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }
                          }
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Shuffle</span>
                    <button
                      onClick={() => setShuffle(!shuffle)}
                      className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors"
                      style={
                        shuffle
                          ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                          : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                      }
                    >
                      {shuffle ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cap</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={limitInput}
                      onChange={(e) => setLimitInput(e.target.value)}
                      placeholder="None"
                      className="flex-1 px-2 py-1 rounded text-xs"
                      style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="text-xs transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Options {showOptions ? '▲' : '▼'}
              </button>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {cart.size} selected
              </span>
            </div>

            {empty && (
              <p className="mb-2 text-xs text-center" style={{ color: 'var(--danger)' }}>
                No cards match for this mode.
              </p>
            )}

            <button
              onClick={start}
              disabled={loading || cart.size === 0}
              className="w-full py-3 rounded-lg font-medium transition-all active:scale-[0.98] disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              {loading ? 'Loading…' : `Start free review${cart.size > 0 ? ` (${cart.size})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-12 pb-4 sm:p-6">
      <div className="flex items-center justify-between mb-6 max-w-2xl mx-auto">
        <button
          onClick={() => {
            reset();
            navigate('/');
          }}
          className="px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold">Free review</h1>
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{remaining()} left</div>
      </div>

      <ReviewCard />
      <MeaningCard />
    </div>
  );
}
