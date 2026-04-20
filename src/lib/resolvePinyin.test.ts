import { describe, it, expect, beforeAll } from 'vitest';
import { resolvePinyin } from './resolvePinyin';
import { loadCedict } from './cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

beforeAll(async () => {
  const text = readFileSync(resolve(__dirname, '../../public/cedict.txt'), 'utf-8');
  // @ts-expect-error -- test shim
  global.fetch = async () => ({ text: async () => text, ok: true });
  await loadCedict();
});

describe('resolvePinyin', () => {
  describe('single-reading headwords (CEDICT has exactly one entry)', () => {
    it('accepts matching LLM value with no flag', () => {
      const r = resolvePinyin('渴', 'ke3');
      expect(r.pinyinNumeric).toBe('ke3');
      expect(r.flag).toBeNull();
    });

    it('overwrites 哥哥 ge1 ge1 (LLM hallucination) with ge1 ge5 (CEDICT compound)', () => {
      const r = resolvePinyin('哥哥', 'ge1 ge1');
      expect(r.pinyinNumeric).toBe('ge1 ge5');
      expect(r.flag?.kind).toBe('auto-corrected');
      expect(r.flag?.llmValue).toBe('ge1 ge1');
      expect(r.flag?.chosenValue).toBe('ge1 ge5');
    });

    it('overwrites 休息 xi2 (LLM hallucination) with xi5 (CEDICT)', () => {
      const r = resolvePinyin('休息', 'xiu1 xi2');
      expect(r.pinyinNumeric).toBe('xiu1 xi5');
      expect(r.flag?.kind).toBe('auto-corrected');
    });

    it('overwrites even when LLM mechanically repeats character reading', () => {
      const r = resolvePinyin('我', 'wo4');
      expect(r.pinyinNumeric).toBe('wo3');
      expect(r.flag?.kind).toBe('auto-corrected');
    });
  });

  describe('polyphone headwords (CEDICT has multiple entries)', () => {
    it('accepts LLM value when it matches one of the listed readings', () => {
      // 黑 has [Hei1] (Heilongjiang) and [hei1] (black). LLM picks hei1.
      const r = resolvePinyin('黑', 'hei1');
      expect(r.pinyinNumeric).toBe('hei1');
      expect(r.flag).toBeNull();
    });

    it('coerces close miss to closest CEDICT reading (syllable edit dist 1)', () => {
      // 行 has [hang2] (row/firm) and [xing2] (walk/OK). LLM outputs
      // "xing4" — one-syllable-token edit distance 1 to xing2.
      const r = resolvePinyin('行', 'xing4');
      expect(r.pinyinNumeric).toBe('xing2');
      expect(r.flag?.kind).toBe('polyphone-coerced');
    });

    it('keeps LLM value when no close CEDICT reading (novel variant)', () => {
      // 行 entries are hang2 / xing2. "foo1 bar2 baz3" is syllabically
      // far from both (3-syllable vs 1-syllable, distance ≥ 3).
      const r = resolvePinyin('行', 'foo1 bar2 baz3');
      expect(r.flag?.kind).toBe('cedict-disagreement');
      expect(r.pinyinNumeric).toBe('foo1 bar2 baz3');
    });
  });

  describe('CEDICT miss (headword not in dictionary)', () => {
    it('keeps LLM value and flags cedict-unknown', () => {
      const r = resolvePinyin('特有词汇哉', 'te4 you3 ci2 hui4 zai1');
      expect(r.pinyinNumeric).toBe('te4 you3 ci2 hui4 zai1');
      expect(r.flag?.kind).toBe('cedict-unknown');
    });
  });

  describe('format violations', () => {
    it('signals diacritic-in-numeric and still CEDICT-overrides when possible', () => {
      const r = resolvePinyin('渴', 'kè3');
      expect(r.hasFormatViolation).toBe(true);
      // CEDICT has 渴 [ke3] as a single entry — we still overwrite with it.
      expect(r.pinyinNumeric).toBe('ke3');
      expect(r.flag?.kind).toBe('auto-corrected');
    });

    it('signals stray spaces between syllable and digit', () => {
      const r = resolvePinyin('虽', 'sui 1');
      expect(r.hasFormatViolation).toBe(true);
      expect(r.pinyinNumeric).toBe('sui1');
    });

    it('signals missing tone digit', () => {
      const r = resolvePinyin('黑', 'hei');
      expect(r.hasFormatViolation).toBe(true);
    });

    it('lowercases uppercase without flagging', () => {
      const r = resolvePinyin('我', 'Wo3');
      expect(r.hasFormatViolation).toBe(false);
    });
  });

  describe('normalization', () => {
    it('lowercases and trims whitespace', () => {
      const r = resolvePinyin('休息', '  XIU1   XI5  ');
      expect(r.pinyinNumeric).toBe('xiu1 xi5');
      expect(r.flag).toBeNull();
    });
  });
});
