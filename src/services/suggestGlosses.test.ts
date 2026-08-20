import { describe, it, expect } from 'vitest';
import { buildGlossPrompt, parseGlossSuggestions } from './suggestGlosses';

const deck = [{ id: 'm1' }, { id: 'm2' }];

describe('buildGlossPrompt', () => {
  it('includes the sentence, word and current gloss', () => {
    const p = buildGlossPrompt('这是我的一点意思', '意思', 'appreciation', []);
    expect(p).toContain('这是我的一点意思');
    expect(p).toContain('意思');
    expect(p).toContain('"appreciation"');
  });

  it('offers the deck senses, numbered, when there are any', () => {
    const p = buildGlossPrompt('x', '意思', 'g', [
      { id: 'm1', pinyin: 'yì si', english: 'meaning' },
      { id: 'm2', pinyin: 'yì si', english: 'a small gift' },
    ]);
    expect(p).toContain('[1] "meaning"');
    expect(p).toContain('[2] "a small gift"');
    expect(p).toContain('existingIndex');
  });

  it('omits the deck block when the word is new', () => {
    expect(buildGlossPrompt('x', '沉浸', 'g', [])).not.toContain('already has');
  });
});

describe('parseGlossSuggestions', () => {
  const body = {
    reasoning: 'Here it names the gift, not the feeling.',
    candidates: [
      { english: 'a small gift', note: 'names the object', existingIndex: 0 },
      { english: 'meaning', note: 'the usual sense', existingIndex: 1 },
    ],
  };

  it('parses reasoning and candidates', () => {
    const r = parseGlossSuggestions(JSON.stringify(body), deck);
    expect(r.reasoning).toContain('names the gift');
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0].english).toBe('a small gift');
  });

  it('maps existingIndex to the deck meaning id, so choosing it reuses the row', () => {
    const r = parseGlossSuggestions(JSON.stringify(body), deck);
    expect(r.candidates[0].meaningId).toBeUndefined(); // index 0 = not in deck
    expect(r.candidates[1].meaningId).toBe('m1'); // index 1 → first deck sense
  });

  it('strips code fences and a prose preamble', () => {
    const r = parseGlossSuggestions(
      'Sure!\n```json\n' + JSON.stringify(body) + '\n```',
      deck,
    );
    expect(r.candidates).toHaveLength(2);
  });

  it('drops duplicates the model repeats', () => {
    const r = parseGlossSuggestions(
      JSON.stringify({
        reasoning: '',
        candidates: [
          { english: 'a gift' },
          { english: 'A Gift' },
          { english: 'a gesture' },
        ],
      }),
      deck,
    );
    expect(r.candidates.map((c) => c.english)).toEqual(['a gift', 'a gesture']);
  });

  it('drops candidates with no gloss', () => {
    const r = parseGlossSuggestions(
      JSON.stringify({ reasoning: '', candidates: [{ note: 'x' }, { english: 'ok' }] }),
      deck,
    );
    expect(r.candidates).toHaveLength(1);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ english: `g${i}` }));
    const r = parseGlossSuggestions(JSON.stringify({ candidates: many }), deck);
    expect(r.candidates.length).toBeLessThanOrEqual(5);
  });

  it('treats a blank note as absent', () => {
    const r = parseGlossSuggestions(
      JSON.stringify({ candidates: [{ english: 'g', note: '  ' }] }),
      deck,
    );
    expect(r.candidates[0].note).toBeUndefined();
  });

  it('survives a response with no candidates array', () => {
    const r = parseGlossSuggestions(JSON.stringify({ reasoning: 'hm' }), deck);
    expect(r.candidates).toEqual([]);
    expect(r.reasoning).toBe('hm');
  });
});

describe('buildGlossPrompt — scope rules', () => {
  it('forbids absorbing a neighbouring token’s meaning', () => {
    // "small token of sincerity" for 意思 folded in 一点's "a little" — a
    // meaning another token already carries and gets its own card for.
    const p = buildGlossPrompt('x', '意思', 'g', []);
    expect(p).toContain('covers only what 意思 contributes');
    expect(p).toContain('get their own cards');
  });

  it('names degree, measure and quantifier neighbours as the risky case', () => {
    const p = buildGlossPrompt('x', '高', 'tall', []);
    expect(p).toMatch(/degree word, measure word or quantifier/);
  });
});
