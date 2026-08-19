import { describe, it, expect } from 'vitest';
import { normalizePinyinSyllable, normalizePinyinNumeric } from './toneSandhi';

describe('normalizePinyinSyllable', () => {
  it('leaves a well-formed syllable alone', () => {
    expect(normalizePinyinSyllable('zhe4')).toBe('zhe4');
  });

  it('strips a tone mark that came alongside a digit', () => {
    // Observed model output: "zhè4". The reading was right; the format wasn't,
    // and it raised a disagreement flag against CEDICT's equivalent "zhe4".
    expect(normalizePinyinSyllable('zhè4')).toBe('zhe4');
    expect(normalizePinyinSyllable('shì4')).toBe('shi4');
    expect(normalizePinyinSyllable('wǒ3')).toBe('wo3');
  });

  it('converts a bare tone mark to base + digit', () => {
    expect(normalizePinyinSyllable('zhè')).toBe('zhe4');
    expect(normalizePinyinSyllable('hǎo')).toBe('hao3');
    expect(normalizePinyinSyllable('mā')).toBe('ma1');
    expect(normalizePinyinSyllable('shí')).toBe('shi2');
  });

  it('treats a syllable with no tone information as neutral', () => {
    // "yi4 si" — the model dropped the neutral marker on 思.
    expect(normalizePinyinSyllable('si')).toBe('si5');
    expect(normalizePinyinSyllable('de')).toBe('de5');
  });

  it('maps pinyin-pro style 0 to 5', () => {
    expect(normalizePinyinSyllable('fu0')).toBe('fu5');
  });

  it('lowercases, so CEDICT proper-noun readings compare equal', () => {
    expect(normalizePinyinSyllable('Chang2')).toBe('chang2');
  });

  it('handles ü with a tone mark', () => {
    expect(normalizePinyinSyllable('lǜ')).toBe('lü4');
  });
});

describe('normalizePinyinNumeric', () => {
  it('normalizes each syllable of a reading', () => {
    expect(normalizePinyinNumeric('yi4 si')).toBe('yi4 si5');
    expect(normalizePinyinNumeric('zhè4 gè')).toBe('zhe4 ge4');
  });

  it('collapses irregular whitespace', () => {
    expect(normalizePinyinNumeric('  ge1   ge5 ')).toBe('ge1 ge5');
  });

  it('is a no-op on already-correct readings', () => {
    expect(normalizePinyinNumeric('bu4 ke4 qi5')).toBe('bu4 ke4 qi5');
  });

  it('returns empty for empty input', () => {
    expect(normalizePinyinNumeric('')).toBe('');
  });
});
