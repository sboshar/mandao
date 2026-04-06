import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useReviewStore } from '../stores/reviewStore';
import { getReviewQueue } from '../services/srs';
import { getAllTags } from '../services/ingestion';
import { ReviewCard } from '../components/ReviewCard';
import { MeaningCard } from '../components/MeaningCard';
import { DEFAULT_DECK_ID } from '../db/schema';
import type { ReviewMode } from '../db/schema';

type ModeOption = ReviewMode | 'both';

export function ReviewPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { setQueue, remaining, reset } = useReviewStore();
  const effectiveDeckId = deckId || DEFAULT_DECK_ID;
  const [mode, setMode] = useState<ModeOption>('en-to-zh');
  const [started, setStarted] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    getAllTags().then(setAllTags);
  }, []);

  const startReview = async (selectedMode: ModeOption) => {
    const queue = await getReviewQueue(effectiveDeckId, selectedMode, filterTags.length > 0 ? filterTags : null);
    setQueue(queue);
    setStarted(true);
  };

  useEffect(() => {
    return () => reset();
  }, []);

  // Mode selection screen
  if (!started) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
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
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  filterTags.length > 0
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                Filter by tag{filterTags.length > 0 ? ` (${filterTags.length})` : ''} {showFilter ? '\u25B2' : '\u25BC'}
              </button>
              {showFilter && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button
                    onClick={() => setFilterTags([])}
                    className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                      filterTags.length === 0
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    All sentences
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setFilterTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )}
                      className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                        filterTags.includes(tag)
                          ? 'bg-blue-500 text-white'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-sm text-gray-500 text-center mb-4">
            Choose review mode:
          </p>

          <button
            onClick={() => { setMode('en-to-zh'); startReview('en-to-zh'); }}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors
              hover:border-blue-400 hover:bg-blue-50
              ${mode === 'en-to-zh' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
          >
            <div className="font-medium">English &rarr; Chinese</div>
            <div className="text-sm text-gray-500">
              See English, produce characters + pinyin
            </div>
          </button>

          <button
            onClick={() => { setMode('zh-to-en'); startReview('zh-to-en'); }}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors
              hover:border-green-400 hover:bg-green-50
              ${mode === 'zh-to-en' ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}
          >
            <div className="font-medium">Chinese &rarr; English</div>
            <div className="text-sm text-gray-500">
              See characters, produce English meaning
            </div>
          </button>

          <button
            onClick={() => { setMode('py-to-en-zh'); startReview('py-to-en-zh'); }}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors
              hover:border-orange-400 hover:bg-orange-50
              ${mode === 'py-to-en-zh' ? 'border-orange-400 bg-orange-50' : 'border-gray-200'}`}
          >
            <div className="font-medium">Pinyin &rarr; English + Chinese</div>
            <div className="text-sm text-gray-500">
              See pinyin (tone sandhi), produce meaning + characters
            </div>
          </button>

          <button
            onClick={() => { setMode('both'); startReview('both'); }}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors
              hover:border-purple-400 hover:bg-purple-50
              ${mode === 'both' ? 'border-purple-400 bg-purple-50' : 'border-gray-200'}`}
          >
            <div className="font-medium">All (mixed)</div>
            <div className="text-sm text-gray-500">
              Interleave all directions
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 max-w-2xl mx-auto">
        <button
          onClick={() => { reset(); setStarted(false); }}
          className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold">Review</h1>
        <div className="text-sm text-gray-400">{remaining()} left</div>
      </div>

      <ReviewCard />
      <MeaningCard />
    </div>
  );
}
