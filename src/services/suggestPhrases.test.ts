import { describe, it, expect } from 'vitest';
import { buildSuggestionPrompt, parseSuggestions } from './suggestPhrases';

describe('parseSuggestions', () => {
  const valid = JSON.stringify([
    { chinese: '我上班去了', english: 'I left for work', note: 'leaving the house' },
  ]);

  it('parses a bare JSON array', () => {
    const r = parseSuggestions(valid);
    expect(r).toHaveLength(1);
    expect(r[0].chinese).toBe('我上班去了');
    expect(r[0].note).toBe('leaving the house');
  });

  it('strips markdown code fences', () => {
    expect(parseSuggestions('```json\n' + valid + '\n```')).toHaveLength(1);
  });

  it('skips a prose preamble before the array', () => {
    // Models routinely ignore "no prose" and open with a sentence.
    expect(parseSuggestions('Here are some suggestions:\n' + valid)).toHaveLength(1);
  });

  it('drops entries with no chinese', () => {
    const r = parseSuggestions(
      JSON.stringify([{ english: 'no chinese here' }, { chinese: '好的', english: 'okay' }]),
    );
    expect(r).toHaveLength(1);
    expect(r[0].chinese).toBe('好的');
  });

  it('tolerates a missing note', () => {
    const r = parseSuggestions(JSON.stringify([{ chinese: '好的', english: 'okay' }]));
    expect(r[0].note).toBeUndefined();
  });

  it('accepts an empty array as a valid "nothing to suggest"', () => {
    expect(parseSuggestions('[]')).toEqual([]);
  });

  it('caps the number returned', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      chinese: `句子${i}`,
      english: `sentence ${i}`,
    }));
    expect(parseSuggestions(JSON.stringify(many)).length).toBeLessThanOrEqual(8);
  });

  it('throws on output that is not an array', () => {
    expect(() => parseSuggestions('{"chinese":"好的"}')).toThrow();
  });
});

describe('buildSuggestionPrompt', () => {
  it('includes the target word and its gloss', () => {
    const p = buildSuggestionPrompt(['上班'], new Map([['上班', 'to go to work']]));
    expect(p).toContain('上班');
    expect(p).toContain('to go to work');
  });

  it('omits the gloss line when none is known', () => {
    const p = buildSuggestionPrompt(['上班']);
    expect(p).toContain('上班');
    expect(p).not.toContain('—  "');
  });

  it('requires all targets together when several are given, and allows giving up', () => {
    const p = buildSuggestionPrompt(['上班', '咖啡']);
    expect(p).toContain('ALL of the target words');
    // Contrived sentences are worse than fewer sentences.
    expect(p).toContain('return fewer suggestions');
  });

  it('does not demand co-occurrence for a single target', () => {
    expect(buildSuggestionPrompt(['上班'])).not.toContain('ALL of the target words');
  });

  it('tells the model to answer even for formal or literary words', () => {
    // 忘我 is literary-leaning, and an earlier version invited the model to
    // decline for exactly that reason — so it returned nothing at all.
    const p = buildSuggestionPrompt(['忘我']);
    expect(p).toContain('ALWAYS RETURN SUGGESTIONS');
    expect(p).toContain('Do not return an empty list');
  });

  it('reserves the empty list for the multi-word case only', () => {
    expect(buildSuggestionPrompt(['忘我'])).toContain('ONLY in the multi-word case');
  });
});
