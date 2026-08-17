/**
 * Suggestion list for one or more target words (#187).
 *
 * Two entry points share this: the inline panel in MeaningCard (opt-in, since
 * it costs an LLM call and most visits are just to read), and the modal opened
 * by highlighting Chinese text (auto-fetches, because highlighting and tapping
 * the action IS the request).
 *
 * Accepting hands off to the normal +add flow via ?chinese= rather than
 * ingesting directly. A suggestion is only a Chinese string; making it a card
 * needs tokenization, pinyin and per-character meanings, and that pipeline plus
 * its review screen already exist. Routing through it also means suggestions
 * get the same flags and corrections as anything typed by hand.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { suggestPhrases, type PhraseSuggestion } from '../services/suggestPhrases';
import { isAIConfigured } from '../services/aiProvider';

export function SuggestedPhrases({
  headwords,
  gloss,
  autoFetch = false,
  onNavigate,
}: {
  /** One word, or several that must appear together. */
  headwords: string[];
  gloss?: string;
  /** Fetch on mount instead of waiting for a button press. */
  autoFetch?: boolean;
  /** Lets the host close its modal before we route away. */
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<PhraseSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const label = headwords.join(' + ');

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const glossMap =
        gloss && headwords.length === 1 ? new Map([[headwords[0], gloss]]) : undefined;
      setSuggestions(await suggestPhrases(headwords, glossMap));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not fetch suggestions');
      setSuggestions(null);
    } finally {
      setLoading(false);
    }
  }, [headwords, gloss]);

  useEffect(() => {
    if (autoFetch) void fetchSuggestions();
    // Deliberately keyed on the joined headwords rather than the array
    // identity, which changes on every render of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, label]);

  if (!isAIConfigured()) return null;

  const accept = (s: PhraseSuggestion) => {
    onNavigate?.();
    navigate(`/add?chinese=${encodeURIComponent(s.chinese)}`);
  };

  return (
    <div className="space-y-2">
      {suggestions === null && !loading && !error && (
        <button
          type="button"
          onClick={fetchSuggestions}
          className="w-full px-3 py-2 rounded text-sm inset surface-hover"
          style={{ color: 'var(--text-secondary)' }}
        >
          Suggest sentences using {label}
        </button>
      )}

      {loading && (
        <div className="text-sm py-2" style={{ color: 'var(--text-tertiary)' }}>
          Thinking…
        </div>
      )}

      {error && (
        <div
          className="p-2 rounded text-xs"
          style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning)' }}
        >
          {error}
        </div>
      )}

      {suggestions !== null && suggestions.length === 0 && !loading && (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Nothing new — anything it suggested is already in your deck.
        </div>
      )}

      {suggestions !== null && suggestions.length > 0 && (
        <>
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
            Suggest different ones
          </button>
        </>
      )}
    </div>
  );
}
