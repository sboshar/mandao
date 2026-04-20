import { lookup } from './cedict';
import type { MeaningFlagKind } from '../db/schema';

export interface CheckPinyinFlag {
  kind: MeaningFlagKind;
  headword: string;
  /** What the pipeline saw when producing this flag. Not necessarily the
   *  value that ends up persisted — user may edit on the review screen. */
  llmValue: string;
  /** CEDICT readings for the headword at check time. Powers the
   *  "apply suggestion" buttons in the review UI. */
  cedictSuggestions: string[];
}

export interface CheckPinyinResult {
  flag: CheckPinyinFlag | null;
  /** All CEDICT readings for the headword. Empty when CEDICT doesn't
   *  know the word. Exposed so the UI can show alternatives even when
   *  no flag fires (e.g. polyphone confirmed match). */
  cedictSuggestions: string[];
}

export function normalizePinyin(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function collapsePinyin(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/**
 * Strip 不/一 tone-sandhi so the LLM's post-sandhi slip-ups still match
 * the citation-form CEDICT entry. Does NOT try to undo 3rd-tone sandhi
 * (that would require context we don't have here).
 */
function deSandhi(value: string): string {
  return value
    .split(/\s+/)
    .map((syl) => {
      if (syl === 'bu2') return 'bu4';
      if (syl === 'yi2' || syl === 'yi4') return 'yi1';
      return syl;
    })
    .join(' ');
}

/**
 * Compare the LLM's pinyin for a headword against CC-CEDICT.
 * OBSERVATION ONLY — never modifies the value. Returns a flag when the
 * LLM's value doesn't match any CEDICT reading (or CEDICT doesn't have
 * the word). The caller is responsible for deciding what to persist.
 */
export function checkPinyin(
  headword: string,
  llmValue: string,
): CheckPinyinResult {
  const entries = lookup(headword);
  const cedictSuggestions = entries.map((e) => e.pinyin.toLowerCase());

  if (entries.length === 0) {
    return {
      flag: {
        kind: 'cedict-unknown',
        headword,
        llmValue,
        cedictSuggestions: [],
      },
      cedictSuggestions: [],
    };
  }

  const normalized = collapsePinyin(deSandhi(normalizePinyin(llmValue)));
  const matches = entries.some(
    (e) => collapsePinyin(e.pinyin) === normalized,
  );
  if (matches) {
    return { flag: null, cedictSuggestions };
  }

  return {
    flag: {
      kind: 'cedict-disagreement',
      headword,
      llmValue,
      cedictSuggestions,
    },
    cedictSuggestions,
  };
}
