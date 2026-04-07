/**
 * CC-CEDICT dictionary loader and parser.
 * Loads the dictionary file via fetch and builds a trie for fast lookup.
 */
import { Trie, type DictEntry } from './trie';
export type { DictEntry };

let simplifiedTrie: Trie | null = null;
let traditionalTrie: Trie | null = null;
let pinyinTrie: Trie | null = null;
let allEntries: DictEntry[] = [];
let loaded = false;
let loading: Promise<void> | null = null;

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
    pinyinTrie = new Trie();

    const lines = text.split('\n');
    const entries: DictEntry[] = [];
    for (const line of lines) {
      if (line.trim() === '' || line[0] === '#') continue;
      const entry = parseLine(line);
      if (!entry) continue;
      entries.push(entry);
      simplifiedTrie.push(entry.simplified, entry);
      traditionalTrie.push(entry.traditional, entry);
      const pyKey = stripTones(entry.pinyin);
      if (pyKey) pinyinTrie.push(pyKey, entry);
    }
    allEntries = entries;

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

function extractTones(input: string): string[] {
  return Array.from(input.matchAll(/[1-5]/g), (m) => m[0]);
}

function matchesTonePattern(entryPinyin: string, inputTones: string[]): boolean {
  if (inputTones.length === 0) return true;
  const entryTones = extractTones(entryPinyin);
  for (let i = 0; i < inputTones.length && i < entryTones.length; i++) {
    if (inputTones[i] !== entryTones[i]) return false;
  }
  return true;
}

/**
 * Look up CEDICT entries by pinyin. Strips tone numbers for trie lookup,
 * then uses them to rank results (tone match first, then shorter words,
 * then definition count as a frequency proxy). Deduplicates by simplified form.
 */
export function lookupByPinyin(input: string, limit = 30): DictEntry[] {
  if (!pinyinTrie) return [];
  const query = stripTones(input);
  if (!query) return [];

  const inputTones = extractTones(input);
  const exact = pinyinTrie.get(query);
  const allPrefix = pinyinTrie.getPrefix(query);
  // getPrefix includes exact matches, so filter them out for separate sorting
  const exactSet = new Set(exact);
  const prefix = allPrefix.filter((e) => !exactSet.has(e));

  const defCount = (e: DictEntry) => e.english.split('/').filter(Boolean).length;

  const sortFn = (a: DictEntry, b: DictEntry) => {
    const aTone = matchesTonePattern(a.pinyin, inputTones) ? 0 : 1;
    const bTone = matchesTonePattern(b.pinyin, inputTones) ? 0 : 1;
    if (aTone !== bTone) return aTone - bTone;
    const lenDiff = a.simplified.length - b.simplified.length;
    if (lenDiff !== 0) return lenDiff;
    return defCount(b) - defCount(a);
  };
  exact.sort(sortFn);
  prefix.sort(sortFn);

  // Deduplicate by simplified form, preserving sort order
  const seen = new Set<string>();
  const results: DictEntry[] = [];
  for (const entry of [...exact, ...prefix]) {
    if (seen.has(entry.simplified)) continue;
    seen.add(entry.simplified);
    results.push(entry);
    if (results.length >= limit) break;
  }
  return results;
}
