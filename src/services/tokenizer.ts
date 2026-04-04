/**
 * Chinese tokenizer service.
 * Uses CC-CEDICT trie for maximum-match segmentation in the browser.
 */
import { lookup, lookupPrefix, isLoaded, type DictEntry } from '../lib/cedict';
export type { DictEntry } from '../lib/trie';

const CHINESE_PUNCTUATION = new Set([
  '·', '×', '—', '\u2018', '\u2019', '\u201C', '\u201D', '…',
  '、', '。', '《', '》', '『', '』', '【', '】',
  '！', '（', '）', '，', '：', '；', '？',
]);

export interface Token {
  text: string;
  /** All dictionary matches for this token */
  matches: DictEntry[];
}

/**
 * Tokenize a Chinese sentence using maximum-match against CC-CEDICT.
 * Falls back to character-by-character if dictionary not loaded.
 */
export function tokenizeSentence(chinese: string): Token[] {
  const chars = Array.from(chinese.trim());
  if (chars.length === 0) return [];

  if (!isLoaded()) {
    // Fallback: split into individual characters
    return chars
      .filter((ch) => ch.trim().length > 0)
      .map((ch) => ({ text: ch, matches: [] }));
  }

  const result: Token[] = [];
  let i = 0;

  while (i < chars.length) {
    const char = chars[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Skip punctuation (Chinese and ASCII)
    if (CHINESE_PUNCTUATION.has(char) || /[.,!?;:'"()\-]/.test(char)) {
      result.push({ text: char, matches: [] });
      i++;
      continue;
    }

    // Try maximum match: start with longest possible substring
    if (i < chars.length - 1) {
      const twoChar = chars.slice(i, i + 2).join('');
      const prefixEntries = lookupPrefix(twoChar);

      let bestWord: string | null = null;
      let bestMatches: DictEntry[] = [];

      for (const entry of prefixEntries) {
        const matchText = entry.simplified;
        const wordLen = Array.from(matchText).length;
        const candidate = chars.slice(i, i + wordLen).join('');

        if (matchText === candidate) {
          if (!bestWord || Array.from(candidate).length > Array.from(bestWord).length) {
            bestWord = candidate;
            bestMatches = lookup(candidate);
          }
        }
      }

      if (bestWord) {
        result.push({ text: bestWord, matches: bestMatches });
        i += Array.from(bestWord).length;
        continue;
      }
    }

    // Single character match
    const matches = lookup(char);
    result.push({ text: char, matches });
    i++;
  }

  return result;
}
