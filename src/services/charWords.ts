/**
 * Other words that use a character (#204).
 *
 * You reach 西 through 东西 and the character looks arbitrary — east, in a word
 * meaning "thing". It stops looking arbitrary once you see it working in 西边,
 * 西装, 西瓜. The character breakdown linked to 西 and stopped there.
 *
 * THE CANDIDATE LIST IS A LOOKUP, NOT A MODEL CALL. CC-CEDICT is already loaded
 * and precached, and the reasons to use it are less about hallucination than
 * about recall and arithmetic: it returns ALL 169 words where 长 is read zhang3,
 * where a model returns the dozen it thinks of and cannot tell you what it
 * missed — and "not already in your deck" needs the full set to subtract from.
 * It is also free, instant and works offline. Anything a model generated would
 * have to be checked against this dictionary anyway.
 *
 * READING SPLITS THE MORPHEMES. A quarter of the 300 most-used characters have
 * more than one reading, and two readings are usually two unrelated words
 * sharing a shape. Comparing the character's reading inside each word against
 * the reading of the sense being studied separates 长大 (zhang3) from 长城
 * (chang2) with no judgement involved.
 *
 * WHAT READING CANNOT DO is separate senses within one reading: 长 as zhang3 is
 * both "chief" (部长, 家长) and "to grow" (长大, 长相). That distinction is a
 * judgement, and it lives in sameSenseWords.ts behind an explicit request.
 */
import {
  lookupContaining,
  characterReadings,
  loadCedict,
  type ContainingWord,
} from '../lib/cedict';
import { normalizePinyinSyllable } from './toneSandhi';
import * as repo from '../db/repo';

export interface CharWord {
  /** Simplified headword, e.g. 长大. */
  word: string;
  /** Reading of the whole word. */
  pinyin: string;
  /** First CEDICT gloss, trimmed. */
  gloss: string;
  /** Index of the character within the word. */
  position: number;
  /** How the character is read here — the polyphone discriminator. */
  reading: string | null;
  /** Set when the deck already has this word, so it can link to the card. */
  meaningId?: string;
}

export interface OtherReadingGroup {
  /** e.g. "chang2". */
  reading: string;
  /** The character's own gloss at that reading, from CEDICT. */
  gloss: string;
  words: CharWord[];
}

export interface CharWordGroups {
  /** The reading being studied, normalized. null when it could not be read. */
  reading: string | null;
  /** Same reading, already in the deck. */
  known: CharWord[];
  /** Same reading, not in the deck — the pool worth recommending from. */
  candidates: CharWord[];
  /** Words where the character is a different morpheme that shares the glyph. */
  otherReadings: OtherReadingGroup[];
}

/** Scanned wide, because reading-filtering then discards most of it. */
const SCAN = 600;
/** Enough to rank meaningfully without sending a wall of text to a model. */
const MAX_CANDIDATES = 40;
const MAX_KNOWN = 20;
const MAX_PER_OTHER_READING = 8;

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
    reading: hit.reading,
  };
}

/**
 * Words containing `char`, split by reading and by whether the deck has them.
 *
 * `charReading` is the reading of the sense being looked at, in any notation —
 * it gets normalized here, since the deck stores "zhang3" while a caller might
 * hold "zhǎng". Passing nothing means no reading split is possible, and
 * everything lands in `candidates` rather than being silently mixed under a
 * heading that claims one morpheme.
 */
export async function getWordsUsingChar(
  char: string,
  charReading?: string,
): Promise<CharWordGroups> {
  // Idempotent, and already resolved on boot in practice — but a lookup against
  // an unloaded trie returns silently empty, which would read as "no words use
  // this character" rather than "the dictionary isn't ready".
  await loadCedict();

  const target = charReading ? normalizePinyinSyllable(charReading) : '';
  const hits = lookupContaining(char, SCAN);
  if (hits.length === 0) {
    return { reading: target || null, known: [], candidates: [], otherReadings: [] };
  }

  // One pass over the deck rather than a query per candidate: dozens of headword
  // lookups would be dozens of IndexedDB round trips for a list that renders at
  // once.
  const all = await repo.getAllMeanings();
  const byHeadword = new Map<string, string>();
  for (const m of all) {
    if (!byHeadword.has(m.headword)) byHeadword.set(m.headword, m.id);
  }

  const known: CharWord[] = [];
  const candidates: CharWord[] = [];
  const others = new Map<string, CharWord[]>();

  for (const hit of hits) {
    const cw = toCharWord(hit);
    const meaningId = byHeadword.get(cw.word);

    // A word whose syllables did not line up (reading === null) is treated as
    // same-reading rather than dropped: it is far more likely to be an odd entry
    // than a different morpheme, and hiding real words is the worse error.
    const sameMorpheme =
      !target || cw.reading === null || cw.reading === target;

    if (!sameMorpheme) {
      const list = others.get(cw.reading!);
      if (list) list.push(cw);
      else others.set(cw.reading!, [cw]);
      continue;
    }

    if (meaningId) known.push({ ...cw, meaningId });
    else candidates.push(cw);
  }

  // Label each other reading with the character's own gloss at that reading, so
  // it reads as "cháng — length" rather than an unexplained exclusion. Seeing
  // that a character HAS a second reading is worth more than a tidy list.
  const glossFor = new Map(
    characterReadings(char).map((r) => [r.reading, r.gloss]),
  );
  const otherReadings: OtherReadingGroup[] = [...others]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([reading, words]) => ({
      reading,
      gloss: glossFor.get(reading) ?? '',
      words: words.slice(0, MAX_PER_OTHER_READING),
    }));

  return {
    reading: target || null,
    known: known.slice(0, MAX_KNOWN),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    otherReadings,
  };
}
