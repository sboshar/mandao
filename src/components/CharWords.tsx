/**
 * Other words that use this character (#204).
 *
 * Shown on a single-character meaning, which is where the question arises: you
 * reached 西 through 东西, and what you want next is 西边, 西装, 西瓜 — a
 * character's meaning only becomes real once you have seen it doing work in more
 * than one word.
 *
 * Layered by how certain each layer is, which is also cheapest-first:
 *
 *   1. The dictionary list, rendered immediately. Free, offline, no key.
 *   2. Split by READING, deterministically, so 长城 does not sit beside 长大.
 *      Other readings are shown and labelled rather than hidden — learning that
 *      长 has a second reading is worth more than a tidy list.
 *   3. Narrowed to one SENSE by a model, on request only, because that is a
 *      judgement and it costs a call.
 */
import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { getWordsUsingChar, type CharWord, type CharWordGroups } from '../services/charWords';
import { findSameSenseWords, type SameSenseResult } from '../services/sameSenseWords';
import { isAIConfigured } from '../services/aiProvider';
import { AIKeyRequired } from './AIKeyRequired';
import { SuggestedPhrases } from './SuggestedPhrases';
import { numericToDiacritic } from '../services/toneSandhi';

/** Kept short so the section stays scannable; the rest is one tap away. */
const COLLAPSED = 8;

function WordChip({
  word,
  onClick,
  showGloss,
}: {
  word: CharWord;
  onClick: () => void;
  showGloss?: boolean;
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
      {showGloss && word.gloss && (
        <span className="ml-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {word.gloss}
        </span>
      )}
    </button>
  );
}

export function CharWords({
  char,
  reading,
  sense,
  onNavigate,
}: {
  char: string;
  /** The studied reading, e.g. "zhang3" — splits polyphones. */
  reading?: string;
  /** The studied sense, e.g. "to grow" — narrows within that reading. */
  sense?: string;
  /** Lets the host close its panel before a suggestion routes away. */
  onNavigate?: () => void;
}) {
  const { push } = useNavigationStore();
  const [groups, setGroups] = useState<CharWordGroups | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<CharWord | null>(null);
  const [refined, setRefined] = useState<SameSenseResult | null>(null);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState('');

  // No state reset for a changed char: the caller passes key={char}, so a
  // different character remounts this and every piece of state starts fresh.
  // Resetting here instead would mean setState in an effect body, which
  // cascades renders — and would still leave one frame showing the old list.
  useEffect(() => {
    let cancelled = false;
    getWordsUsingChar(char, reading).then((g) => {
      if (!cancelled) setGroups(g);
    });
    return () => {
      cancelled = true;
    };
  }, [char, reading]);

  if (!groups) return null;
  const { known, candidates, otherReadings } = groups;
  if (known.length === 0 && candidates.length === 0 && otherReadings.length === 0) {
    return null;
  }

  const refine = async () => {
    if (!sense || !reading) return;
    setRefining(true);
    setError('');
    try {
      setRefined(await findSameSenseWords(char, reading, sense, candidates));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not narrow the list');
    } finally {
      setRefining(false);
    }
  };

  // Once narrowed, the model's ordering replaces the dictionary's — that is the
  // point of asking. The unfiltered list stays reachable via "Show all".
  const shown = refined ? refined.words : candidates;
  const capped = showAll ? shown : shown.slice(0, COLLAPSED);

  return (
    <div className="px-6 pb-4">
      <h3
        className="text-sm font-medium uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Other words using {char}
      </h3>

      {known.length > 0 && (
        <div className="mb-3">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Already in your deck
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(showAll ? known : known.slice(0, COLLAPSED)).map((w) => (
              <WordChip
                key={w.word}
                word={w}
                onClick={() => push({ type: 'meaning', id: w.meaningId! })}
              />
            ))}
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
            {refined
              ? `Where ${char} means "${sense}" — commonest first. Tap one for sentences.`
              : 'Not in your deck — tap one for sentences.'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {capped.map((w) => (
              <WordChip
                key={w.word}
                word={w}
                showGloss
                onClick={() => setSelected(selected?.word === w.word ? null : w)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Narrowing is opt-in: reading is already handled in code for free, and
          this is the only part that costs a call. */}
      {!refined && sense && reading && candidates.length > 1 && (
        <div className="mt-2">
          {isAIConfigured() ? (
            <button
              type="button"
              onClick={refine}
              disabled={refining}
              className="px-3 py-1.5 rounded text-xs disabled:opacity-50 inset surface-hover"
              style={{ color: 'var(--text-secondary)' }}
            >
              {refining
                ? 'Narrowing…'
                : `Only where ${char} means "${sense}"`}
            </button>
          ) : (
            <AIKeyRequired
              label={`Only where ${char} means "${sense}"`}
              className="px-3 py-1.5 rounded text-xs inset"
              style={{ color: 'var(--text-secondary)' }}
              onNavigate={onNavigate}
            />
          )}
        </div>
      )}

      {error && (
        <div
          className="mt-2 p-2 rounded text-xs"
          style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning)' }}
        >
          {error}
        </div>
      )}

      {refined && (
        <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {refined.reasoning}
          {refined.words.length === 0 && (
            <span> No listed word uses {char} in that sense.</span>
          )}
          {/* Surfaced rather than swallowed: a non-zero count means the reply
              referred to entries that were not offered. */}
          {refined.droppedInvalid > 0 && (
            <span style={{ color: 'var(--text-tertiary)' }}>
              {' '}
              ({refined.droppedInvalid} unusable{' '}
              {refined.droppedInvalid === 1 ? 'entry' : 'entries'} ignored)
            </span>
          )}
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

      {otherReadings.length > 0 && (
        <div className="mt-3">
          {otherReadings.map((g) => (
            <div key={g.reading} className="mb-2">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Read {numericToDiacritic(g.reading)} here — a different word
                {g.gloss && `, "${g.gloss}"`}
              </div>
              <div className="flex flex-wrap gap-1.5 opacity-70">
                {g.words.map((w) => (
                  <WordChip
                    key={w.word}
                    word={w}
                    onClick={() => setSelected(selected?.word === w.word ? null : w)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(shown.length > COLLAPSED || known.length > COLLAPSED) && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {showAll ? 'Show fewer' : 'Show all'}
        </button>
      )}
    </div>
  );
}
