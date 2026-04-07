/**
 * Character-by-character comparison of recognized speech against target.
 */

export interface CharResult {
  char: string;
  heard: string | null;
  status: 'match' | 'mismatch' | 'missing';
}

const PUNCT = /[\s，。！？、；：""''（）【】《》,.!?;:()"'\u3000\u200b]/g;

function normalize(s: string): string[] {
  return [...s.replace(PUNCT, '')];
}

/**
 * Compare recognized text against target sentence character by character.
 * Returns one result per target character (after stripping punctuation).
 */
export function compareCharacters(target: string, recognized: string): CharResult[] {
  const targetChars = normalize(target);
  const recogChars = normalize(recognized);

  return targetChars.map((char, i) => {
    if (i >= recogChars.length) {
      return { char, heard: null, status: 'missing' as const };
    }
    return {
      char,
      heard: recogChars[i],
      status: char === recogChars[i] ? 'match' as const : 'mismatch' as const,
    };
  });
}

/** Calculate match percentage */
export function matchPercent(results: CharResult[]): number {
  if (results.length === 0) return 0;
  const matches = results.filter((r) => r.status === 'match').length;
  return Math.round((matches / results.length) * 100);
}
