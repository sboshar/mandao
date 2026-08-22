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

/** Longest multi-character compound in CEDICT worth scanning for. */
export const MAX_CEDICT_COMPOUND_LEN = 4;

/** First English gloss for a headword ("older brother" from "/older brother/CL:個/").
 *  Empty string when the headword isn't in CEDICT or has no gloss. */
export function firstGloss(headword: string): string {
  if (!simplifiedTrie) return '';
  const entries = lookup(headword);
  if (entries.length === 0) return '';
  const gloss = entries[0].english.split('/').filter(Boolean)[0];
  return (gloss ?? '').trim();
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

/** A CEDICT word that contains some character, and where it sits (#204). */
export interface ContainingWord {
  entry: DictEntry;
  /** Index of the character inside the simplified headword. */
  position: number;
  /**
   * How the character itself is read in THIS word — zhang3 in 长大, chang2 in
   * 长城 — lowercased, tone digit kept.
   *
   * This is the polyphone disambiguator. A quarter of the 300 most-used
   * characters have more than one reading, and two readings of one glyph are
   * usually two unrelated morphemes: without this, "other words using 长" puts
   * 长城 (Great Wall) beside 长大 (to grow up) as though they shared anything
   * but a shape.
   *
   * null when the word's syllables do not line up one per character, which
   * happens for 18 of CEDICT's 116,937 entries — rare enough to skip rather
   * than guess at.
   */
  reading: string | null;
}

function readingAt(entry: DictEntry, position: number): string | null {
  const syllables = entry.pinyin.split(/\s+/).filter(Boolean);
  if (syllables.length !== entry.simplified.length) return null;
  return syllables[position]?.toLowerCase() ?? null;
}

/** Each distinct reading of a single character, with its own first gloss.
 *  Lets a different-reading group be labelled "cháng — length" from the
 *  dictionary rather than left as an unexplained omission. */
export function characterReadings(
  char: string,
): { reading: string; gloss: string }[] {
  const out = new Map<string, string>();
  for (const entry of lookup(char)) {
    const reading = entry.pinyin.replace(/\s+/g, '').toLowerCase();
    const gloss = entry.english.split('/').filter(Boolean)[0]?.trim() ?? '';
    if (!out.has(reading) && gloss) out.set(reading, gloss);
  }
  return [...out].map(([reading, gloss]) => ({ reading, gloss }));
}

/** Count of senses, used as a rough frequency proxy. Established convention
 *  here — lookupByPinyin already ranks on it. */
function glossCount(entry: DictEntry): number {
  return entry.english.split('/').filter(Boolean).length;
}

/**
 * Proper nouns, by CEDICT's own convention of capitalizing their pinyin.
 *
 *   帕西 [Pa4 xi1]    Parsi
 *   廣西 [Guang3 xi1] Guangxi
 *   徹西 [Che4 xi1]   Chelsea
 *   東西 [dong1 xi5]  thing        <- lowercase
 *   西瓜 [xi1 gua1]   watermelon   <- lowercase
 *
 * Without this, a scan for 西 surfaces Parsi, Chelsea and three district names
 * above 东西 and 西瓜, because they all have one gloss and then fall back to
 * dictionary order. Place names are not what someone asking "what else uses
 * this character" wants first.
 */
function isProperNoun(entry: DictEntry): boolean {
  return /[A-Z]/.test(entry.pinyin);
}

/**
 * Every word that contains `char` somewhere other than as the whole word.
 *
 * This is a LOOKUP, not a judgement, which is why it belongs here rather than in
 * a prompt: asking a model for "words containing 西" invites invented compounds,
 * while a scan over the dictionary can only return words that exist.
 *
 * Ranking is admittedly rough. CC-CEDICT carries no frequency data, so this
 * sorts short-before-long (two-character compounds are overwhelmingly the common
 * ones) and then by sense count, which is the same weak proxy lookupByPinyin
 * uses. Good enough to put 西方 above some Ming-dynasty place name; not a real
 * frequency ranking, and shouldn't be described as one.
 */
export function lookupContaining(char: string, limit = 60): ContainingWord[] {
  if (allEntries.length === 0 || !char) return [];

  // Grouped, not first-seen-wins. A headword often has several entries and the
  // first is not the useful one: 東西 is [dong1 xi1] "east and west" followed by
  // [dong1 xi5] "thing/stuff/person", so keeping the first would show the
  // literal reading and discard the sense anyone actually means.
  const grouped = new Map<string, DictEntry[]>();
  for (const entry of allEntries) {
    const word = entry.simplified;
    // The character on its own is not a word "using" it.
    if (word === char || !word.includes(char)) continue;
    const list = grouped.get(word);
    if (list) list.push(entry);
    else grouped.set(word, [entry]);
  }

  const hits: ContainingWord[] = [];
  for (const [word, entries] of grouped) {
    // Richest sense represents the word, for both display and ranking.
    const best = entries.reduce((a, b) => (glossCount(b) > glossCount(a) ? b : a));
    const position = word.indexOf(char);
    hits.push({ entry: best, position, reading: readingAt(best, position) });
  }

  hits.sort((a, b) => {
    const byNoun = Number(isProperNoun(a.entry)) - Number(isProperNoun(b.entry));
    if (byNoun !== 0) return byNoun;
    const byLen = a.entry.simplified.length - b.entry.simplified.length;
    if (byLen !== 0) return byLen;
    return glossCount(b.entry) - glossCount(a.entry);
  });

  return hits.slice(0, limit);
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
