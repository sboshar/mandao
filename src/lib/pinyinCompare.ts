/**
 * Pinyin comparison utilities for the Listen & Type review mode.
 *
 * Handles normalisation so that tone marks (ni3 hao3), diacritics (nǐ hǎo),
 * and plain letters (ni hao) all compare sensibly.
 */

// ---- tone-mark ↔ tone-number mapping -----------------------------------

const DIACRITIC_TO_BASE: Record<string, [string, number]> = {
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  'ǖ': ['ü', 1], 'ǘ': ['ü', 2], 'ǚ': ['ü', 3], 'ǜ': ['ü', 4],
};

/**
 * Normalise a single pinyin syllable to lowercase ASCII letters + trailing
 * tone digit (1-5).  Handles diacritics, trailing tone numbers, and bare
 * ASCII (treated as tone 5 / neutral).
 *
 * Examples:
 *   "nǐ"   → "ni3"
 *   "hao3"  → "hao3"
 *   "hao"   → "hao5"
 *   "lǜ"    → "lv5" — we normalise ü→v for easier comparison
 */
export function normaliseSyllable(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return '';

  // Check if already has trailing tone number
  const trailingTone = s.match(/^(.+?)(\d)$/);
  if (trailingTone) {
    const base = trailingTone[1].replace(/ü/g, 'v');
    return base + trailingTone[2];
  }

  // Convert diacritics to base + tone
  let tone = 5; // default neutral
  let converted = '';
  for (const ch of s) {
    const entry = DIACRITIC_TO_BASE[ch];
    if (entry) {
      converted += entry[0];
      tone = entry[1];
    } else {
      converted += ch;
    }
  }

  converted = converted.replace(/ü/g, 'v');
  return converted + String(tone);
}

/**
 * Split a pinyin string into individual syllables.
 * Handles both space-separated ("ni3 hao3") and runs of syllables.
 */
export function splitPinyin(input: string): string[] {
  return input
    .trim()
    .split(/[\s]+/)
    .filter(Boolean);
}

// ---- comparison result ------------------------------------------------

export interface SyllableResult {
  /** What the user typed for this position */
  typed: string;
  /** The correct syllable at this position (display form) */
  expected: string;
  /** Whether the base letters match (ignoring tone) */
  baseMatch: boolean;
  /** Whether the tone also matches */
  toneMatch: boolean;
  /** Fully correct (both base and tone) */
  correct: boolean;
}

/**
 * Compare user input against the correct pinyin, syllable by syllable.
 *
 * Returns an array aligned to `max(userSyllables, correctSyllables)` so the
 * UI can always render every position.
 */
export function comparePinyin(
  userInput: string,
  correctPinyin: string,
): SyllableResult[] {
  const userSyls = splitPinyin(userInput);
  const correctSyls = splitPinyin(correctPinyin);

  const len = Math.max(userSyls.length, correctSyls.length);
  const results: SyllableResult[] = [];

  for (let i = 0; i < len; i++) {
    const typed = userSyls[i] ?? '';
    const expected = correctSyls[i] ?? '';

    if (!typed || !expected) {
      results.push({ typed, expected, baseMatch: false, toneMatch: false, correct: false });
      continue;
    }

    const normUser = normaliseSyllable(typed);
    const normExpected = normaliseSyllable(expected);

    const userBase = normUser.replace(/\d$/, '');
    const expectedBase = normExpected.replace(/\d$/, '');
    const userTone = normUser.match(/(\d)$/)?.[1] ?? '5';
    const expectedTone = normExpected.match(/(\d)$/)?.[1] ?? '5';

    const baseMatch = userBase === expectedBase;
    const toneMatch = userTone === expectedTone;

    results.push({
      typed,
      expected,
      baseMatch,
      toneMatch,
      correct: baseMatch && toneMatch,
    });
  }

  return results;
}
