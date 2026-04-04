import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getDueCounts } from '../services/srs';
import { DEFAULT_DECK_ID } from '../db/schema';
import { db } from '../db/db';

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

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Mandarin</h1>

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
      <div className="flex gap-3">
        <button
          onClick={() => navigate('/add')}
          className="flex-1 py-3 rounded-lg bg-green-500 text-white font-medium
            hover:bg-green-600 transition-colors"
        >
          + Add Sentence
        </button>
        <button
          onClick={() => navigate('/browse')}
          className="flex-1 py-3 rounded-lg bg-gray-100 font-medium
            hover:bg-gray-200 transition-colors"
        >
          Browse
        </button>
      </div>
    </div>
  );
}
