import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getDueCounts } from '../services/srs';
import { DEFAULT_DECK_ID } from '../db/schema';
import { db } from '../db/db';
import { TutorialBanner } from '../components/TutorialBanner';
import { useTutorialStore } from '../stores/tutorialStore';

export function DashboardPage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({
    newCount: 0,
    reviewCount: 0,
    learningCount: 0,
  });
  const [totalSentences, setTotalSentences] = useState(0);
  const [totalMeanings, setTotalMeanings] = useState(0);

  useEffect(() => {
    async function load() {
      const c = await getDueCounts(DEFAULT_DECK_ID);
      setCounts(c);
      setTotalSentences(await db.sentences.count());
      setTotalMeanings(await db.meanings.count());
    }
    load();
  }, []);

  const totalDue = counts.newCount + counts.reviewCount + counts.learningCount;

  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Mandarin</h1>

      <TutorialBanner visibleAt={1}>
        Great! Your 3 example sentences are ready. Click <strong>Browse</strong> below
        to see them and explore how the app breaks down each sentence.
      </TutorialBanner>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">{totalSentences}</div>
          <div className="text-sm text-gray-500">Sentences</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">{totalMeanings}</div>
          <div className="text-sm text-gray-500">Meanings</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">{totalDue}</div>
          <div className="text-sm text-gray-500">Due Today</div>
        </div>
      </div>

      {/* Default Deck */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Default Deck</h2>
        <div className="flex gap-4 text-sm mb-4">
          <span className="text-blue-600">
            {counts.newCount} new
          </span>
          <span className="text-orange-600">
            {counts.learningCount} learning
          </span>
          <span className="text-green-600">
            {counts.reviewCount} review
          </span>
        </div>
        <button
          onClick={() => navigate('/review')}
          disabled={totalDue === 0}
          className="w-full py-3 rounded-lg bg-blue-500 text-white font-medium
            hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {totalDue > 0 ? `Study (${totalDue} cards)` : 'No cards due'}
        </button>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        <button
          onClick={() => navigate('/add')}
          className="py-3 rounded-lg bg-green-500 text-white font-medium
            hover:bg-green-600 transition-colors"
        >
          + Add Sentence
        </button>
        <button
          onClick={() => {
            if (tutorialStep === 1) advanceTutorial();
            navigate('/browse');
          }}
          className={`py-3 rounded-lg font-medium transition-colors ${
            tutorialStep === 1
              ? 'bg-blue-500 text-white hover:bg-blue-600 ring-2 ring-blue-300 ring-offset-2'
              : 'bg-gray-100 hover:bg-gray-200'
          }`}
        >
          Browse
        </button>
        <button
          onClick={() => navigate('/graph')}
          className="py-3 rounded-lg bg-indigo-500 text-white font-medium
            hover:bg-indigo-600 transition-colors"
        >
          Graph
        </button>
        <button
          onClick={() => navigate('/stats')}
          className="py-3 rounded-lg bg-purple-500 text-white font-medium
            hover:bg-purple-600 transition-colors"
        >
          Stats
        </button>
      </div>
    </div>
  );
}
