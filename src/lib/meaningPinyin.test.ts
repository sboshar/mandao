import { describe, it, expect } from 'vitest';
import { getMeaningPinyin } from './meaningPinyin';

describe('getMeaningPinyin', () => {
  it('derives diacritic form from numeric', () => {
    expect(getMeaningPinyin({ pinyinNumeric: 'ni3 hao3' })).toBe('nǐ hǎo');
  });

  it('handles the tone that originally motivated this helper', () => {
    // 渴 was stored as kè (tone 4) next to ke3 (tone 3). Deriving from
    // the numeric source of truth unambiguously yields kě.
    expect(getMeaningPinyin({ pinyinNumeric: 'ke3' })).toBe('kě');
  });

  it('handles neutral tone (tone 5)', () => {
    expect(getMeaningPinyin({ pinyinNumeric: 'ma5' })).toBe('ma');
  });
});
