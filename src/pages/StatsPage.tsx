import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { db } from '../db/db';
import type { ReviewLog, Sentence } from '../db/schema';

interface DayBucket {
  date: string;
  count: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface StateSummary {
  name: string;
  value: number;
}

const RATING_COLORS = {
  again: '#ef4444',
  hard: '#f97316',
  good: '#22c55e',
  easy: '#3b82f6',
};

const STATE_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7'];

function bucketByDay(logs: ReviewLog[], days: number): DayBucket[] {
  const now = new Date();
  const buckets: Map<string, DayBucket> = new Map();

  // Pre-fill all days so the chart has no gaps
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(5, 10); // MM-DD
    buckets.set(key, { date: key, count: 0, again: 0, hard: 0, good: 0, easy: 0 });
  }

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  for (const log of logs) {
    if (log.reviewedAt < cutoff.getTime()) continue;
    const d = new Date(log.reviewedAt);
    const key = d.toISOString().slice(5, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.count++;
    if (log.rating === 1) bucket.again++;
    else if (log.rating === 2) bucket.hard++;
    else if (log.rating === 3) bucket.good++;
    else if (log.rating === 4) bucket.easy++;
  }

  return [...buckets.values()];
}

function cumulativeReviews(logs: ReviewLog[], days: number): { date: string; total: number }[] {
  const sorted = [...logs].sort((a, b) => a.reviewedAt - b.reviewedAt);
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  const countBefore = sorted.filter((l) => l.reviewedAt < cutoff.getTime()).length;
  const buckets: Map<string, number> = new Map();
  let running = countBefore;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(5, 10), running);
  }

  for (const log of sorted) {
    if (log.reviewedAt < cutoff.getTime()) continue;
    const key = new Date(log.reviewedAt).toISOString().slice(5, 10);
    running++;
    buckets.set(key, running);
  }

  return [...buckets.entries()].map(([date, total]) => ({ date, total }));
}

export function StatsPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [cardStates, setCardStates] = useState<StateSummary[]>([]);
  const [tagCounts, setTagCounts] = useState<{ name: string; count: number }[]>([]);
  const [reviewsByTag, setReviewsByTag] = useState<{ name: string; reviews: number; again: number; hard: number; good: number; easy: number }[]>([]);
  const [days, setDays] = useState(30);
  const [totalReviews, setTotalReviews] = useState(0);
  const [streak, setStreak] = useState(0);
  const [todayCount, setTodayCount] = useState(0);

  useEffect(() => {
    async function load() {
      const allLogs = await db.reviewLogs.toArray();
      setLogs(allLogs);
      setTotalReviews(allLogs.length);

      // Today's count
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      setTodayCount(allLogs.filter((l) => l.reviewedAt >= todayStart.getTime()).length);

      // Streak: consecutive days with at least 1 review
      const daySet = new Set<string>();
      for (const l of allLogs) {
        daySet.add(new Date(l.reviewedAt).toISOString().slice(0, 10));
      }
      let s = 0;
      const d = new Date();
      // Check if today has reviews; if not, start checking from yesterday
      const todayKey = d.toISOString().slice(0, 10);
      if (!daySet.has(todayKey)) {
        d.setDate(d.getDate() - 1);
      }
      while (daySet.has(d.toISOString().slice(0, 10))) {
        s++;
        d.setDate(d.getDate() - 1);
      }
      setStreak(s);

      // Card state distribution
      const cards = await db.srsCards.toArray();
      const stateNames = ['New', 'Learning', 'Review', 'Relearning'];
      const counts = [0, 0, 0, 0];
      for (const c of cards) counts[c.state]++;
      setCardStates(stateNames.map((name, i) => ({ name, value: counts[i] })));

      // Tag distribution + reviews by tag
      const sentences = await db.sentences.toArray();
      const sentenceTagMap = new Map<string, string[]>();
      for (const s of sentences) {
        sentenceTagMap.set(s.id, s.tags || []);
      }

      // Build card → sentenceId lookup
      const cardSentenceMap = new Map<string, string>();
      for (const c of cards) {
        cardSentenceMap.set(c.id, c.sentenceId);
      }

      // Count reviews per tag
      const reviewTagData = new Map<string, { reviews: number; again: number; hard: number; good: number; easy: number }>();
      let untaggedReviews = { reviews: 0, again: 0, hard: 0, good: 0, easy: 0 };
      for (const log of allLogs) {
        const sentenceId = cardSentenceMap.get(log.cardId);
        const tags = sentenceId ? sentenceTagMap.get(sentenceId) : undefined;
        const ratingKey = log.rating === 1 ? 'again' : log.rating === 2 ? 'hard' : log.rating === 3 ? 'good' : 'easy';
        if (!tags || tags.length === 0) {
          untaggedReviews.reviews++;
          untaggedReviews[ratingKey]++;
        } else {
          for (const t of tags) {
            if (!reviewTagData.has(t)) reviewTagData.set(t, { reviews: 0, again: 0, hard: 0, good: 0, easy: 0 });
            const entry = reviewTagData.get(t)!;
            entry.reviews++;
            entry[ratingKey]++;
          }
        }
      }
      const rByTag = [...reviewTagData.entries()]
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.reviews - a.reviews);
      if (untaggedReviews.reviews > 0) rByTag.push({ name: 'untagged', ...untaggedReviews });
      setReviewsByTag(rByTag);
      const tagMap = new Map<string, number>();
      let untagged = 0;
      for (const s of sentences) {
        if (!s.tags || s.tags.length === 0) {
          untagged++;
        } else {
          for (const t of s.tags) {
            tagMap.set(t, (tagMap.get(t) || 0) + 1);
          }
        }
      }
      const tagData = [...tagMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      if (untagged > 0) tagData.push({ name: 'untagged', count: untagged });
      setTagCounts(tagData);
    }
    load();
  }, []);

  const daily = bucketByDay(logs, days);
  const cumulative = cumulativeReviews(logs, days);

  // Rating distribution totals
  const ratingTotals = [
    { name: 'Again', value: logs.filter((l) => l.rating === 1).length, color: RATING_COLORS.again },
    { name: 'Hard', value: logs.filter((l) => l.rating === 2).length, color: RATING_COLORS.hard },
    { name: 'Good', value: logs.filter((l) => l.rating === 3).length, color: RATING_COLORS.good },
    { name: 'Easy', value: logs.filter((l) => l.rating === 4).length, color: RATING_COLORS.easy },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold">Statistics</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">{totalReviews}</div>
          <div className="text-sm text-gray-500">Total Reviews</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">{todayCount}</div>
          <div className="text-sm text-gray-500">Today</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">{streak}</div>
          <div className="text-sm text-gray-500">Day Streak</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow text-center">
          <div className="text-3xl font-bold">
            {totalReviews > 0
              ? Math.round(
                  (logs.filter((l) => l.rating >= 3).length / totalReviews) * 100
                )
              : 0}
            %
          </div>
          <div className="text-sm text-gray-500">Pass Rate</div>
        </div>
      </div>

      {/* Time range selector */}
      <div className="flex gap-2 mb-6">
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
              days === d
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Reviews per day */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Reviews per Day</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="again" stackId="a" fill={RATING_COLORS.again} name="Again" />
            <Bar dataKey="hard" stackId="a" fill={RATING_COLORS.hard} name="Hard" />
            <Bar dataKey="good" stackId="a" fill={RATING_COLORS.good} name="Good" />
            <Bar dataKey="easy" stackId="a" fill={RATING_COLORS.easy} name="Easy" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cumulative reviews */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Cumulative Reviews</h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={cumulative}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="total"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom row: rating distribution + card states */}
      <div className="grid grid-cols-2 gap-6">
        {/* Rating distribution */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-4">Rating Distribution</h2>
          {totalReviews > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={ratingTotals}
                  cx="50%"
                  cy="45%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {ratingTotals.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend
                  formatter={(value, entry: any) => {
                    const item = ratingTotals.find((r) => r.name === value);
                    const pct = totalReviews > 0 && item ? Math.round((item.value / totalReviews) * 100) : 0;
                    return `${value} ${pct}%`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-gray-400 text-center py-12">No reviews yet</div>
          )}
        </div>

        {/* Card state breakdown */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-4">Card States</h2>
          {cardStates.some((s) => s.value > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={cardStates}
                  cx="50%"
                  cy="45%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {cardStates.map((_, i) => (
                    <Cell key={i} fill={STATE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-gray-400 text-center py-12">No cards yet</div>
          )}
        </div>
      </div>

      {/* Sentences by tag */}
      {tagCounts.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-lg font-medium mb-4">Sentences by Tag</h2>
          <ResponsiveContainer width="100%" height={Math.max(150, tagCounts.length * 40)}>
            <BarChart data={tagCounts} layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={100} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="Sentences" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Reviews by tag */}
      {reviewsByTag.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-lg font-medium mb-4">Reviews by Tag</h2>
          <ResponsiveContainer width="100%" height={Math.max(150, reviewsByTag.length * 40)}>
            <BarChart data={reviewsByTag} layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={100} />
              <Tooltip />
              <Bar dataKey="again" stackId="a" fill={RATING_COLORS.again} name="Again" />
              <Bar dataKey="hard" stackId="a" fill={RATING_COLORS.hard} name="Hard" />
              <Bar dataKey="good" stackId="a" fill={RATING_COLORS.good} name="Good" />
              <Bar dataKey="easy" stackId="a" fill={RATING_COLORS.easy} name="Easy" radius={[0, 4, 4, 0]} />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
