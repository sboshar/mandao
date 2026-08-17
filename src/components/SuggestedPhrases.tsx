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
import { suggestPhrases, type SuggestionResult } from '../services/suggestPhrases';
import { isAIConfigured } from '../services/aiProvider';
import * as repo from '../db/repo';

export function SuggestedPhrases({
  headwords,
  gloss,
  meaningIds,
  autoFetch = false,
  onNavigate,
}: {
  /** One word, or several that must appear together. */
  headwords: string[];
  gloss?: string;
  /**
   * Meanings the highlight actually touched, when opened from a selection.
   *
   * Preferred over a headword lookup, because it names the sense on screen
   * rather than guessing: 意思 may exist in the deck as both "meaning" and
   * "a small gift", and only the rendered token knows which one is being read.
   */
  meaningIds?: string[];
  /** Fetch on mount instead of waiting for a button press. */
  autoFetch?: boolean;
  /** Lets the host close its modal before we route away. */
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const label = headwords.join(' + ');

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Prefer the senses the highlight resolved to; fall back to an
      // explicitly supplied gloss (the MeaningCard path, which already knows
      // exactly which meaning the user is looking at).
      let glossMap: Map<string, string> | undefined;
      if (meaningIds && meaningIds.length > 0) {
        const meanings = await repo.getMeaningsByIds(meaningIds);
        glossMap = new Map(meanings.map((m) => [m.headword, m.englishShort]));
      } else if (gloss && headwords.length === 1) {
        glossMap = new Map([[headwords[0], gloss]]);
      }
      setResult(await suggestPhrases(headwords, glossMap));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not fetch suggestions');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [headwords, gloss, meaningIds]);

  useEffect(() => {
    if (autoFetch) void fetchSuggestions();
    // Deliberately keyed on the joined headwords rather than the array
    // identity, which changes on every render of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, label]);

  if (!isAIConfigured()) return null;

  const suggestions = result?.suggestions ?? null;

  const accept = (s: { chinese: string }) => {
    onNavigate?.();
    navigate(`/add?chinese=${encodeURIComponent(s.chinese)}`);
  };

  return (
    <div className="space-y-2">
      {result === null && !loading && !error && (
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

      {result !== null && result.suggestions.length === 0 && !loading && (
        <div className="text-sm space-y-2" style={{ color: 'var(--text-tertiary)' }}>
          {/* Three different causes, three different things worth doing next.
              Previously all three claimed "already in your deck", which was a
              guess and usually wrong. */}
          {result.returned === 0 && (
            <div>The model didn't suggest anything for {label}. Try again — it's
              not deterministic, and a second attempt often works.</div>
          )}
          {result.returned > 0 && result.droppedExisting === result.returned && (
            <div>All {result.returned} suggestions are already in your deck.</div>
          )}
          {result.returned > 0 && result.droppedExisting < result.returned && (
            <div>
              Got {result.returned}, but none were usable
              {result.droppedOffTarget > 0 && ` — ${result.droppedOffTarget} didn't contain ${label}`}
              {result.droppedExisting > 0 && `, ${result.droppedExisting} already in your deck`}.
            </div>
          )}
          <button
            type="button"
            onClick={fetchSuggestions}
            className="px-3 py-1.5 rounded text-xs inset surface-hover"
            style={{ color: 'var(--text-secondary)' }}
          >
            Try again
          </button>
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
