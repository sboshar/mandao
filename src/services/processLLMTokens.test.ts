import { describe, it, expect, beforeAll } from 'vitest';
import { processLLMTokens } from './processLLMTokens';
import { loadCedict } from '../lib/cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { LLMResponse } from './llmPrompt';
import type { IngestFlag } from './processLLMTokens';

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

/** Narrow to a CEDICT-sourced flag; pinyin-pro flags carry no cedictSuggestions. */
const cedictFlag = (flags: IngestFlag[], headword?: string) => {
  const f = flags.find(
    (x) =>
      (x.kind === 'cedict-disagreement' || x.kind === 'cedict-unknown') &&
      (!headword || x.headword === headword),
  );
  if (!f || (f.kind !== 'cedict-disagreement' && f.kind !== 'cedict-unknown')) {
    throw new Error(`no cedict flag for ${headword ?? '(any)'}`);
  }
  return f;
};

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
    const flag = cedictFlag(r.flags, '哥哥');
    expect(flag.kind).toBe('cedict-disagreement');
    expect(flag.cedictSuggestions).toContain('ge1 ge5');
  });

  it('flags 休息 xi2 but does NOT override it', () => {
    const r = processLLMTokens(
      response([token('休息', 'xiu1 xi2', 'to rest')]),
    );
    expect(r.tokens[0].pinyinNumeric).toBe('xiu1 xi2');
    const flag = cedictFlag(r.flags, '休息');
    expect(flag.kind).toBe('cedict-disagreement');
    expect(flag.cedictSuggestions).toContain('xiu1 xi5');
  });

  it('surfaces segmentation-disagreement when LLM splits a CEDICT compound', () => {
    // Segmentation is the LLM's call; we don't silently re-merge. But a
    // segmentation-disagreement flag tells the user CEDICT has the
    // compound, with a Merge button in the review UI.
    const r = processLLMTokens(
      response([token('哥', 'ge1', 'elder brother'), token('哥', 'ge1', 'elder brother')]),
    );
    expect(r.tokens).toHaveLength(2);
    // pinyin-pro reads the sentence as 哥哥 = "ge1 ge5" and so also flags the
    // second 哥 for its non-neutral tone. Both flags are correct and describe
    // the same underlying mistake from different angles.
    const f = r.flags.find((x) => x.kind === 'segmentation-disagreement')!;
    expect(f).toBeDefined();
    if (f.kind === 'segmentation-disagreement') {
      expect(f.headword).toBe('哥哥');
      expect(f.tokenIndices).toEqual([0, 1]);
      expect(f.cedictSuggestions).toContain('ge1 ge5');
    }
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



  it('flags cedict-unknown for words CEDICT does not have', () => {
    const r = processLLMTokens(
      response([token('佛系青年', 'fo2 xi4 qing1 nian2', 'apathetic youth')]),
    );
    const flag = cedictFlag(r.flags);
    expect(flag.kind).toBe('cedict-unknown');
    expect(flag.cedictSuggestions).toEqual([]);
  });

  it('deduplicates CEDICT suggestions', () => {
    // 是 has two CEDICT entries sharing one reading; the review UI rendered
    // "Use shì (shi4)" twice.
    const r = processLLMTokens(response([token('是', 'shi9', 'is')]));
    const flag = cedictFlag(r.flags, '是');
    expect(flag.cedictSuggestions).toEqual([...new Set(flag.cedictSuggestions)]);
  });

  it('tolerates sandhi in pinyinNumeric rather than flagging it', () => {
    // pinyin-pro is normalized to citation (bu4), the LLM wrote sandhi (bu2).
    // Not a reading error, so neither checker should fire.
    const r = processLLMTokens(response([token('不是', 'bu2 shi4', "it's not")]));
    expect(r.flags).toHaveLength(0);
  });

  it('derives pinyinSandhi rather than trusting the LLM', () => {
    // 不 before a 4th tone becomes bu2; ingestion recomputes this at save time,
    // so review must show the same derived value.
    const r = processLLMTokens(response([token('不是', 'bu4 shi4', "it's not")]));
    expect(r.tokens[0].pinyinNumeric).toBe('bu4 shi4'); // citation, untouched
    expect(r.tokens[0].pinyinSandhi).toBe('bú shì'); // derived
  });


});
