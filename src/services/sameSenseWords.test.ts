import { describe, it, expect } from 'vitest';
import { buildSameSensePrompt, parseSameSense } from './sameSenseWords';
import type { CharWord } from './charWords';

const cands: CharWord[] = [
  { word: '长大', pinyin: 'zhang3 da4', gloss: 'to grow up', position: 0, reading: 'zhang3' },
  { word: '校长', pinyin: 'xiao4 zhang3', gloss: 'headmaster', position: 1, reading: 'zhang3' },
  { word: '长相', pinyin: 'zhang3 xiang4', gloss: 'appearance', position: 0, reading: 'zhang3' },
];

describe('parseSameSense', () => {
  it('resolves numbers to words, keeping the model’s order', () => {
    const r = parseSameSense('{"reasoning":"growth","keep":[3,1]}', cands);
    expect(r.words.map((w) => w.word)).toEqual(['长相', '长大']);
    expect(r.reasoning).toBe('growth');
    expect(r.droppedInvalid).toBe(0);
  });

  it('cannot return a word that was not offered', () => {
    // The whole reason the model picks numbers. Even a reply naming a plausible
    // word outright yields nothing, because there is no path from text to a
    // result.
    const r = parseSameSense(
      '{"reasoning":"x","keep":["长征","生长",99,0,-1]}',
      cands,
    );
    expect(r.words).toEqual([]);
    expect(r.droppedInvalid).toBe(5);
  });

  it('counts out-of-range indexes instead of silently dropping them', () => {
    const r = parseSameSense('{"keep":[1,7]}', cands);
    expect(r.words.map((w) => w.word)).toEqual(['长大']);
    expect(r.droppedInvalid).toBe(1);
  });

  it('ignores a repeated index without counting it as invalid', () => {
    const r = parseSameSense('{"keep":[1,1,2]}', cands);
    expect(r.words.map((w) => w.word)).toEqual(['长大', '校长']);
    expect(r.droppedInvalid).toBe(0);
  });

  it('rejects non-integers, which would otherwise index nowhere', () => {
    const r = parseSameSense('{"keep":[1.5,"2x",null,true]}', cands);
    // "2x" and true coerce to NaN / 1 respectively — only genuine integers pass.
    expect(r.words.every((w) => cands.includes(w))).toBe(true);
    expect(r.words.length).toBeLessThanOrEqual(1);
  });

  it('survives code fences and a preamble', () => {
    const r = parseSameSense(
      'Sure!\n```json\n{"reasoning":"r","keep":[2]}\n```',
      cands,
    );
    expect(r.words.map((w) => w.word)).toEqual(['校长']);
  });

  it('treats a missing keep array as an empty result, not a crash', () => {
    expect(parseSameSense('{"reasoning":"none"}', cands).words).toEqual([]);
  });

  it('throws on unparseable output so the caller can say so', () => {
    expect(() => parseSameSense('not json at all', cands)).toThrow();
  });
});

describe('buildSameSensePrompt', () => {
  it('numbers every candidate and states the sense being matched', () => {
    const p = buildSameSensePrompt('长', 'zhang3', 'to grow', cands);
    expect(p).toContain('[1] 长大');
    expect(p).toContain('[3] 长相');
    expect(p).toContain('"to grow"');
    expect(p).toContain('长 (zhang3)');
  });

  it('tells the model to return numbers only, never words', () => {
    const p = buildSameSensePrompt('长', 'zhang3', 'to grow', cands);
    expect(p).toMatch(/ONLY numbers/i);
    expect(p).toMatch(/do not invent/i);
  });

  it('asks for commonest-first ordering', () => {
    const p = buildSameSensePrompt('长', 'zhang3', 'to grow', cands);
    expect(p).toMatch(/commonest\s+first/i);
  });

  it('names the two exclusions that reading alone cannot catch', () => {
    const p = buildSameSensePrompt('西', 'xi1', 'west', cands);
    // A different sense under the same reading, and a purely phonetic use.
    expect(p).toMatch(/pronounced the same/i);
    expect(p).toMatch(/for its sound/i);
  });
});
