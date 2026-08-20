/**
 * Inline alternative glosses for a flagged word.
 *
 * Opt-in: it costs an LLM call, and most flags get dismissed after a glance.
 * The reasoning is shown here rather than behind a link to a chat model — the
 * question is always about one word in one sentence, which does not need a
 * conversation, and leaving the app to read prose then typing the gloss back by
 * hand is both slower and how free-text wording creeps back in.
 */
import { useState } from 'react';
import {
  suggestGlosses,
  type GlossCandidate,
  type GlossSuggestions as Suggestions,
} from '../services/suggestGlosses';
import { isAIConfigured } from '../services/aiProvider';

/**
 * Open a chat model with the question already framed.
 *
 * The in-app suggestions answer "what are my options"; this answers "help me
 * understand". Both are wanted — a list is what you need to fill the field, a
 * conversation is what you need when the list itself looks wrong.
 */
function askUrl(sentence: string, headword: string, currentGloss: string): string {
  const q = `In the Chinese sentence "${sentence}", what does ${headword} mean here? I have it glossed as "${currentGloss}" for a flashcard. Is that right, and what would you use? Note the gloss should cover only what ${headword} itself contributes, not meaning carried by the surrounding words.`;
  return `https://chatgpt.com/?q=${encodeURIComponent(q)}`;
}

function AskLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline text-xs"
      style={{ color: 'var(--text-tertiary)' }}
    >
      Ask ChatGPT ↗
    </a>
  );
}

export function GlossSuggestions({
  sentence,
  headword,
  currentGloss,
  onChoose,
}: {
  sentence: string;
  headword: string;
  currentGloss: string;
  /** Applies the gloss. meaningId is set when the choice is a sense the deck
   *  already holds, so it can be reused rather than duplicated. */
  onChoose: (headword: string, gloss: string, meaningId?: string) => void;
}) {
  const [result, setResult] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isAIConfigured()) return null;

  const fetchSuggestions = async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await suggestGlosses(sentence, headword, currentGloss));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not fetch alternatives');
    } finally {
      setLoading(false);
    }
  };

  const pillStyle: React.CSSProperties = {
    background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
    color: 'var(--accent)',
    border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  };

  if (result === null) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={fetchSuggestions}
          disabled={loading}
          className="px-2 py-0.5 rounded text-xs disabled:opacity-50"
          style={pillStyle}
        >
          {loading ? 'Thinking…' : 'Suggest alternatives'}
        </button>
        <AskLink href={askUrl(sentence, headword, currentGloss)} />
      </span>
    );
  }

  return (
    <div className="mt-1 space-y-2 w-full">
      {error && (
        <div
          className="p-2 rounded text-xs"
          style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning)' }}
        >
          {error}
        </div>
      )}

      {result.reasoning && (
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {result.reasoning}
        </div>
      )}

      {result.candidates.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          No alternatives offered.
        </div>
      ) : (
        <div className="space-y-1">
          {result.candidates.map((c: GlossCandidate) => (
            <div key={c.english} className="flex flex-wrap items-baseline gap-2">
              <button
                type="button"
                onClick={() => onChoose(headword, c.english, c.meaningId)}
                className="px-2 py-0.5 rounded text-xs"
                style={pillStyle}
              >
                {c.english}
              </button>
              {c.meaningId && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  already in your deck
                </span>
              )}
              {c.note && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {c.note}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <AskLink href={askUrl(sentence, headword, currentGloss)} />
    </div>
  );
}
