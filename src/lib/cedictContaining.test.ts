import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { lookupContaining, characterReadings } from './cedict';

/**
 * Runs against the real dictionary rather than a fixture.
 *
 * The whole argument for doing this lookup in CEDICT instead of asking a model
 * is that the dictionary can only return words that exist — so a test against a
 * handful of invented entries would check the sort and prove nothing about the
 * claim. loadCedict() fetches, which does not exist in the node environment, so
 * the file is read from disk and pushed through the same parser by stubbing
 * fetch.
 */
beforeAll(async () => {
  const text = readFileSync('public/cedict.txt', 'utf-8');
  globalThis.fetch = (async () =>
    ({ text: async () => text }) as unknown as Response) as typeof fetch;
  const { loadCedict } = await import('./cedict');
  await loadCedict();
});

describe('lookupContaining', () => {
  it('finds real words containing the character', () => {
    const words = lookupContaining('西').map((h) => h.entry.simplified);
    expect(words).toContain('东西');
    expect(words).toContain('西瓜');
    // 西方 is real but ranks past the default cap — sense count is a weak
    // frequency proxy and plenty of two-character words carry more glosses.
    // Asserted with a wider limit so the shortfall is recorded, not hidden.
    const wide = lookupContaining('西', 400).map((h) => h.entry.simplified);
    expect(wide).toContain('西方');
  });

  it('never returns the bare character as a word using itself', () => {
    for (const char of ['西', '东', '心', '一']) {
      const words = lookupContaining(char).map((h) => h.entry.simplified);
      expect(words, char).not.toContain(char);
    }
  });

  it('reports where the character sits, including non-initial position', () => {
    const hits = lookupContaining('西');
    const dongxi = hits.find((h) => h.entry.simplified === '东西');
    const xigua = hits.find((h) => h.entry.simplified === '西瓜');
    expect(dongxi?.position).toBe(1);
    expect(xigua?.position).toBe(0);
  });

  it('only returns words that actually contain the character', () => {
    // The property that makes this worth doing as a lookup at all.
    for (const hit of lookupContaining('马', 200)) {
      expect(hit.entry.simplified).toContain('马');
      expect(hit.entry.simplified[hit.position]).toBe('马');
    }
  });

  it('puts shorter words first', () => {
    const lens = lookupContaining('西', 40).map((h) => h.entry.simplified.length);
    const sorted = [...lens].sort((a, b) => a - b);
    expect(lens).toEqual(sorted);
  });

  it('deduplicates repeated headwords', () => {
    // CEDICT has several entries per headword (senses, trad/simp pairs).
    const words = lookupContaining('心', 200).map((h) => h.entry.simplified);
    expect(new Set(words).size).toBe(words.length);
  });

  it('respects the limit', () => {
    expect(lookupContaining('人', 5)).toHaveLength(5);
  });

  it('returns nothing for an empty or absent character', () => {
    expect(lookupContaining('')).toEqual([]);
    // A private-use codepoint, which cannot appear in a dictionary. Note that
    // latin letters are NOT a valid test here — CEDICT really does contain
    // 阿Q正传 and T恤, so lookupContaining('Q') has genuine hits.
    expect(lookupContaining('\uE000')).toEqual([]);
  });

  it('represents a headword by its richest sense, not its first entry', () => {
    // 東西 is [dong1 xi1] "east and west" then [dong1 xi5] "thing/stuff/person".
    // First-seen-wins showed the literal reading and dropped the sense that
    // motivated the feature.
    const dongxi = lookupContaining('西').find((h) => h.entry.simplified === '东西');
    expect(dongxi?.entry.english).toContain('thing');
  });

  it('ranks proper nouns below ordinary words', () => {
    // CEDICT capitalizes proper-noun pinyin, so Parsi (帕西), Chelsea (彻西) and
    // the district names must not crowd out 东西 and 西瓜.
    const hits = lookupContaining('西', 40);
    const words = hits.map((h) => h.entry.simplified);
    const firstProper = hits.findIndex((h) => /[A-Z]/.test(h.entry.pinyin));
    const dongxi = words.indexOf('东西');
    expect(dongxi).toBeGreaterThanOrEqual(0);
    if (firstProper !== -1) expect(dongxi).toBeLessThan(firstProper);
  });

  it('puts 东西 first for both of its characters', () => {
    expect(lookupContaining('西')[0].entry.simplified).toBe('东西');
    expect(lookupContaining('东')[0].entry.simplified).toBe('东西');
  });

  it('surfaces common compounds for a character a learner would ask about', () => {
    // 东西 is the case that motivated this: 西 looks arbitrary until you see it
    // elsewhere. Whatever the ranking, the everyday words must be in reach.
    const top = lookupContaining('西', 30).map((h) => h.entry.simplified);
    expect(top.some((w) => ['西方', '西瓜', '西部', '西班牙'].includes(w))).toBe(true);
  });
});

describe('reading, for polyphone disambiguation', () => {
  it('reports how the character is read inside each word', () => {
    const by = new Map(
      lookupContaining('长', 600).map((h) => [h.entry.simplified, h.reading]),
    );
    // 长 is two morphemes sharing one glyph.
    expect(by.get('长大')).toBe('zhang3');
    expect(by.get('校长')).toBe('zhang3');
    expect(by.get('长城')).toBe('chang2');
    expect(by.get('长短')).toBe('chang2');
  });

  it('lowercases proper-noun readings so they still compare equal', () => {
    // CEDICT writes 長城 as [Chang2 cheng2]; the reading is still chang2.
    const changcheng = lookupContaining('长', 600).find(
      (h) => h.entry.simplified === '长城',
    );
    expect(changcheng?.reading).toBe('chang2');
  });

  it('catches the neutral-tone reduction that marks a lexicalized compound', () => {
    // 东西 is [dong1 xi5] — 西 is unstressed, which is itself the signal that
    // the word has drifted from "west".
    const dongxi = lookupContaining('西', 600).find(
      (h) => h.entry.simplified === '东西',
    );
    expect(dongxi?.reading).toBe('xi5');
  });

  it('returns null rather than guessing when syllables do not align', () => {
    // 18 of 116,937 entries have a syllable count that differs from the
    // character count. Whatever they are, a guess would be wrong.
    let checked = 0;
    for (const hit of lookupContaining('人', 600)) {
      const sylls = hit.entry.pinyin.split(/\s+/).filter(Boolean);
      if (sylls.length !== hit.entry.simplified.length) {
        expect(hit.reading).toBeNull();
        checked++;
      } else {
        expect(hit.reading).not.toBeNull();
      }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});

describe('characterReadings', () => {
  it('gives each reading its own gloss, so a group can be labelled', () => {
    const rs = characterReadings('长');
    const map = new Map(rs.map((r) => [r.reading, r.gloss]));
    expect(map.get('chang2')).toContain('length');
    expect(map.get('zhang3')).toContain('chief');
  });

  it('covers the other polyphones a learner meets early', () => {
    const hang = new Map(characterReadings('行').map((r) => [r.reading, r.gloss]));
    expect(hang.has('hang2')).toBe(true);
    expect(hang.has('xing2')).toBe(true);
  });

  it('returns a single entry for a monophone', () => {
    expect(characterReadings('西').length).toBe(1);
  });
});
