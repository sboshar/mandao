import { describe, it, expect, beforeAll } from 'vitest';
import { checkPinyin } from './checkPinyin';
import { loadCedict } from './cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

beforeAll(async () => {
  const text = readFileSync(resolve(__dirname, '../../public/cedict.txt'), 'utf-8');
  // @ts-expect-error -- test shim
  global.fetch = async () => ({ text: async () => text, ok: true });
  await loadCedict();
});

describe('checkPinyin — observation only', () => {
  it('returns no flag when LLM value exactly matches a CEDICT reading', () => {
    const r = checkPinyin('渴', 'ke3');
    expect(r.flag).toBeNull();
  });

  it('returns no flag when LLM picks a valid polyphone reading', () => {
    // 行: [hang2] /row; firm/ and [xing2] /walk; to do/
    const r = checkPinyin('行', 'hang2');
    expect(r.flag).toBeNull();
    expect(r.cedictSuggestions).toContain('hang2');
    expect(r.cedictSuggestions).toContain('xing2');
  });

  it('flags cedict-disagreement without modifying the value', () => {
    const r = checkPinyin('休息', 'xiu1 xi2');
    expect(r.flag?.kind).toBe('cedict-disagreement');
    expect(r.flag?.llmValue).toBe('xiu1 xi2');
    expect(r.flag?.cedictSuggestions).toContain('xiu1 xi5');
  });

  it('flags 哥哥 as disagreement when LLM emits ge1 ge1', () => {
    const r = checkPinyin('哥哥', 'ge1 ge1');
    expect(r.flag?.kind).toBe('cedict-disagreement');
    expect(r.flag?.cedictSuggestions).toContain('ge1 ge5');
  });

  it('flags cedict-unknown for words not in CEDICT', () => {
    const r = checkPinyin('佛系青年', 'fo2 xi4 qing1 nian2');
    expect(r.flag?.kind).toBe('cedict-unknown');
    expect(r.flag?.cedictSuggestions).toEqual([]);
  });

  describe('de-sandhi normalization', () => {
    it('accepts bu2 shi4 as matching the bu4 shi4 entry (LLM sandhi-contamination)', () => {
      // CEDICT has [bu2 shi5] /fault/ and [bu4 shi4] /is not/.
      // LLM's "bu2 shi4" is post-sandhi of bu4 shi4; de-sandhi matches.
      const r = checkPinyin('不是', 'bu2 shi4');
      expect(r.flag).toBeNull();
    });

    it('accepts yi2 ding4 as matching yi1 ding4 (一 sandhi before tone 4)', () => {
      // CEDICT has 一定 [yi1 ding4]. LLM's sandhi form yi2 ding4
      // de-sandhies to yi1 ding4 → exact match, no flag.
      const r = checkPinyin('一定', 'yi2 ding4');
      expect(r.flag).toBeNull();
    });
  });

  it('lowercase-normalizes so Wo3 matches wo3', () => {
    const r = checkPinyin('我', 'Wo3');
    expect(r.flag).toBeNull();
  });

  it('never returns the pinyin value — only observational metadata', () => {
    const r = checkPinyin('渴', 'whatever');
    // Result shape is { flag, cedictSuggestions } only.
    expect('pinyinNumeric' in r).toBe(false);
  });
});
