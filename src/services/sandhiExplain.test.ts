import { describe, it, expect } from 'vitest';
import { applyToneSandhiDetailed, applyToneSandhi } from './toneSandhi';
import { SANDHI_RULES, APPLIED_RULES } from '../lib/sandhiRules';

describe('applyToneSandhiDetailed', () => {
  it('reports third-tone sandhi with the syllable that triggered it', () => {
    const r = applyToneSandhiDetailed(['wo3', 'dong3']);
    expect(r.syllables).toEqual(['wo2', 'dong3']);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      index: 0,
      from: 'wo3',
      to: 'wo2',
      ruleId: 'third-tone',
      triggerIndex: 1,
    });
  });

  it('reports 不 before a fourth tone', () => {
    const r = applyToneSandhiDetailed(['bu4', 'shi4']);
    expect(r.syllables).toEqual(['bu2', 'shi4']);
    expect(r.changes[0].ruleId).toBe('bu-before-fourth');
  });

  it('leaves 不 alone before other tones', () => {
    const r = applyToneSandhiDetailed(['bu4', 'hao3']);
    expect(r.syllables).toEqual(['bu4', 'hao3']);
    expect(r.changes).toEqual([]);
  });

  it('distinguishes the two 一 rules', () => {
    expect(applyToneSandhiDetailed(['yi1', 'ge4']).changes[0].ruleId).toBe(
      'yi-before-fourth',
    );
    expect(applyToneSandhiDetailed(['yi1', 'tian1']).changes[0].ruleId).toBe(
      'yi-before-others',
    );
  });

  it('records nothing when no rule fires', () => {
    const r = applyToneSandhiDetailed(['ta1', 'chi1', 'fan4']);
    expect(r.changes).toEqual([]);
    expect(r.syllables).toEqual(['ta1', 'chi1', 'fan4']);
  });

  it('handles a run of third tones', () => {
    // 我很好 — each third tone before another raises, the last stays.
    const r = applyToneSandhiDetailed(['wo3', 'hen3', 'hao3']);
    expect(r.syllables).toEqual(['wo2', 'hen2', 'hao3']);
    expect(r.changes.map((c) => c.index)).toEqual([0, 1]);
  });

  it('applies at most one rule per syllable', () => {
    // 一 is both a candidate for its own rule and never for third-tone sandhi;
    // the guard matters because a syllable rewritten twice would report a
    // "from" value that never existed.
    const r = applyToneSandhiDetailed(['yi1', 'ding4']);
    expect(r.changes).toHaveLength(1);
  });

  it('agrees with the plain wrapper', () => {
    const input = ['wo3', 'hen3', 'hao3', 'bu4', 'shi4'];
    expect(applyToneSandhi(input)).toEqual(applyToneSandhiDetailed(input).syllables);
  });
});

describe('SANDHI_RULES', () => {
  it('has an explanation for every rule the code can report', () => {
    // A change carrying a ruleId with no table entry would render blank.
    const reported = new Set(
      [
        applyToneSandhiDetailed(['wo3', 'hao3']),
        applyToneSandhiDetailed(['bu4', 'shi4']),
        applyToneSandhiDetailed(['yi1', 'ge4']),
        applyToneSandhiDetailed(['yi1', 'tian1']),
      ].flatMap((r) => r.changes.map((c) => c.ruleId)),
    );
    for (const id of reported) {
      expect(SANDHI_RULES[id]).toBeDefined();
      expect(SANDHI_RULES[id].statement.length).toBeGreaterThan(10);
    }
  });

  it('marks exactly the four rules the code applies', () => {
    expect(APPLIED_RULES.map((r) => r.id).sort()).toEqual([
      'bu-before-fourth',
      'third-tone',
      'yi-before-fourth',
      'yi-before-others',
    ]);
  });

  it('documents rules it does not apply, and says so', () => {
    // The table is a reference, not a mirror of the implementation. Half-third
    // is real but unwritten in pinyin; neutral tone is lexical, not sandhi.
    expect(SANDHI_RULES['half-third'].applied).toBe(false);
    expect(SANDHI_RULES['neutral-tone'].applied).toBe(false);
    expect(SANDHI_RULES['neutral-tone'].note).toMatch(/NOT sandhi/);
    expect(SANDHI_RULES['yi-unchanged'].applied).toBe(false);
  });

  it('keeps every id consistent with its key', () => {
    for (const [key, rule] of Object.entries(SANDHI_RULES)) {
      expect(rule.id).toBe(key);
    }
  });
});
