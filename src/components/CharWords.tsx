/**
 * Other words that use this character (#204).
 *
 * Shown on a single-character meaning, which is where the question arises: you
 * reached 西 through 东西, and what you want next is 西方, 西瓜, 西部 — the point
 * being that a character's meaning only becomes real once you have seen it doing
 * work in more than one word.
 *
 * Rendered eagerly rather than behind a button, unlike the AI suggestions: this
 * is a dictionary scan, so it costs nothing, needs no key and works offline.
 *
 * Split into what the deck already has and what it does not, because they lead
 * to different actions — one is a connection to notice and links to the card,
 * the other is a candidate and offers to find sentences for it.
 */
import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { getWordsUsingChar, type CharWord, type CharWordGroups } from '../services/charWords';
import { SuggestedPhrases } from './SuggestedPhrases';

/** Kept short so the section stays scannable; the rest is one tap away. */
const COLLAPSED = 8;

function WordChip({
  word,
  onClick,
  emphasize,
}: {
  word: CharWord;
  onClick: () => void;
  emphasize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded text-left inset surface-hover"
      title={word.gloss}
    >
      <span className="text-base">{word.word}</span>
      <span className="ml-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {word.pinyin}
      </span>
      {emphasize && word.gloss && (
        <span className="ml-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {word.gloss}
        </span>
      )}
    </button>
  );
}

export function CharWords({
  char,
  onNavigate,
}: {
  char: string;
  /** Lets the host close its panel before a suggestion routes away. */
  onNavigate?: () => void;
}) {
  const { push } = useNavigationStore();
  const [groups, setGroups] = useState<CharWordGroups | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<CharWord | null>(null);

  // No state reset for a changed char: the caller passes key={char}, so a
  // different character remounts this and every piece of state starts fresh.
  // Resetting here instead would mean setState in an effect body, which
  // cascades renders — and would still leave one frame showing the old list.
  useEffect(() => {
    let cancelled = false;
    getWordsUsingChar(char).then((g) => {
      if (!cancelled) setGroups(g);
    });
    return () => {
      cancelled = true;
    };
  }, [char]);

  if (!groups) return null;
  const total = groups.known.length + groups.new.length;
  if (total === 0) return null;

  const cap = (list: CharWord[]) => (showAll ? list : list.slice(0, COLLAPSED));

  return (
    <div className="px-6 pb-4">
      <h3
        className="text-sm font-medium uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Other words using {char}
      </h3>

      {groups.known.length > 0 && (
        <div className="mb-3">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            In your deck
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cap(groups.known).map((w) => (
              <WordChip
                key={w.word}
                word={w}
                onClick={() => push({ type: 'meaning', id: w.meaningId! })}
              />
            ))}
          </div>
        </div>
      )}

      {groups.new.length > 0 && (
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Not in your deck — tap one to find sentences for it
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cap(groups.new).map((w) => (
              <WordChip
                key={w.word}
                word={w}
                emphasize
                onClick={() => setSelected(selected?.word === w.word ? null : w)}
              />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="mt-3">
          <div className="text-sm mb-1">
            {selected.word}
            <span className="ml-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {selected.pinyin} · {selected.gloss}
            </span>
          </div>
          {/* The CEDICT gloss is passed through so the suggestion prompt locks
              onto this sense rather than drifting to another reading. */}
          <SuggestedPhrases
            headwords={[selected.word]}
            gloss={selected.gloss}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {total > COLLAPSED && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {showAll ? 'Show fewer' : `Show all ${total}`}
        </button>
      )}
    </div>
  );
}
