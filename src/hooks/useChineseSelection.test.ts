import { describe, it, expect } from 'vitest';
import { hanOnly } from './useChineseSelection';

describe('hanOnly', () => {
  it('strips interleaved pinyin from a Browse selection', () => {
    // TokenSpan stacks pinyin under each token, so a drag across 我饿了
    // serializes with the readings mixed in.
    expect(hanOnly('我\nwǒ\n饿\nè\n了\nle')).toBe('我饿了');
  });

  it('strips spaces between tokens', () => {
    expect(hanOnly('他 走路 上班')).toBe('他走路上班');
  });

  it('strips punctuation', () => {
    expect(hanOnly('今天下雨了。')).toBe('今天下雨了');
  });

  it('leaves clean Chinese untouched', () => {
    expect(hanOnly('忘我')).toBe('忘我');
  });

  it('returns empty for a selection with no Han characters', () => {
    expect(hanOnly('wǒ è le')).toBe('');
  });
});
