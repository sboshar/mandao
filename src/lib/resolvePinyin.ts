import { lookup, type DictEntry } from './cedict';

export type FlagKind =
  | 'auto-corrected'
  | 'polyphone-coerced'
  | 'cedict-disagreement'
  | 'cedict-unknown'
  | 'format-violation';

export interface ResolvePinyinFlag {
  kind: FlagKind;
  headword: string;
  llmValue: string;
  chosenValue: string;
  cedictSuggestions: string[];
}

export interface ResolvePinyinResult {
  /** The pinyin to persist. */
  pinyinNumeric: string;
  /** Non-null when the resolution wasn't a clean pass-through. */
  flag: ResolvePinyinFlag | null;
}

const NUMERIC_FORMAT = /^[a-z]+[1-5](\s[a-z]+[1-5])*$/;

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/**
 * Character-level Levenshtein on space-collapsed pinyin. Scales with
 * how different the two readings actually are.
 *   "xing4" vs "xing2"   → 1  (one-character tone swap)
 *   "xing4" vs "hang2"   → 3  (h/x, i/a, tone)
 *   "xiu1xi2" vs "xiu1xi5" → 1
 *   "ge1ge1" vs "ge1ge5" → 1
 */
function charEditDistance(a: string, b: string): number {
  const as = collapse(a);
  const bs = collapse(b);
  const m = as.length;
  const n = bs.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = as[i - 1] === bs[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function pickClosest(
  llmValue: string,
  entries: DictEntry[],
): { entry: DictEntry; distance: number } {
  const normalized = normalize(llmValue);
  let best = entries[0];
  let bestDist = charEditDistance(normalized, normalize(best.pinyin));
  for (let i = 1; i < entries.length; i++) {
    const d = charEditDistance(normalized, normalize(entries[i].pinyin));
    if (d < bestDist) {
      best = entries[i];
      bestDist = d;
    }
  }
  return { entry: best, distance: bestDist };
}

/**
 * "LLM proposes, CEDICT disposes." Decides what pinyin to actually persist
 * for a single token, given the LLM's output.
 *
 *   0 CEDICT entries   → keep LLM value; flag cedict-unknown.
 *   1 CEDICT entry     → overwrite with CEDICT. Flag auto-corrected if it
 *                        differed from LLM.
 *  ≥2 CEDICT entries   → if LLM matches one, accept. Else if close enough
 *                        (edit distance ≤ COERCE_THRESHOLD), coerce and
 *                        flag polyphone-coerced. Else flag cedict-
 *                        disagreement but keep LLM value (novel pronunciation).
 *
 * Format violations (diacritics, weird spacing) are flagged but NOT fixed
 * here — the caller should prefer retrying the LLM.
 */
export function resolvePinyin(
  headword: string,
  llmValue: string,
): ResolvePinyinResult {
  const normalized = normalize(llmValue);

  if (!NUMERIC_FORMAT.test(normalized)) {
    return {
      pinyinNumeric: normalized,
      flag: {
        kind: 'format-violation',
        headword,
        llmValue,
        chosenValue: normalized,
        cedictSuggestions: [],
      },
    };
  }

  const entries = lookup(headword);
  const cedictSuggestions = entries.map((e) => e.pinyin.toLowerCase());

  if (entries.length === 0) {
    return {
      pinyinNumeric: normalized,
      flag: {
        kind: 'cedict-unknown',
        headword,
        llmValue,
        chosenValue: normalized,
        cedictSuggestions: [],
      },
    };
  }

  if (entries.length === 1) {
    const canonical = entries[0].pinyin.toLowerCase();
    if (collapse(normalized) === collapse(canonical)) {
      return { pinyinNumeric: canonical, flag: null };
    }
    return {
      pinyinNumeric: canonical,
      flag: {
        kind: 'auto-corrected',
        headword,
        llmValue,
        chosenValue: canonical,
        cedictSuggestions,
      },
    };
  }

  // Polyphone: multiple CEDICT entries.
  const match = entries.find(
    (e) => collapse(e.pinyin) === collapse(normalized),
  );
  if (match) {
    return { pinyinNumeric: match.pinyin.toLowerCase(), flag: null };
  }

  const COERCE_THRESHOLD = 1;
  const { entry, distance } = pickClosest(llmValue, entries);
  if (distance <= COERCE_THRESHOLD) {
    return {
      pinyinNumeric: entry.pinyin.toLowerCase(),
      flag: {
        kind: 'polyphone-coerced',
        headword,
        llmValue,
        chosenValue: entry.pinyin.toLowerCase(),
        cedictSuggestions,
      },
    };
  }

  return {
    pinyinNumeric: normalized,
    flag: {
      kind: 'cedict-disagreement',
      headword,
      llmValue,
      chosenValue: normalized,
      cedictSuggestions,
    },
  };
}
