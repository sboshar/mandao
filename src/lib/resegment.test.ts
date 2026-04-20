import { describe, it, expect, beforeAll } from 'vitest';
import { resegmentWithCedict } from './resegment';
import { loadCedict } from './cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

beforeAll(async () => {
  const text = readFileSync(resolve(__dirname, '../../public/cedict.txt'), 'utf-8');
  // @ts-expect-error -- test shim
  global.fetch = async () => ({ text: async () => text, ok: true });
  await loadCedict();
});

const T = (surface: string, pinyin = '', english = '') => ({
  surfaceForm: surface,
  pinyinNumeric: pinyin,
  english,
});

// Test helper: extract surface forms from the new ResegmentedToken shape.
const surfaces = (tokens: { surfaceForm: string }[]) =>
  tokens.map((t) => t.surfaceForm);

describe('resegmentWithCedict', () => {
  it('merges split 哥 哥 into compound 哥哥', () => {
    const input = [T('我', 'wo3'), T('哥', 'ge1'), T('哥', 'ge1')];
    const result = resegmentWithCedict(input);
    expect(result).toHaveLength(2);
    expect(result[0].surfaceForm).toBe('我');
    expect(result[1].surfaceForm).toBe('哥哥');
  });

  it('merges split 休 息 into compound 休息', () => {
    const input = [T('我', 'wo3'), T('休', 'xiu1'), T('息', 'xi1'), T('了', 'le5')];
    const result = resegmentWithCedict(input);
    expect(result.map((t) => t.surfaceForm)).toEqual(['我', '休息', '了']);
  });

  it('leaves multi-char tokens untouched', () => {
    const input = [T('今天', 'jin1 tian1'), T('早上', 'zao3 shang5'), T('好', 'hao3')];
    const result = resegmentWithCedict(input);
    expect(result.map((t) => t.surfaceForm)).toEqual(['今天', '早上', '好']);
    // Values preserved on passthrough
    expect(result[0].pinyinNumeric).toBe('jin1 tian1');
  });

  it('does nothing when no compound covers consecutive singles', () => {
    // 我 + 是 — no CEDICT entry for 我是 as a unit.
    const input = [T('我', 'wo3'), T('是', 'shi4')];
    const result = resegmentWithCedict(input);
    expect(result.map((t) => t.surfaceForm)).toEqual(['我', '是']);
  });

  it('clears merged tokens pinyin/english so caller must refill', () => {
    const input = [T('哥', 'ge1', 'older brother'), T('哥', 'ge1', 'older brother')];
    const result = resegmentWithCedict(input);
    expect(result[0].surfaceForm).toBe('哥哥');
    expect(result[0].pinyinNumeric).toBe('');
    expect(result[0].english).toBe('');
  });

  it('picks the longest available compound', () => {
    // 对不起 ("I'm sorry") is a 3-char compound in CEDICT.
    const input = [T('对', 'dui4'), T('不', 'bu4'), T('起', 'qi3')];
    const result = resegmentWithCedict(input);
    expect(result).toHaveLength(1);
    expect(result[0].surfaceForm).toBe('对不起');
  });
});
