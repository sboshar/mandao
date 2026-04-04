import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useReviewStore } from '../stores/reviewStore';
import { getReviewQueue } from '../services/srs';
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

  const startReview = async (selectedMode: ModeOption) => {
    const queue = await getReviewQueue(effectiveDeckId, selectedMode);
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
            onClick={() => { setMode('both'); startReview('both'); }}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors
              hover:border-purple-400 hover:bg-purple-50
              ${mode === 'both' ? 'border-purple-400 bg-purple-50' : 'border-gray-200'}`}
          >
            <div className="font-medium">Both (mixed)</div>
            <div className="text-sm text-gray-500">
              Interleave both directions
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
