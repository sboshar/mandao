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
  LineChart,
  Line,
} from 'recharts';
import { db } from '../db/db';
import type { ReviewLog } from '../db/schema';

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

function getChartColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    rating: {
      again: s.getPropertyValue('--rating-again').trim() || '#ef4444',
      hard: s.getPropertyValue('--rating-hard').trim() || '#f97316',
      good: s.getPropertyValue('--rating-good').trim() || '#22c55e',
      easy: s.getPropertyValue('--rating-easy').trim() || '#3b82f6',
    },
    state: [
      s.getPropertyValue('--state-new').trim() || '#3b82f6',
      s.getPropertyValue('--state-learning').trim() || '#f97316',
      s.getPropertyValue('--state-review').trim() || '#22c55e',
      s.getPropertyValue('--state-relearning').trim() || '#a855f7',
    ],
    accent: s.getPropertyValue('--accent').trim() || '#6366f1',
    grid: s.getPropertyValue('--border').trim() || '#e5e5e5',
    text: s.getPropertyValue('--text-secondary').trim() || '#525252',
  };
}

function bucketByDay(logs: ReviewLog[], days: number): DayBucket[] {
  const now = new Date();
  const buckets: Map<string, DayBucket> = new Map();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(5, 10);
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
  const [days, setDays] = useState(30);
  const [totalReviews, setTotalReviews] = useState(0);
  const [streak, setStreak] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [colors, setColors] = useState(getChartColors);

  useEffect(() => {
    // Re-read colors when theme changes
    const observer = new MutationObserver(() => setColors(getChartColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    async function load() {
      const allLogs = await db.reviewLogs.toArray();
      setLogs(allLogs);
      setTotalReviews(allLogs.length);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      setTodayCount(allLogs.filter((l) => l.reviewedAt >= todayStart.getTime()).length);

      const daySet = new Set<string>();
      for (const l of allLogs) {
        daySet.add(new Date(l.reviewedAt).toISOString().slice(0, 10));
      }
      let s = 0;
      const d = new Date();
      const todayKey = d.toISOString().slice(0, 10);
      if (!daySet.has(todayKey)) {
        d.setDate(d.getDate() - 1);
      }
      while (daySet.has(d.toISOString().slice(0, 10))) {
        s++;
        d.setDate(d.getDate() - 1);
      }
      setStreak(s);

      const cards = await db.srsCards.toArray();
      const stateNames = ['New', 'Learning', 'Review', 'Relearning'];
      const counts = [0, 0, 0, 0];
      for (const c of cards) counts[c.state]++;
      setCardStates(stateNames.map((name, i) => ({ name, value: counts[i] })));
    }
    load();
  }, []);

  const daily = bucketByDay(logs, days);
  const cumulative = cumulativeReviews(logs, days);

  const ratingTotals = [
    { name: 'Again', value: logs.filter((l) => l.rating === 1).length, color: colors.rating.again },
    { name: 'Hard', value: logs.filter((l) => l.rating === 2).length, color: colors.rating.hard },
    { name: 'Good', value: logs.filter((l) => l.rating === 3).length, color: colors.rating.good },
    { name: 'Easy', value: logs.filter((l) => l.rating === 4).length, color: colors.rating.easy },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/')}
          className="transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold">Statistics</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { value: totalReviews, label: 'Total Reviews' },
          { value: todayCount, label: 'Today' },
          { value: streak, label: 'Day Streak' },
          {
            value: totalReviews > 0
              ? Math.round((logs.filter((l) => l.rating >= 3).length / totalReviews) * 100) + '%'
              : '0%',
            label: 'Pass Rate',
          },
        ].map((s) => (
          <div key={s.label} className="surface rounded-lg p-4 text-center">
            <div className="text-3xl font-bold">{s.value}</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Time range */}
      <div className="flex gap-2 mb-6">
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-colors"
            style={
              days === d
                ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                : { background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
            }
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Reviews per day */}
      <div className="surface rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Reviews per Day</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: colors.text }} />
            <YAxis allowDecimals={false} tick={{ fill: colors.text }} />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
            />
            <Bar dataKey="again" stackId="a" fill={colors.rating.again} name="Again" />
            <Bar dataKey="hard" stackId="a" fill={colors.rating.hard} name="Hard" />
            <Bar dataKey="good" stackId="a" fill={colors.rating.good} name="Good" />
            <Bar dataKey="easy" stackId="a" fill={colors.rating.easy} name="Easy" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cumulative reviews */}
      <div className="surface rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Cumulative Reviews</h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={cumulative}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: colors.text }} />
            <YAxis allowDecimals={false} tick={{ fill: colors.text }} />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke={colors.accent}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-6">
        <div className="surface rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Rating Distribution</h2>
          {totalReviews > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={ratingTotals}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {ratingTotals.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>No reviews yet</div>
          )}
        </div>

        <div className="surface rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Card States</h2>
          {cardStates.some((s) => s.value > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={cardStates}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {cardStates.map((_, i) => (
                    <Cell key={i} fill={colors.state[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>No cards yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
