import { describe, it, expect } from 'vitest';
import { checkModelUncertainty } from './checkModelUncertainty';

describe('checkModelUncertainty', () => {
  it('flags a token the model marked uncertain, carrying its reason', () => {
    const f = checkModelUncertainty({
      surfaceForm: '忘我',
      english: 'absorbed',
      uncertain: true,
      uncertaintyNote: 'no exact English equivalent',
    });
    expect(f).not.toBeNull();
    expect(f?.headword).toBe('忘我');
    expect(f?.llmValue).toBe('absorbed');
    expect(f?.note).toBe('no exact English equivalent');
  });

  it('stays quiet when the model was confident', () => {
    expect(
      checkModelUncertainty({ surfaceForm: '书', english: 'book', uncertain: false }),
    ).toBeNull();
  });

  it('stays quiet when the field is absent, so older responses do not all flag', () => {
    expect(checkModelUncertainty({ surfaceForm: '书', english: 'book' })).toBeNull();
  });

  it('flags without a note rather than dropping the signal', () => {
    const f = checkModelUncertainty({
      surfaceForm: '意思',
      english: 'token of appreciation',
      uncertain: true,
    });
    expect(f).not.toBeNull();
    expect(f?.note).toBeUndefined();
  });

  it('treats a blank note as absent', () => {
    const f = checkModelUncertainty({
      surfaceForm: '意思',
      english: 'x',
      uncertain: true,
      uncertaintyNote: '   ',
    });
    expect(f?.note).toBeUndefined();
  });
});
