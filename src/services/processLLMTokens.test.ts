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

describe('processLLMTokens — observation only', () => {
  it('passes through LLM values unchanged when they match CEDICT', () => {
    const r = processLLMTokens(response([token('渴', 'ke3', 'thirsty')]));
    expect(r.tokens[0].pinyinNumeric).toBe('ke3');
    expect(r.flags).toHaveLength(0);
  });

  it('flags 哥哥 ge1 ge1 but does NOT override it', () => {
    const r = processLLMTokens(
      response([token('我', 'wo3'), token('哥哥', 'ge1 ge1', 'older brother')]),
    );
    const brother = r.tokens.find((t) => t.surfaceForm === '哥哥')!;
    expect(brother.pinyinNumeric).toBe('ge1 ge1'); // LLM value preserved
    const flag = r.flags.find((f) => f.headword === '哥哥')!;
    expect(flag.kind).toBe('cedict-disagreement');
    expect(flag.cedictSuggestions).toContain('ge1 ge5');
  });

  it('flags 休息 xi2 but does NOT override it', () => {
    const r = processLLMTokens(
      response([token('休息', 'xiu1 xi2', 'to rest')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('xiu1 xi2');
    expect(r.flags[0].kind).toBe('cedict-disagreement');
    expect(r.flags[0].cedictSuggestions).toContain('xiu1 xi5');
  });

  it('trusts LLM segmentation: split 哥+哥 passes through as two tokens', () => {
    // Segmentation is the LLM's call; we don't silently re-merge.
    // 哥 has a single CEDICT entry [ge1], so each token matches and no
    // flag fires. If the LLM got segmentation wrong, the prompt is where
    // we fix that — not by second-guessing here.
    const r = processLLMTokens(
      response([token('哥', 'ge1', 'elder brother'), token('哥', 'ge1', 'elder brother')]),
    );
    expect(r.tokens).toHaveLength(2);
    expect(r.flags).toHaveLength(0);
  });

  it('accepts 不是 bu2 shi4 via de-sandhi — no flag', () => {
    // LLM slipped sandhi into pinyinNumeric; de-sandhi maps to bu4 shi4
    // which is a valid CEDICT reading.
    const r = processLLMTokens(response([token('不是', 'bu2 shi4', "it's not")]));
    expect(r.tokens[0].pinyinNumeric).toBe('bu2 shi4');
    expect(r.flags).toHaveLength(0);
  });

  it('keeps LLM polyphone pick when it matches CEDICT', () => {
    const r = processLLMTokens(
      response([token('行', 'xing2', 'to walk')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('xing2');
    expect(r.flags).toHaveLength(0);
  });

  it('flags cedict-unknown for novel words', () => {
    const r = processLLMTokens(
      response([token('佛系青年', 'fo2 xi4 qing1 nian2', 'apathetic youth')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('fo2 xi4 qing1 nian2');
    expect(r.flags[0].kind).toBe('cedict-unknown');
    expect(r.flags[0].cedictSuggestions).toEqual([]);
  });
});
