import { lookup } from './cedict';

export interface Resegmentable {
  surfaceForm: string;
  pinyinNumeric: string;
  english: string;
}

/**
 * Re-merge tokens the LLM split apart when CC-CEDICT has a compound
 * entry covering them. For example, if the LLM produced
 *   [哥, 哥, 来, 了]
 * and CEDICT has 哥哥 as one entry, return
 *   [哥哥, 来, 了]
 * so downstream resolvePinyin sees the compound headword and applies
 * the compound's canonical reading (ge1 ge5) instead of character-level
 * readings (ge1 + ge1).
 *
 * Uses greedy left-to-right longest-match against CEDICT. Multi-character
 * tokens that the LLM already produced are passed through untouched —
 * only runs of single-character tokens get considered for merging.
 *
 * Merged pinyin / english are left to the caller to refill (we just emit
 * the new surfaceForm with empty strings so resolvePinyin / the LLM fill
 * them in).
 */
export function resegmentWithCedict<T extends Resegmentable>(
  tokens: T[],
  maxCompoundLen = 4,
): T[] {
  const result: T[] = [];
  let i = 0;

  while (i < tokens.length) {
    const current = tokens[i];

    // Passthrough multi-char tokens — LLM already committed to a compound.
    if (current.surfaceForm.length !== 1) {
      result.push(current);
      i++;
      continue;
    }

    // Try to find a longer CEDICT compound starting at this position
    // using consecutive single-char tokens.
    let bestEnd = i; // exclusive
    let bestSurface = current.surfaceForm;
    for (let j = i + 1; j < tokens.length && j - i < maxCompoundLen; j++) {
      if (tokens[j].surfaceForm.length !== 1) break;
      const candidate = tokens.slice(i, j + 1).map((t) => t.surfaceForm).join('');
      if (lookup(candidate).length > 0) {
        bestEnd = j;
        bestSurface = candidate;
      }
    }

    if (bestEnd > i) {
      // Found a compound — merge tokens [i..bestEnd].
      const merged: T = {
        ...current,
        surfaceForm: bestSurface,
        pinyinNumeric: '',
        english: '',
      };
      result.push(merged);
      i = bestEnd + 1;
    } else {
      result.push(current);
      i++;
    }
  }

  return result;
}
