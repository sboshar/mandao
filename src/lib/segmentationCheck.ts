import { lookup } from './cedict';

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

const MAX_COMPOUND_LEN = 4;

function cedictEnglish(headword: string): string {
  const entries = lookup(headword);
  if (entries.length === 0) return '';
  const first = entries[0].english.split('/').filter(Boolean)[0];
  return (first ?? '').trim();
}

/**
 * Scan a token list for runs of consecutive single-character tokens
 * whose concatenation matches a CEDICT compound entry. Emit one flag
 * per longest mergeable run so the review UI can offer a "Merge" action.
 *
 * The scan is greedy left-to-right: at each position, try the longest
 * compound that hits CEDICT (up to MAX_COMPOUND_LEN chars). If found,
 * emit a flag and skip past the run. Otherwise advance by one token.
 *
 * Skips multi-character tokens entirely — the LLM already committed
 * to those as compounds, and second-guessing them is outside this
 * helper's scope.
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
    let bestSurface = '';
    for (
      let j = i + 1;
      j < tokens.length && j - i < MAX_COMPOUND_LEN;
      j++
    ) {
      if (tokens[j].surfaceForm.length !== 1) break;
      const candidate = tokens
        .slice(i, j + 1)
        .map((t) => t.surfaceForm)
        .join('');
      if (lookup(candidate).length > 0) {
        bestEnd = j;
        bestSurface = candidate;
      }
    }

    if (bestEnd > i) {
      const indices = [];
      for (let k = i; k <= bestEnd; k++) indices.push(k);
      const entries = lookup(bestSurface);
      flags.push({
        kind: 'segmentation-disagreement',
        headword: bestSurface,
        llmValue: tokens
          .slice(i, bestEnd + 1)
          .map((t) => t.pinyinNumeric)
          .filter(Boolean)
          .join(' '),
        cedictSuggestions: entries.map((e) => e.pinyin.toLowerCase()),
        tokenIndices: indices,
        cedictEnglish: cedictEnglish(bestSurface),
      });
      i = bestEnd + 1;
    } else {
      i++;
    }
  }

  return flags;
}
