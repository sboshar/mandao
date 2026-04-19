/**
 * Per-character pinyin lookup used by speech-comparison UIs.
 *
 * Prefers any Meaning already ingested for a character (so user-specific
 * readings win), then falls back to CC-CEDICT. Returns the input char
 * unchanged if neither source has an entry — keeps the comparison grid
 * from collapsing when a character is unknown.
 */
import * as repo from '../db/repo';
import { lookup } from './cedict';
import { numericStringToDiacritic } from '../services/toneSandhi';

export async function lookupPinyinForChars(chars: string[]): Promise<string[]> {
  const parts: string[] = [];
  for (const char of chars) {
    const meanings = await repo.getMeaningsByHeadword(char);
    const meaning = meanings[0] ?? null;
    if (meaning) {
      parts.push(meaning.pinyin);
      continue;
    }
    const entries = lookup(char);
    if (entries.length > 0) {
      parts.push(numericStringToDiacritic(entries[0].pinyin));
      continue;
    }
    parts.push(char);
  }
  return parts;
}
