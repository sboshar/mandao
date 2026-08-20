/**
 * Work out WHICH RULE produced each sandhi change, at display time (#196).
 *
 * Derived, not threaded. The obvious design is to record the changes where the
 * sandhi is computed and pass them down to the component, but that couples an
 * explanation to a snapshot: edit the pinyin and the citation survives, pointing
 * at a reading that no longer exists. Splice the token list and the indexes
 * shift under it. Every one of those is a way to state a rule about something
 * the learner is not looking at.
 *
 * Both strings needed to recompute are already on the record — ingestion.ts
 * persists `pinyin` (citation) beside `pinyinSandhi` — so the rule can be worked
 * out from what is on screen, and cannot disagree with it.
 *
 * THE INVARIANT, which is the whole point: a syllable is MARKED when the two
 * strings differ, and EXPLAINED only when a rule is confirmed for it. Marking is
 * a statement about two strings and is always true. Explaining is a claim about
 * Mandarin, and a wrong one is worse than none — a learner who is told the wrong
 * rule learns the wrong rule. So every doubt resolves to marking without
 * explaining.
 */
import {
  applyToneSandhiDetailed,
  normalizePinyinSyllable,
  numericToDiacritic,
  type SandhiChange,
} from './toneSandhi';

/** CJK ideographs, so punctuation and latin don't consume a syllable slot. */
const HANZI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Line the sentence's characters up with its syllables, or give up.
 *
 * One character is one syllable in Mandarin, so a plain filter is right far more
 * often than not — but erhua written as a separate 儿 syllable, a latin word, or
 * a digit read as several syllables all break it. A misalignment would hand the
 * wrong character to a character-specific rule, so a count mismatch returns
 * undefined and the caller falls back to marking without explaining.
 */
export function alignHanzi(
  chinese: string | undefined,
  syllableCount: number,
): (string | undefined)[] | undefined {
  if (!chinese) return undefined;
  const chars = Array.from(chinese).filter((c) => HANZI.test(c));
  return chars.length === syllableCount ? chars : undefined;
}

/**
 * Which rule explains each displayed syllable.
 *
 * Only entries that survive both checks are returned:
 *   1. the rule is confirmed — for 一 and 不 that means the character was
 *      verified, since 医院 reads yi1 yuan4 and is not 一 at all;
 *   2. the rule's predicted output is what is actually on screen, which is what
 *      makes a hand-edited or stale string fall back to marking by itself
 *      rather than needing to be detected.
 */
export function deriveSandhiChanges(
  basePinyin: string | undefined,
  displayedSyllables: string[],
  chinese?: string,
): Map<number, SandhiChange> {
  const empty = new Map<number, SandhiChange>();
  if (!basePinyin) return empty;

  const base = basePinyin.split(/\s+/).filter(Boolean);
  if (base.length !== displayedSyllables.length) return empty;

  // basePinyin carries diacritics; the rules work on tone numbers.
  const numeric = base.map(normalizePinyinSyllable);
  if (numeric.some((s) => !s)) return empty;

  const { syllables: predicted, changes } = applyToneSandhiDetailed(
    numeric,
    alignHanzi(chinese, numeric.length),
  );

  /**
   * The prediction has to reproduce the WHOLE line, not just the syllable being
   * explained.
   *
   * Checking only the changed syllable leaves the contradiction in place one
   * position over: with a citation form of hěn hǎo and a hand-edited display of
   * hén hào, the change at hén still matches, so the panel would say "because
   * the next syllable is a third tone" directly beside a fourth tone. Any
   * disagreement anywhere means the displayed reading no longer came from these
   * rules, so none of them may be cited for it.
   */
  if (predicted.some((s, i) => numericToDiacritic(s) !== displayedSyllables[i])) {
    return empty;
  }

  const out = new Map<number, SandhiChange>();
  for (const c of changes) {
    if (!c.characterConfirmed) continue;
    out.set(c.index, c);
  }
  return out;
}
