/**
 * CC-CEDICT dictionary loader and parser.
 * Loads the dictionary file via fetch and builds a trie for fast lookup.
 */
import { Trie, type DictEntry } from './trie';
import { wordFrequencyScore } from './charFrequency';
export type { DictEntry };

let simplifiedTrie: Trie | null = null;
let traditionalTrie: Trie | null = null;
let allEntries: DictEntry[] = [];
/** Map from tone-stripped pinyin (no spaces) → entries, built at load time */
let pinyinIndex: Map<string, DictEntry[]> | null = null;
let loaded = false;
let loading: Promise<void> | null = null;

/** Strip tone numbers and spaces from pinyin: "ni3 hao3" → "nihao" */
function stripTones(pinyin: string): string {
  return pinyin.replace(/[0-9\s]/g, '').toLowerCase();
}

function parseLine(line: string): DictEntry | null {
  const match = line.match(/^(\S+)\s(\S+)\s\[([^\]]+)\]\s\/(.+)\//);
  if (!match) return null;

  const [, traditional, simplified, pinyin, english] = match;
  return {
    traditional,
    simplified,
    pinyin: pinyin.replace(/u:/g, 'ü'),
    english,
  };
}

export async function loadCedict(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;

  loading = (async () => {
    const resp = await fetch('/cedict.txt');
    const text = await resp.text();

    simplifiedTrie = new Trie();
    traditionalTrie = new Trie();

    const lines = text.split('\n');
    const entries: DictEntry[] = [];
    for (const line of lines) {
      if (line.trim() === '' || line[0] === '#') continue;
      const entry = parseLine(line);
      if (!entry) continue;
      entries.push(entry);
      simplifiedTrie.push(entry.simplified, entry);
      traditionalTrie.push(entry.traditional, entry);
    }
    allEntries = entries;

    // Build pinyin index
    pinyinIndex = new Map();
    for (const entry of entries) {
      const key = stripTones(entry.pinyin);
      if (!key) continue;
      const list = pinyinIndex.get(key);
      if (list) list.push(entry);
      else pinyinIndex.set(key, [entry]);
    }

    loaded = true;
  })();

  return loading;
}

export function isLoaded(): boolean {
  return loaded;
}

/** Look up exact word */
export function lookup(word: string): DictEntry[] {
  if (!simplifiedTrie || !traditionalTrie) return [];
  const simplified = simplifiedTrie.get(word);
  const traditional = traditionalTrie.get(word);
  return simplified.length > 0 ? simplified : traditional;
}

/** Look up entries by English word (whole-word match against definitions).
 *  Accepts multiple word forms to check (e.g. "lives", "live", "to live"). */
export function lookupByEnglish(words: string[], limit = 50): DictEntry[] {
  if (allEntries.length === 0) return [];
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(`\\b(?:${pattern})\\b`, 'i');
  const results: DictEntry[] = [];
  for (const entry of allEntries) {
    if (re.test(entry.english)) {
      results.push(entry);
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** Look up all entries that start with the given prefix */
export function lookupPrefix(prefix: string): DictEntry[] {
  if (!simplifiedTrie || !traditionalTrie) return [];
  const simplified = simplifiedTrie.getPrefix(prefix);
  const traditional = traditionalTrie.getPrefix(prefix);
  return [...simplified, ...traditional];
}

/**
 * Extract tone numbers from raw input like "wo3men2" → ["3","2"]
 * Returns empty array if no tones provided.
 */
function extractTones(input: string): string[] {
  return Array.from(input.matchAll(/[1-5]/g), (m) => m[0]);
}

/**
 * Check if a CEDICT entry's pinyin matches the tone pattern the user typed.
 * e.g. user "wo3" → entry "wo3" matches, "wo4" does not.
 */
function matchesTonePattern(entryPinyin: string, inputTones: string[]): boolean {
  if (inputTones.length === 0) return true; // no tones specified, everything matches
  const entryTones = extractTones(entryPinyin);
  // Compare tone-by-tone up to the length the user specified
  for (let i = 0; i < inputTones.length && i < entryTones.length; i++) {
    if (inputTones[i] !== entryTones[i]) return false;
  }
  return true;
}

/**
 * Look up CEDICT entries by pinyin.
 * Strips tone numbers for matching, but uses them to rank results.
 * Input like "wo3" matches "wo" entries, with tone 3 results first.
 * Input like "nihao" matches entries with pinyin "ni3 hao3".
 */
export function lookupByPinyin(input: string, limit = 30): DictEntry[] {
  if (!pinyinIndex) return [];
  const query = stripTones(input);
  if (!query) return [];

  const inputTones = extractTones(input);

  const exact: DictEntry[] = [];
  const prefix: DictEntry[] = [];

  for (const [key, entries] of pinyinIndex) {
    if (key === query) {
      exact.push(...entries);
    } else if (key.startsWith(query)) {
      prefix.push(...entries);
    }
  }

  // Sort: tone match first, then shorter words, then character frequency
  const sortFn = (a: DictEntry, b: DictEntry) => {
    const aTone = matchesTonePattern(a.pinyin, inputTones) ? 0 : 1;
    const bTone = matchesTonePattern(b.pinyin, inputTones) ? 0 : 1;
    if (aTone !== bTone) return aTone - bTone;
    const lenDiff = a.simplified.length - b.simplified.length;
    if (lenDiff !== 0) return lenDiff;
    return wordFrequencyScore(a.simplified) - wordFrequencyScore(b.simplified);
  };
  exact.sort(sortFn);
  prefix.sort(sortFn);

  return [...exact, ...prefix].slice(0, limit);
}
