import type { SandhiRuleId, SandhiCaveatId } from '../lib/sandhiRules';

/**
 * Tone sandhi computation.
 * Takes an array of pinyin syllables (with tone numbers) and applies sandhi rules.
 */

/** Extract tone number (1-5) from a pinyin-numeric syllable like "hao3" */
export function getToneNumber(syllable: string): number {
  const match = syllable.match(/(\d)$/);
  if (!match) return 5; // neutral
  return parseInt(match[1], 10);
}

/** Replace the tone number on a pinyin syllable */
function setToneNumber(syllable: string, tone: number): string {
  return syllable.replace(/\d$/, String(tone));
}

/** One syllable the sandhi pass rewrote, and why (#196). */
export interface SandhiChange {
  /** Index of the syllable that changed. */
  index: number;
  /** Citation form, e.g. "hao3". */
  from: string;
  /** Sandhi form, e.g. "hao2". */
  to: string;
  ruleId: SandhiRuleId;
  /**
   * Index of the syllable that caused the change.
   *
   * Every rule here is conditioned on what FOLLOWS, so naming the trigger is
   * what makes an explanation about this sentence rather than a generic
   * statement of the rule.
   */
  triggerIndex: number;
  /**
   * The trigger's CITATION tone, which is what the rule is conditioned on.
   *
   * Naming the trigger syllable instead reads as a contradiction: in 我很好 the
   * rule fires on wǒ because 很 is a third tone, but 很 is itself raised, so a
   * panel saying "because the next syllable is hěn" sits directly under a line
   * reading hén. The tone is the true and un-confusing thing to state.
   */
  triggerTone: number;
  /**
   * Whether the character behind a character-specific rule was verified.
   *
   * False means the transformation was applied on the reading alone, which is
   * right for 一 and 不 and wrong for every other character that happens to read
   * yi1 or bu4. An unconfirmed change may still be displayed — that is existing
   * behaviour — but nothing should cite a rule for it.
   */
  characterConfirmed?: boolean;
  /** A warning that applies to this change specifically. See SANDHI_CAVEATS. */
  caveatId?: SandhiCaveatId;
}

/**
 * Rules that depend on WHICH CHARACTER it is, not just how it reads.
 *
 * Matching on the reading alone is a real bug, not a hypothetical: 医院 is
 * yi1 yuan4 and 部队 is bu4 dui4, and a reading-only rule turns them into
 * yí yuàn and bú duì. Nothing about the pinyin distinguishes them from 一 and
 * 不, so the character is the only way to tell.
 */
const CHARACTER_RULES: { char: string; reading: string }[] = [
  { char: '不', reading: 'bu4' },
  { char: '一', reading: 'yi1' },
];

/** Citation-tone run lengths, so a change can say it sits in a long run. */
function thirdToneRunLengths(syllables: string[]): number[] {
  const runs = new Array<number>(syllables.length).fill(0);
  let i = 0;
  while (i < syllables.length) {
    if (getToneNumber(syllables[i]) !== 3) {
      i++;
      continue;
    }
    let j = i;
    while (j < syllables.length && getToneNumber(syllables[j]) === 3) j++;
    for (let k = i; k < j; k++) runs[k] = j - i;
    i = j;
  }
  return runs;
}

/**
 * Apply tone sandhi, and record what changed.
 *
 * Rules applied, with explanations, live in lib/sandhiRules.ts — deliberately a
 * fixed table rather than a model call, since these are mechanical and a table
 * is right every time.
 */
export function applyToneSandhiDetailed(
  syllables: string[],
  /**
   * The character each syllable came from, index-aligned, where the caller knows
   * it. Supplying it fixes the 医院/部队 misreadings; omitting it preserves the
   * previous behaviour and marks the affected changes unconfirmed.
   */
  hanzi?: (string | undefined)[],
): { syllables: string[]; changes: SandhiChange[] } {
  const result = [...syllables];
  const changes: SandhiChange[] = [];
  const runs = thirdToneRunLengths(syllables);

  const record = (
    index: number,
    from: string,
    ruleId: SandhiRuleId,
    extra?: Partial<SandhiChange>,
  ) => {
    changes.push({
      index,
      from,
      to: result[index],
      ruleId,
      triggerIndex: index + 1,
      // Iteration i only ever writes index i, so result[i + 1] is still the
      // citation form when it is read here.
      triggerTone: getToneNumber(result[index + 1]),
      ...extra,
    });
  };

  /**
   * Does syllable i belong to `char`?
   *
   * Three answers, and the third is the interesting one: yes, no, or the caller
   * did not say. "Did not say" has to keep applying the rule, because that is
   * what every existing caller relies on — but it is recorded so the UI can mark
   * without explaining.
   */
  const isChar = (i: number, char: string): 'yes' | 'no' | 'unknown' => {
    const h = hanzi?.[i];
    if (h === undefined || h === '') return 'unknown';
    return h === char ? 'yes' : 'no';
  };

  for (let i = 0; i < result.length - 1; i++) {
    const current = result[i].toLowerCase();
    const before = result[i];
    const nextTone = getToneNumber(result[i + 1]);

    // Third tone sandhi. No character dependency — any third tone before another
    // raises, whatever the character — so this one is always safe to cite.
    if (getToneNumber(current) === 3 && nextTone === 3) {
      result[i] = setToneNumber(result[i], 2);
      record(i, before, 'third-tone', {
        characterConfirmed: true,
        caveatId: runs[i] >= 3 ? 'long-third-run' : undefined,
      });
      continue;
    }

    const charRule = CHARACTER_RULES.find((r) => r.reading === current);
    if (!charRule) continue;
    const match = isChar(i, charRule.char);
    if (match === 'no') continue; // 医院, 部队 — reading collision, not sandhi
    const characterConfirmed = match === 'yes';

    if (charRule.char === '不' && nextTone === 4) {
      result[i] = 'bu2';
      record(i, before, 'bu-before-fourth', { characterConfirmed });
      continue;
    }

    if (charRule.char === '一') {
      if (nextTone === 4) {
        result[i] = 'yi2';
        record(i, before, 'yi-before-fourth', { characterConfirmed });
      } else if (nextTone >= 1 && nextTone <= 3) {
        result[i] = 'yi4';
        record(i, before, 'yi-before-others', { characterConfirmed });
      }
    }
  }

  return { syllables: result, changes };
}

/** Sandhi forms only. Kept for callers that do not need the explanations. */
export function applyToneSandhi(
  syllables: string[],
  hanzi?: (string | undefined)[],
): string[] {
  return applyToneSandhiDetailed(syllables, hanzi).syllables;
}

/**
 * Convert pinyin with tone numbers to pinyin with diacritics.
 * e.g. "hao3" → "hǎo"
 */
const TONE_MAP: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'],
  e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'],
  o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'], // v is often used for ü
};

/** Which vowel gets the tone mark (standard pinyin rule) */
function findToneVowel(syllable: string): number {
  const lower = syllable.toLowerCase();
  // Rule: a or e always get the mark
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === 'a' || lower[i] === 'e') return i;
  }
  // Rule: ou → o gets the mark
  const ouIdx = lower.indexOf('ou');
  if (ouIdx !== -1) return ouIdx;
  // Otherwise: last vowel gets it
  for (let i = lower.length - 1; i >= 0; i--) {
    if ('aiouüv'.includes(lower[i])) return i;
  }
  return -1;
}

export function numericToDiacritic(pinyinNumeric: string): string {
  const tone = getToneNumber(pinyinNumeric);
  const base = pinyinNumeric.replace(/\d$/, '');

  if (tone === 5 || tone === 0) return base;

  const vowelIdx = findToneVowel(base);
  if (vowelIdx === -1) return base;

  const vowel = base[vowelIdx].toLowerCase();
  const mapped = TONE_MAP[vowel];
  if (!mapped) return base;

  const replacement = mapped[tone - 1];
  return base.slice(0, vowelIdx) + replacement + base.slice(vowelIdx + 1);
}

/** Convert a full pinyin-numeric string to diacritics: "ni3 hao3" → "nǐ hǎo" */
export function numericStringToDiacritic(pinyinNumeric: string): string {
  return pinyinNumeric
    .split(/\s+/)
    .map(numericToDiacritic)
    .join(' ');
}

/** Diacritic vowel → [base letter, tone number]. */
const DIACRITIC_MAP: Record<string, [string, number]> = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['ü', 1], ǘ: ['ü', 2], ǚ: ['ü', 3], ǜ: ['ü', 4],
};

/**
 * Coerce one syllable into the app's pinyinNumeric convention: lowercase ASCII
 * plus a tone digit 1-5, neutral written as 5.
 *
 * The model does not reliably obey that convention however firmly the prompt
 * states it — observed output includes "zhè4" (tone mark AND digit), "zhè"
 * (mark, no digit) and "si" (neither). Each variant produced a spurious
 * disagreement flag against a dictionary value that was actually equivalent,
 * so this is normalized mechanically rather than trusted.
 *
 * A syllable with no tone information at all is treated as neutral, which is
 * what a missing tone almost always means in practice ("yi4 si" → "yi4 si5").
 */
export function normalizePinyinSyllable(raw: string): string {
  let tone = 0;
  let base = '';
  for (const ch of raw.trim()) {
    const mapped = DIACRITIC_MAP[ch];
    if (mapped) {
      base += mapped[0];
      tone = mapped[1];
    } else if (/[1-5]/.test(ch)) {
      tone = Number(ch);
    } else if (ch === '0') {
      tone = 5; // pinyin-pro's neutral notation
    } else {
      base += ch;
    }
  }
  base = base.toLowerCase();
  if (!base) return '';
  return `${base}${tone || 5}`;
}

/** Apply normalizePinyinSyllable across a whole space-separated reading. */
export function normalizePinyinNumeric(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizePinyinSyllable)
    .filter(Boolean)
    .join(' ');
}
