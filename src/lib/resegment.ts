import { lookup } from './cedict';

export interface Resegmentable {
  surfaceForm: string;
  pinyinNumeric: string;
  english: string;
}

export interface ResegmentedToken<T extends Resegmentable> {
  /** Single input token when no merge happened; array of inputs when merged. */
  sources: T[];
  surfaceForm: string;
  /** When sources.length === 1, equal to sources[0].pinyinNumeric.
   *  When merged, empty — caller is expected to refill from CEDICT/LLM. */
  pinyinNumeric: string;
  /** Same semantics as pinyinNumeric — empty on merge. */
  english: string;
}

/**
 * Re-merge tokens the LLM split apart when CC-CEDICT has a compound
 * entry covering them. For example, if the LLM produced
 *   [哥, 哥, 来, 了]
 * and CEDICT has 哥哥 as one entry, return
 *   [哥哥 (sources: 哥 + 哥), 来, 了]
 * so downstream checkPinyin sees the compound headword and compares
 * the compound's canonical reading.
 *
 * Uses greedy left-to-right longest-match against CEDICT. Multi-character
 * tokens the LLM already produced are passed through untouched — only
 * runs of single-character tokens get considered for merging.
 *
 * The per-output `sources` array lets callers reach back to original
 * LLM data (e.g. to reconstruct per-character breakdowns after a merge).
 */
export function resegmentWithCedict<T extends Resegmentable>(
  tokens: T[],
  maxCompoundLen = 4,
): ResegmentedToken<T>[] {
  const result: ResegmentedToken<T>[] = [];
  let i = 0;

  while (i < tokens.length) {
    const current = tokens[i];

    if (current.surfaceForm.length !== 1) {
      result.push({
        sources: [current],
        surfaceForm: current.surfaceForm,
        pinyinNumeric: current.pinyinNumeric,
        english: current.english,
      });
      i++;
      continue;
    }

    let bestEnd = i;
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
      result.push({
        sources: tokens.slice(i, bestEnd + 1),
        surfaceForm: bestSurface,
        pinyinNumeric: '',
        english: '',
      });
      i = bestEnd + 1;
    } else {
      result.push({
        sources: [current],
        surfaceForm: current.surfaceForm,
        pinyinNumeric: current.pinyinNumeric,
        english: current.english,
      });
      i++;
    }
  }

  return result;
}
