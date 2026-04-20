import { numericStringToDiacritic } from '../services/toneSandhi';
import type { Meaning } from '../db/schema';

/**
 * Canonical way to get a Meaning's diacritic pinyin for display.
 *
 * The stored diacritic field is being phased out in favor of a single
 * source of truth (pinyinNumeric). All read sites go through this helper
 * so future changes (caching, alternate derivations, sandhi rendering)
 * happen in one place.
 */
export function getMeaningPinyin(m: Pick<Meaning, 'pinyinNumeric'>): string {
  return numericStringToDiacritic(m.pinyinNumeric);
}
