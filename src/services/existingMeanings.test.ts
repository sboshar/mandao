import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Records what the sweep asked for, so we can assert on the candidate set. */
const asked: string[] = [];
const deck = new Map<string, { headword: string; pinyinNumeric: string; englishShort: string }[]>();

vi.mock('../db/repo', () => ({
  getMeaningsByHeadword: async (headword: string) => {
    asked.push(headword);
    return deck.get(headword) ?? [];
  },
}));
vi.mock('../lib/meaningPinyin', () => ({
  getMeaningPinyin: (m: { pinyinNumeric: string }) => m.pinyinNumeric,
}));

const { getExistingMeanings } = await import('./llmPrompt');

function stock(headword: string, pinyinNumeric: string, englishShort: string) {
  deck.set(headword, [{ headword, pinyinNumeric, englishShort }]);
}

beforeEach(() => {
  asked.length = 0;
  deck.clear();
});

describe('getExistingMeanings', () => {
  it('finds multi-character words, not only characters', () => {
    // The bug: 忘我 was stored as "engrossed", the sweep looked up 忘 and 我
    // only, so the model was never told and glossed it "forget self" — forking
    // a second row for a word that already had one.
    stock('忘我', 'wang4 wo3', 'engrossed');
    return getExistingMeanings('她读书忘我').then((r) => {
      expect(r.map((m) => m.headword)).toContain('忘我');
      expect(r.find((m) => m.headword === '忘我')?.english).toBe('engrossed');
    });
  });

  it('still finds single characters', async () => {
    stock('我', 'wo3', 'I');
    const r = await getExistingMeanings('忘我');
    expect(r.map((m) => m.headword)).toContain('我');
  });

  it('queries every substring up to the headword cap', async () => {
    await getExistingMeanings('忘我');
    expect(asked).toContain('忘');
    expect(asked).toContain('我');
    expect(asked).toContain('忘我');
  });

  it('deduplicates repeated substrings', async () => {
    // 我 appears twice; querying it twice would be wasted work.
    await getExistingMeanings('我和我');
    expect(asked.filter((h) => h === '我')).toHaveLength(1);
  });

  it('does not sweep beyond the headword cap', async () => {
    await getExistingMeanings('一二三四五六七');
    expect(asked.every((h) => Array.from(h).length <= 6)).toBe(true);
  });

  it('puts longer headwords first', async () => {
    stock('我', 'wo3', 'I');
    stock('忘', 'wang4', 'forget');
    stock('忘我', 'wang4 wo3', 'engrossed');
    const r = await getExistingMeanings('忘我');
    expect(r[0].headword).toBe('忘我');
  });

  it('returns nothing for a sentence with no stored meanings', async () => {
    expect(await getExistingMeanings('忘我')).toEqual([]);
  });

  it('ignores whitespace', async () => {
    stock('忘我', 'wang4 wo3', 'engrossed');
    const r = await getExistingMeanings('她 读书 忘我');
    expect(r.map((m) => m.headword)).toContain('忘我');
  });
});
