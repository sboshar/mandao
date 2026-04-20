import { describe, it, expect, beforeAll } from 'vitest';
import { scanSegmentation } from './segmentationCheck';
import { loadCedict } from './cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

beforeAll(async () => {
  const text = readFileSync(resolve(__dirname, '../../public/cedict.txt'), 'utf-8');
  // @ts-expect-error -- test shim
  global.fetch = async () => ({ text: async () => text, ok: true });
  await loadCedict();
});

const T = (surfaceForm: string, pinyinNumeric: string) => ({
  surfaceForm,
  pinyinNumeric,
});

describe('scanSegmentation', () => {
  it('flags split 哥+哥 with CEDICT compound suggestion', () => {
    const flags = scanSegmentation([
      T('我', 'wo3'),
      T('哥', 'ge1'),
      T('哥', 'ge1'),
    ]);
    expect(flags).toHaveLength(1);
    const f = flags[0];
    expect(f.headword).toBe('哥哥');
    expect(f.tokenIndices).toEqual([1, 2]);
    expect(f.llmValue).toBe('ge1 ge1');
    expect(f.cedictSuggestions).toContain('ge1 ge5');
    expect(f.cedictEnglish).toMatch(/brother/i);
  });

  it('flags split 休+息', () => {
    const flags = scanSegmentation([
      T('我', 'wo3'),
      T('休', 'xiu1'),
      T('息', 'xi1'),
      T('了', 'le5'),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0].headword).toBe('休息');
    expect(flags[0].tokenIndices).toEqual([1, 2]);
  });

  it('leaves multi-char tokens untouched', () => {
    const flags = scanSegmentation([
      T('今天', 'jin1 tian1'),
      T('早上', 'zao3 shang5'),
      T('好', 'hao3'),
    ]);
    expect(flags).toHaveLength(0);
  });

  it('does not flag runs whose concat misses CEDICT', () => {
    // 我是 is not in CEDICT as a compound.
    const flags = scanSegmentation([T('我', 'wo3'), T('是', 'shi4')]);
    expect(flags).toHaveLength(0);
  });

  it('picks the longest compound when multiple lengths match', () => {
    // 对不起 (3-char) is in CEDICT; 不起 (2-char) also exists.
    // Greedy longest-match from position 0 should pick 对不起.
    const flags = scanSegmentation([
      T('对', 'dui4'),
      T('不', 'bu4'),
      T('起', 'qi3'),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0].headword).toBe('对不起');
    expect(flags[0].tokenIndices).toEqual([0, 1, 2]);
  });

  it('skips past merged run; finds a second mergeable run later', () => {
    const flags = scanSegmentation([
      T('哥', 'ge1'),
      T('哥', 'ge1'),
      T('很', 'hen3'),
      T('爸', 'ba4'),
      T('爸', 'ba4'),
    ]);
    expect(flags).toHaveLength(2);
    expect(flags[0].headword).toBe('哥哥');
    expect(flags[1].headword).toBe('爸爸');
    expect(flags[1].tokenIndices).toEqual([3, 4]);
  });
});
