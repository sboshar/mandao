/**
 * "Suggest more sentences" panel inside MeaningCard (#187).
 *
 * Opt-in rather than automatic: it costs an LLM call, and most of the time you
 * open a meaning to read it, not to expand it.
 *
 * Accepting a suggestion hands off to the normal +add flow via ?chinese=
 * instead of ingesting directly. A suggestion is only a Chinese string; turning
 * it into a card needs tokenization, pinyin and per-character meanings, and
 * that pipeline plus its review screen already exists. Routing through it also
 * means suggestions get the same flags and the same chance to be corrected as
 * anything typed by hand.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { suggestPhrases, type PhraseSuggestion } from '../services/suggestPhrases';
import { isAIConfigured } from '../services/aiProvider';

export function SuggestedPhrases({
  headword,
  gloss,
  onNavigate,
}: {
  headword: string;
  gloss?: string;
  /** Lets the host close its modal before we route away. */
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<PhraseSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isAIConfigured()) return null;

  const fetchSuggestions = async () => {
    setLoading(true);
    setError('');
    try {
      const glossMap = gloss ? new Map([[headword, gloss]]) : undefined;
      setSuggestions(await suggestPhrases([headword], glossMap));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not fetch suggestions');
      setSuggestions(null);
    } finally {
      setLoading(false);
    }
  };

  const accept = (s: PhraseSuggestion) => {
    onNavigate?.();
    navigate(`/add?chinese=${encodeURIComponent(s.chinese)}`);
  };

  return (
    <div className="px-6 pb-4">
      <h3
        className="text-sm font-medium uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        More sentences with {headword}
      </h3>

      {suggestions === null && (
        <button
          type="button"
          onClick={fetchSuggestions}
          disabled={loading}
          className="w-full px-3 py-2 rounded text-sm disabled:opacity-50 inset surface-hover"
          style={{ color: 'var(--text-secondary)' }}
        >
          {loading ? 'Thinking…' : `Suggest sentences using ${headword}`}
        </button>
      )}

      {error && (
        <div
          className="p-2 rounded text-xs"
          style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning)' }}
        >
          {error}
        </div>
      )}

      {suggestions !== null && suggestions.length === 0 && (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No new suggestions — anything it came up with is already in your deck.
        </div>
      )}

      {suggestions !== null && suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((s) => (
            <div key={s.chinese} className="p-3 rounded inset">
              <div className="text-lg">{s.chinese}</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {s.english}
              </div>
              {s.note && (
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {s.note}
                </div>
              )}
              <button
                type="button"
                onClick={() => accept(s)}
                className="mt-2 px-2 py-1 rounded text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
                  color: 'var(--accent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                }}
              >
                Add to deck →
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={fetchSuggestions}
            disabled={loading}
            className="w-full px-3 py-1.5 rounded text-xs disabled:opacity-50 inset surface-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {loading ? 'Thinking…' : 'Suggest different ones'}
          </button>
        </div>
      )}
    </div>
  );
}
