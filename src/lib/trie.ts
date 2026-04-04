/**
 * Trie data structure for efficient prefix lookup of dictionary entries.
 * Ported from chinese-tokenizer to browser-compatible ESM.
 */

export interface DictEntry {
  traditional: string;
  simplified: string;
  pinyin: string;
  english: string;
}

interface TrieNode {
  [key: string]: TrieNode | DictEntry[] | undefined;
  values?: DictEntry[];
}

export class Trie {
  private content: TrieNode = {};

  get(key: string): DictEntry[] {
    const obj = this.getKeyObject(key, false);
    return (obj?.values as DictEntry[]) || [];
  }

  getPrefix(key: string): DictEntry[] {
    return this.inner(key);
  }

  push(key: string, value: DictEntry): void {
    const obj = this.getKeyObject(key, true)!;
    if (!obj.values) obj.values = [];
    if (!(obj.values as DictEntry[]).includes(value)) {
      (obj.values as DictEntry[]).push(value);
    }
  }

  private getKeyObject(key: string, create: boolean): TrieNode | null {
    const chars = key === '' ? [key] : Array.from(key);
    let obj: TrieNode = this.content;

    for (const char of chars) {
      if (obj[char] == null) {
        if (create) obj[char] = {};
        else return null;
      }
      obj = obj[char] as TrieNode;
    }

    return obj;
  }

  private inner(key: string, obj?: TrieNode | null): DictEntry[] {
    if (obj === undefined) obj = this.getKeyObject(key, false);
    if (!obj) return [];

    const result: DictEntry[] = obj.values ? [...(obj.values as DictEntry[])] : [];

    for (const char in obj) {
      if (char === 'values' || obj[char] == null) continue;
      result.push(...this.inner(key + char, obj[char] as TrieNode));
    }

    return result;
  }
}
