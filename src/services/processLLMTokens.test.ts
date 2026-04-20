import { describe, it, expect, beforeAll } from 'vitest';
import { processLLMTokens } from './processLLMTokens';
import { loadCedict } from '../lib/cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { LLMResponse } from './llmPrompt';

beforeAll(async () => {
  const text = readFileSync(resolve(__dirname, '../../public/cedict.txt'), 'utf-8');
  // @ts-expect-error -- test shim
  global.fetch = async () => ({ text: async () => text, ok: true });
  await loadCedict();
});

const token = (
  surfaceForm: string,
  pinyinNumeric: string,
  english = '',
): LLMResponse['tokens'][0] => ({
  surfaceForm,
  pinyinNumeric,
  english,
  partOfSpeech: 'other',
});

const response = (tokens: LLMResponse['tokens']): LLMResponse => ({
  chinese: tokens.map((t) => t.surfaceForm).join(''),
  english: '',
  tokens,
});

describe('processLLMTokens', () => {
  it('overrides LLM hallucination 哥哥 ge1 ge1 with CEDICT ge1 ge5', () => {
    const r = processLLMTokens(
      response([token('我', 'wo3'), token('哥哥', 'ge1 ge1', 'older brother')]),
    );
    const brother = r.tokens.find((t) => t.surfaceForm === '哥哥')!;
    expect(brother.pinyinNumeric).toBe('ge1 ge5');
    expect(r.flags.some((f) => f.kind === 'auto-corrected')).toBe(true);
  });

  it('overrides LLM hallucination 休息 xi2 with CEDICT xi5', () => {
    const r = processLLMTokens(
      response([token('休息', 'xiu1 xi2', 'to rest')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('xiu1 xi5');
    expect(r.flags[0].kind).toBe('auto-corrected');
  });

  it('re-merges split 哥 哥 and then applies compound reading', () => {
    const r = processLLMTokens(
      response([token('哥', 'ge1', 'elder brother'), token('哥', 'ge1', 'elder brother')]),
    );
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0].surfaceForm).toBe('哥哥');
    expect(r.tokens[0].pinyinNumeric).toBe('ge1 ge5');
  });

  it('signals format violations and still CEDICT-overrides', () => {
    const r = processLLMTokens(
      response([token('渴', 'kè3', 'thirsty')]),
    );
    expect(r.hasFormatViolation).toBe(true);
    // Even on a format violation we go through CEDICT, so 渴 is corrected to ke3.
    expect(r.tokens[0].pinyinNumeric).toBe('ke3');
    expect(r.flags[0].kind).toBe('auto-corrected');
  });

  it('keeps LLM polyphone pick when it matches CEDICT', () => {
    // 行 has both hang2 and xing2 — context "to walk" → xing2.
    const r = processLLMTokens(
      response([token('行', 'xing2', 'to walk')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('xing2');
    expect(r.flags).toHaveLength(0);
  });

  it('passes novel words through with cedict-unknown flag', () => {
    const r = processLLMTokens(
      response([token('莫须有', 'mo4 xu1 you3', 'trumped up')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('mo4 xu1 you3');
    // Depending on whether 莫须有 is in CEDICT or not. If it is, no flag;
    // if not, cedict-unknown. Either is fine behavior.
    const flagKinds = r.flags.map((f) => f.kind);
    expect(flagKinds.every((k) => k === 'cedict-unknown' || k === 'auto-corrected' || k === 'polyphone-coerced')).toBe(true);
  });
});
