import { describe, it, expect, beforeAll } from 'vitest';
import { gatherCedictHits, formatCedictBlock } from './cedictSweep';
import { loadCedict } from './cedict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Vitest runs in a Node environment; cedict.ts uses fetch('/cedict.txt').
// Stub global fetch to serve the local file.
beforeAll(async () => {
  const text = readFileSync(resolve(__dirname, '../../public/cedict.txt'), 'utf-8');
  // @ts-expect-error -- test shim
  global.fetch = async (url: string) => ({
    text: async () => text,
    ok: true,
  });
  await loadCedict();
});

describe('gatherCedictHits', () => {
  it('includes compounds and drops single-reading single chars', async () => {
    const hits = await gatherCedictHits('我哥哥休息了');
    const subs = hits.map((h) => h.sub);

    // Compounds present
    expect(subs).toContain('哥哥');
    expect(subs).toContain('休息');

    // Single-reading single chars dropped (each has exactly one CEDICT entry)
    // 我 [wo3], 息 [xi1] — dropped.
    expect(subs).not.toContain('我');
    expect(subs).not.toContain('息');

    // 休 has two entries (Xiu1 surname, xiu1 verb) so it's a polyphone
    // and stays — the LLM benefits from seeing both.
    expect(subs).toContain('休');
  });

  it('keeps polyphone single chars (multiple CEDICT entries)', async () => {
    const hits = await gatherCedictHits('黑');
    const subs = hits.map((h) => h.sub);
    // 黑 has [Hei1] (Heilongjiang abbrev) and [hei1] (black) — polyphone, keep it
    expect(subs).toContain('黑');
  });

  it('surfaces the compound reading we care about for 哥哥', async () => {
    const hits = await gatherCedictHits('哥哥');
    const compound = hits.find((h) => h.sub === '哥哥');
    expect(compound).toBeDefined();
    const pinyins = compound!.entries.map((e) => e.pinyin);
    expect(pinyins).toContain('ge1 ge5');
  });

  it('surfaces the neutral-tone reading for 休息', async () => {
    const hits = await gatherCedictHits('休息');
    const compound = hits.find((h) => h.sub === '休息');
    expect(compound).toBeDefined();
    expect(compound!.entries.map((e) => e.pinyin)).toContain('xiu1 xi5');
  });

  it('sorts longest-first for a mixed sentence', async () => {
    const hits = await gatherCedictHits('我今天早上休息');
    // Compounds should precede any polyphone single-chars
    const firstFour = hits.slice(0, 4).map((h) => h.sub);
    // 今天, 早上, 休息 (all length-2 compounds) should dominate the top
    const len2Subs = firstFour.filter((s) => s.length === 2);
    expect(len2Subs.length).toBeGreaterThanOrEqual(2);
  });

  it('skips non-CJK content', async () => {
    const hits = await gatherCedictHits('Hello 你好 world');
    const subs = hits.map((h) => h.sub);
    expect(subs.every((s) => /^[\u4e00-\u9fff]+$/.test(s))).toBe(true);
  });
});

describe('formatCedictBlock', () => {
  it('returns empty string for no hits', () => {
    expect(formatCedictBlock([])).toBe('');
  });

  it('renders each hit with pipe-separated readings', async () => {
    const hits = await gatherCedictHits('哥哥');
    const block = formatCedictBlock(hits);
    expect(block).toContain('哥哥');
    expect(block).toContain('ge1 ge5');
    expect(block).toContain('Compound readings override');
  });
});
