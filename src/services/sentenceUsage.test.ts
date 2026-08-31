import { describe, it, expect } from 'vitest';
import { buildUsagePrompt, parseSentenceUsage, readSituations } from './sentenceUsage';
import { SENTENCE_MEDIUMS, SENTENCE_REGISTERS } from '../db/schema';

const full = {
  register: 'casual',
  medium: 'spoken',
  speechAct: 'telling someone to go ahead',
  description: 'Said to a friend or colleague when you are staying behind. The 吧 softens it into a suggestion rather than an order.',
  situations: [
    {
      situation: 'Leaving a restaurant while you settle the bill',
      chinese: '我去结账，你们先走',
      english: "I'll settle the bill, you all go ahead",
    },
    {
      situation: 'A colleague is heading out and you still have work to finish',
      chinese: '我还有点事儿',
      english: 'I still have a few things to do',
    },
  ],
  caution: 'To someone much senior, add 您 or a reason for staying.',
};

describe('parseSentenceUsage', () => {
  it('parses a bare JSON object', () => {
    const u = parseSentenceUsage(JSON.stringify(full));
    expect(u.register).toBe('casual');
    expect(u.medium).toBe('spoken');
    expect(u.speechAct).toBe('telling someone to go ahead');
    expect(u.situations).toHaveLength(2);
    expect(u.situations[0].chinese).toBe('我去结账，你们先走');
    expect(u.situations[0].english).toContain('settle the bill');
    expect(u.caution).toContain('senior');
  });

  it('strips markdown code fences', () => {
    expect(parseSentenceUsage('```json\n' + JSON.stringify(full) + '\n```').register).toBe('casual');
  });

  it('skips a prose preamble before the object', () => {
    // Models routinely ignore "no prose" and open with a sentence.
    const u = parseSentenceUsage("Here's the usage breakdown:\n" + JSON.stringify(full));
    expect(u.description).toContain('staying behind');
  });

  it('collapses newlines inside the description to one paragraph', () => {
    const u = parseSentenceUsage(
      JSON.stringify({ ...full, description: 'First line.\n\n  Second line.' }),
    );
    expect(u.description).toBe('First line. Second line.');
  });

  it('falls back to neutral/both on labels outside the lists', () => {
    // An unrecognized label is a formatting miss, not a reason to throw away a
    // description the learner can read.
    const u = parseSentenceUsage(
      JSON.stringify({ ...full, register: 'semi-formal', medium: 'texting' }),
    );
    expect(u.register).toBe('neutral');
    expect(u.medium).toBe('both');
    expect(u.description).toContain('staying behind');
  });

  it('drops empty situations and caps the list', () => {
    const u = parseSentenceUsage(
      JSON.stringify({
        ...full,
        situations: ['a', '', '   ', 'b', 'c', 'd', 'e', 'f'].map((situation) => ({ situation })),
      }),
    );
    expect(u.situations.map((s) => s.situation)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates situations that are not an array', () => {
    const u = parseSentenceUsage(JSON.stringify({ ...full, situations: 'lots of them' }));
    expect(u.situations).toEqual([]);
  });

  it('keeps the English situation when the Mandarin line is unusable', () => {
    // A missing or latin-only example costs that row its card, not its place in
    // the list — the description of the moment is still worth reading.
    const u = parseSentenceUsage(
      JSON.stringify({
        ...full,
        situations: [
          { situation: 'A friend asks how your weekend was', chinese: 'zhou mo zen me yang' },
          { situation: 'A colleague asks about the draft' },
        ],
      }),
    );
    expect(u.situations).toHaveLength(2);
    expect(u.situations[0].chinese).toBeUndefined();
    expect(u.situations[1].chinese).toBeUndefined();
  });

  it('omits caution when the model returns an empty string', () => {
    // The prompt asks for "" rather than an invented warning, so "" must not
    // render as an empty warning box.
    const u = parseSentenceUsage(JSON.stringify({ ...full, caution: '' }));
    expect(u.caution).toBeUndefined();
  });

  it('caps a runaway description instead of letting it reflow the card', () => {
    const u = parseSentenceUsage(
      JSON.stringify({ ...full, description: 'x'.repeat(5000) }),
    );
    expect(u.description.length).toBeLessThanOrEqual(1200);
  });

  it('throws when there is no description', () => {
    expect(() => parseSentenceUsage(JSON.stringify({ ...full, description: '   ' }))).toThrow();
  });

  it('recovers the object from a model that wrapped it in an array', () => {
    expect(parseSentenceUsage(JSON.stringify([full])).register).toBe('casual');
  });

  it('throws on an array with no object in it', () => {
    expect(() => parseSentenceUsage('[]')).toThrow();
  });

  it('throws on output that is not JSON at all', () => {
    expect(() => parseSentenceUsage('I cannot help with that.')).toThrow();
  });
});

describe('readSituations', () => {
  it('reads notes written before the Mandarin examples existed', () => {
    // Stored notes from the first version are bare strings. They must keep
    // rendering their English situations rather than vanishing.
    const legacy = readSituations([
      'A friend asks how your weekend was',
      'A colleague asks if the draft is fine',
    ]);
    expect(legacy).toEqual([
      { situation: 'A friend asks how your weekend was' },
      { situation: 'A colleague asks if the draft is fine' },
    ]);
  });

  it('drops an example that has no English situation to introduce it', () => {
    expect(readSituations([{ chinese: '还行吧', english: 'not bad' }])).toEqual([]);
  });

  it('survives junk in place of the list', () => {
    expect(readSituations(undefined)).toEqual([]);
    expect(readSituations([null, 42, {}])).toEqual([]);
  });
});

describe('buildUsagePrompt', () => {
  it('includes the sentence and its translation', () => {
    const p = buildUsagePrompt('你先走吧', 'You go ahead');
    expect(p).toContain('你先走吧');
    expect(p).toContain('You go ahead');
  });

  it('omits the meaning line when no translation is known', () => {
    const p = buildUsagePrompt('你先走吧');
    expect(p).toContain('你先走吧');
    expect(p).not.toContain('It means');
  });

  it('offers every register and medium the parser accepts', () => {
    // The prompt's closed lists and the validator's lists must not drift: a
    // register offered but not accepted would silently become "neutral", and
    // one accepted but not offered would never be chosen.
    const p = buildUsagePrompt('你先走吧', 'You go ahead');
    for (const r of SENTENCE_REGISTERS) expect(p).toContain(`"${r}"`);
    for (const m of SENTENCE_MEDIUMS) expect(p).toContain(`"${m}"`);
  });

  it('asks for English usage notes, not another translation', () => {
    const p = buildUsagePrompt('你先走吧', 'You go ahead');
    expect(p).toContain('Do not translate the sentence again');
  });

  it('asks each situation for a Mandarin line that stands on its own', () => {
    // The lines are offered for adding to the deck, so a fragment or a repeat
    // of the sentence being explained is a non-answer.
    const p = buildUsagePrompt('你先走吧', 'You go ahead');
    expect(p).toContain('THIS BECOMES ITS OWN FLASHCARD');
    expect(p).toContain('Do NOT return the sentence being explained verbatim');
    expect(p).toContain('"chinese": string');
  });
});
