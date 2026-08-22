/**
 * Other words that use a character (#204).
 *
 * Reached from a single-character meaning: you got to 西 through 东西, and the
 * next question is what else uses it — 西方, 西瓜, 西部. Seeing a character in
 * several words is how its meaning stops being an isolated flashcard fact.
 *
 * DELIBERATELY NOT A MODEL CALL. "Which words contain this character" is a
 * lookup, and CC-CEDICT is already loaded and precached for offline. A model
 * asked the same question will produce plausible compounds that do not exist,
 * and a learner has no way to tell which. The dictionary can only return real
 * words, costs nothing, and works on a plane.
 *
 * The one thing the dictionary cannot say is which of these you already study,
 * so that is joined on here from the deck.
 */
import { lookupContaining, loadCedict, type ContainingWord } from '../lib/cedict';
import * as repo from '../db/repo';

export interface CharWord {
  /** Simplified headword, e.g. 西方. */
  word: string;
  pinyin: string;
  /** First CEDICT gloss, trimmed. */
  gloss: string;
  /** Index of the character within the word. */
  position: number;
  /** Set when the deck already has this word, so it can link to the card. */
  meaningId?: string;
}

export interface CharWordGroups {
  /** Words the deck already holds — review material, not discovery. */
  known: CharWord[];
  /** Words not in the deck yet. */
  new: CharWord[];
}

function firstGloss(english: string): string {
  const parts = english.split('/').filter(Boolean);
  return (parts[0] ?? '').trim();
}

function toCharWord(hit: ContainingWord): CharWord {
  return {
    word: hit.entry.simplified,
    pinyin: hit.entry.pinyin,
    gloss: firstGloss(hit.entry.english),
    position: hit.position,
  };
}

/**
 * Words containing `char`, split by whether the deck already has them.
 *
 * The split is the useful part. "Already know 西方" and "have never seen 西瓜"
 * call for different things — one is a connection to notice, the other is a
 * candidate to add — and mixing them makes the list read as undifferentiated
 * dictionary output.
 */
export async function getWordsUsingChar(
  char: string,
  limit = 60,
): Promise<CharWordGroups> {
  // Idempotent, and already resolved on boot in practice — but a lookup against
  // an unloaded trie returns silently empty, which would read as "no words use
  // this character" rather than "the dictionary isn't ready".
  await loadCedict();

  const hits = lookupContaining(char, limit);
  if (hits.length === 0) return { known: [], new: [] };

  // One pass over the deck rather than a query per candidate: 60 headword
  // lookups would be 60 IndexedDB round trips for a list that renders at once.
  const all = await repo.getAllMeanings();
  const byHeadword = new Map<string, string>();
  for (const m of all) {
    if (!byHeadword.has(m.headword)) byHeadword.set(m.headword, m.id);
  }

  const known: CharWord[] = [];
  const fresh: CharWord[] = [];
  for (const hit of hits) {
    const cw = toCharWord(hit);
    const meaningId = byHeadword.get(cw.word);
    if (meaningId) known.push({ ...cw, meaningId });
    else fresh.push(cw);
  }

  return { known, new: fresh };
}
