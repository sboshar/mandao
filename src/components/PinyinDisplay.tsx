import { useState } from 'react';
import {
  getToneNumber,
  numericToDiacritic,
  normalizePinyinSyllable,
} from '../services/toneSandhi';
import { deriveSandhiChanges } from '../services/sandhiExplain';
import { SANDHI_RULES, SANDHI_CAVEATS } from '../lib/sandhiRules';

interface PinyinDisplayProps {
  /** Pinyin with diacritics: "nǐ hǎo" */
  pinyin: string;
  /** Pinyin with tone numbers for coloring: "ni3 hao3" */
  pinyinNumeric?: string;
  /** Base/dictionary pinyin (diacritics). When provided, syllables that
   *  differ from the displayed pinyin are highlighted as sandhi changes. */
  basePinyin?: string;
  /**
   * The characters this pinyin transcribes. Only used to tell 一 and 不 from the
   * other characters that read yi1 and bu4, which is the difference between
   * explaining 一定 and claiming 医院 contains 一 (#196).
   */
  chinese?: string;
  /**
   * The syllable that follows this fragment, when it is not included above.
   *
   * Every rule here is conditioned on the NEXT syllable, so a fragment shown on
   * its own cannot explain a change caused by whatever came after it — the 不 in
   * its own token being the common case. One syllable of lookahead is the whole
   * of the context these rules need.
   */
  next?: { pinyin: string; hanzi?: string };
  className?: string;
}

const TONE_CLASSES = ['', 'tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5'];

export function PinyinDisplay({
  pinyin,
  pinyinNumeric,
  basePinyin,
  chinese,
  next,
  className = '',
}: PinyinDisplayProps) {
  /**
   * Which explanation is open, tied to the string it was opened against.
   *
   * Keying on the pinyin rather than holding a bare index means anything that
   * changes the reading — an edit, a re-analysis, a different card — closes the
   * panel instead of leaving it open on a syllable the user never clicked.
   */
  const [openFor, setOpenFor] = useState<{ pinyin: string; index: number } | null>(
    null,
  );

  const syllables = pinyin.split(/\s+/).filter(Boolean);
  const numericSyllables = pinyinNumeric?.split(/\s+/).filter(Boolean);
  const baseSyllables = basePinyin?.split(/\s+/).filter(Boolean);

  // If no numeric and no base to compare, just render plain
  if (!numericSyllables && !baseSyllables) {
    return <span className={className}>{pinyin}</span>;
  }

  // Lookahead is appended for the derivation and dropped again, so a change
  // caused by the next fragment is explained without being rendered here. It is
  // normalized to diacritics first: the derivation compares its prediction
  // against the displayed syllables, and a caller passing "shi4" where the
  // prediction says "shì" would read as a disagreement and suppress everything.
  const nextDiacritic = next
    ? numericToDiacritic(normalizePinyinSyllable(next.pinyin))
    : undefined;
  const changes = deriveSandhiChanges(
    next && basePinyin ? `${basePinyin} ${next.pinyin}` : basePinyin,
    nextDiacritic ? [...syllables, nextDiacritic] : syllables,
    next ? `${chinese ?? ''}${next.hanzi ?? ''}` : chinese,
  );

  const active =
    openFor && openFor.pinyin === pinyin ? changes.get(openFor.index) : undefined;
  const rule = active ? SANDHI_RULES[active.ruleId] : undefined;

  return (
    <span className={className}>
      {syllables.map((syllable, i) => {
        const tone = numericSyllables?.[i]
          ? getToneNumber(numericSyllables[i])
          : 5;
        const isSandhiChange =
          baseSyllables && baseSyllables[i] && baseSyllables[i] !== syllable;
        const explanation = isSandhiChange ? changes.get(i) : undefined;
        const sep = i < syllables.length - 1 ? ' ' : '';

        // Marked but not explained: the two strings differ, so the mark is
        // earned, but no rule was confirmed for it. Rendering it as a button
        // would promise an explanation that does not exist.
        if (!explanation) {
          return (
            <span
              key={i}
              className={isSandhiChange ? '' : TONE_CLASSES[tone]}
              style={isSandhiChange ? { color: 'var(--text-primary)' } : undefined}
              title={
                isSandhiChange
                  ? `Dictionary: ${baseSyllables![i]} → Spoken: ${syllable}`
                  : undefined
              }
            >
              {syllable}
              {sep}
            </span>
          );
        }

        const isOpen = openFor?.pinyin === pinyin && openFor.index === i;
        return (
          <span key={i}>
            <button
              type="button"
              onClick={() =>
                setOpenFor(isOpen ? null : { pinyin, index: i })
              }
              aria-expanded={isOpen}
              className="py-1 -my-1 underline decoration-dotted underline-offset-2 cursor-pointer"
              style={{
                color: 'var(--text-primary)',
                textDecorationColor: 'var(--sandhi-underline)',
              }}
              title={`Dictionary: ${baseSyllables![i]} → Spoken: ${syllable}. Click for the rule.`}
            >
              {syllable}
            </button>
            {sep}
          </span>
        );
      })}

      {active && rule && (
        <span
          className="block w-full mt-1 p-2 rounded text-xs text-left"
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {rule.name}
          </span>
          {': '}
          {rule.statement}
          <span className="block mt-1">
            Here{' '}
            <span className="font-mono">{numericToDiacritic(active.from)}</span>
            {' → '}
            <span className="font-mono">{numericToDiacritic(active.to)}</span>
            {', because the next syllable is a '}
            {TONE_NAMES[active.triggerTone]} tone
            {active.triggerIndex >= syllables.length && ' in the following word'}
            {'.'}
          </span>
          {active.caveatId && (
            <span
              className="block mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              {SANDHI_CAVEATS[active.caveatId]}
            </span>
          )}
          {rule.note && (
            <span className="block mt-1" style={{ color: 'var(--text-secondary)' }}>
              {rule.note}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

const TONE_NAMES = ['', 'first', 'second', 'third', 'fourth', 'neutral'];
