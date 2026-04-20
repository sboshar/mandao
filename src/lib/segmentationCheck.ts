import { lookup, firstGloss, MAX_CEDICT_COMPOUND_LEN } from './cedict';

export interface SegmentationFlag {
  kind: 'segmentation-disagreement';
  /** The compound the run could be merged into, e.g. "哥哥". */
  headword: string;
  /** Concatenation of the current token pinyins, e.g. "ge1 ge1". */
  llmValue: string;
  /** CEDICT readings for the compound, e.g. ["ge1 ge5"]. */
  cedictSuggestions: string[];
  /** Indices in the token array that would be replaced by the merged token. */
  tokenIndices: number[];
  /** CEDICT gloss for the compound — fills the merged token's english. */
  cedictEnglish: string;
}

export interface SegmentationInput {
  surfaceForm: string;
  pinyinNumeric: string;
}

/**
 * Greedy left-to-right scan for runs of consecutive single-character
 * tokens whose concatenation hits a CEDICT compound. Emits one flag
 * per longest match; skips past the matched run. Multi-char tokens
 * are passed over — the LLM already committed to those as compounds.
 */
export function scanSegmentation(
  tokens: SegmentationInput[],
): SegmentationFlag[] {
  const flags: SegmentationFlag[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i].surfaceForm.length !== 1) {
      i++;
      continue;
    }

    let bestEnd = i;
    let bestEntries = lookup(tokens[i].surfaceForm);
    let bestSurface = '';
    for (
      let j = i + 1;
      j < tokens.length && j - i < MAX_CEDICT_COMPOUND_LEN;
      j++
    ) {
      if (tokens[j].surfaceForm.length !== 1) break;
      const candidate = tokens
        .slice(i, j + 1)
        .map((t) => t.surfaceForm)
        .join('');
      const entries = lookup(candidate);
      if (entries.length > 0) {
        bestEnd = j;
        bestSurface = candidate;
        bestEntries = entries;
      }
    }

    if (bestEnd > i) {
      const indices = [];
      for (let k = i; k <= bestEnd; k++) indices.push(k);
      flags.push({
        kind: 'segmentation-disagreement',
        headword: bestSurface,
        llmValue: tokens
          .slice(i, bestEnd + 1)
          .map((t) => t.pinyinNumeric)
          .filter(Boolean)
          .join(' '),
        cedictSuggestions: bestEntries.map((e) => e.pinyin.toLowerCase()),
        tokenIndices: indices,
        cedictEnglish: firstGloss(bestSurface),
      });
      i = bestEnd + 1;
    } else {
      i++;
    }
  }

  return flags;
}
