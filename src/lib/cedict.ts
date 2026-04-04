/**
 * CC-CEDICT dictionary loader and parser.
 * Loads the dictionary file via fetch and builds a trie for fast lookup.
 */
import { Trie, type DictEntry } from './trie';
export type { DictEntry };

let simplifiedTrie: Trie | null = null;
let traditionalTrie: Trie | null = null;
let loaded = false;
let loading: Promise<void> | null = null;

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
    for (const line of lines) {
      if (line.trim() === '' || line[0] === '#') continue;
      const entry = parseLine(line);
      if (!entry) continue;
      simplifiedTrie.push(entry.simplified, entry);
      traditionalTrie.push(entry.traditional, entry);
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

/** Look up all entries that start with the given prefix */
export function lookupPrefix(prefix: string): DictEntry[] {
  if (!simplifiedTrie || !traditionalTrie) return [];
  const simplified = simplifiedTrie.getPrefix(prefix);
  const traditional = traditionalTrie.getPrefix(prefix);
  return [...simplified, ...traditional];
}
