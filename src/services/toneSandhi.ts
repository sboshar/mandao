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

/**
 * Apply tone sandhi rules to a sequence of pinyin-numeric syllables.
 * Returns a new array with sandhi applied.
 *
 * Rules implemented:
 * 1. Third tone sandhi: 3+3 → 2+3
 * 2. 不 (bù) before 4th tone → bú (2nd)
 * 3. 一 (yī) before 4th → yí (2nd), before 1st/2nd/3rd → yì (4th)
 */
export function applyToneSandhi(syllables: string[]): string[] {
  const result = [...syllables];

  for (let i = 0; i < result.length - 1; i++) {
    const current = result[i].toLowerCase();
    const nextTone = getToneNumber(result[i + 1]);

    // Rule 1: Third tone sandhi
    if (getToneNumber(current) === 3 && nextTone === 3) {
      result[i] = setToneNumber(result[i], 2);
    }

    // Rule 2: 不 sandhi
    if (current === 'bu4' && nextTone === 4) {
      result[i] = 'bu2';
    }

    // Rule 3: 一 sandhi
    if (current === 'yi1') {
      if (nextTone === 4) {
        result[i] = 'yi2';
      } else if (nextTone >= 1 && nextTone <= 3) {
        result[i] = 'yi4';
      }
    }
  }

  return result;
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
