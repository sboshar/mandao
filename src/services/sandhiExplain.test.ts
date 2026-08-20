import { describe, it, expect } from 'vitest';
import { applyToneSandhiDetailed, applyToneSandhi } from './toneSandhi';
import { deriveSandhiChanges, alignHanzi } from './sandhiExplain';
import { SANDHI_RULES, APPLIED_RULES, SANDHI_CAVEATS } from '../lib/sandhiRules';

describe('applyToneSandhiDetailed', () => {
  it('reports third-tone sandhi with the tone that triggered it', () => {
    const r = applyToneSandhiDetailed(['wo3', 'dong3']);
    expect(r.syllables).toEqual(['wo2', 'dong3']);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      index: 0,
      from: 'wo3',
      to: 'wo2',
      ruleId: 'third-tone',
      triggerIndex: 1,
      triggerTone: 3,
      characterConfirmed: true,
    });
  });

  it('reports 不 before a fourth tone', () => {
    const r = applyToneSandhiDetailed(['bu4', 'shi4'], ['不', '是']);
    expect(r.syllables).toEqual(['bu2', 'shi4']);
    expect(r.changes[0]).toMatchObject({
      ruleId: 'bu-before-fourth',
      triggerTone: 4,
      characterConfirmed: true,
    });
  });

  it('leaves 不 alone before other tones', () => {
    const r = applyToneSandhiDetailed(['bu4', 'hao3'], ['不', '好']);
    expect(r.syllables).toEqual(['bu4', 'hao3']);
    expect(r.changes).toEqual([]);
  });

  it('distinguishes the two 一 rules', () => {
    expect(
      applyToneSandhiDetailed(['yi1', 'ge4'], ['一', '个']).changes[0].ruleId,
    ).toBe('yi-before-fourth');
    expect(
      applyToneSandhiDetailed(['yi1', 'tian1'], ['一', '天']).changes[0].ruleId,
    ).toBe('yi-before-others');
  });

  it('records nothing when no rule fires', () => {
    const r = applyToneSandhiDetailed(['ta1', 'chi1', 'fan4']);
    expect(r.changes).toEqual([]);
    expect(r.syllables).toEqual(['ta1', 'chi1', 'fan4']);
  });

  it('applies at most one rule per syllable', () => {
    const r = applyToneSandhiDetailed(['yi1', 'ding4'], ['一', '定']);
    expect(r.changes).toHaveLength(1);
  });

  it('agrees with the plain wrapper', () => {
    const input = ['wo3', 'hen3', 'hao3', 'bu4', 'shi4'];
    const hanzi = ['我', '很', '好', '不', '是'];
    expect(applyToneSandhi(input, hanzi)).toEqual(
      applyToneSandhiDetailed(input, hanzi).syllables,
    );
  });
});

/**
 * The bug these cover: 一 and 不 sandhi are rules about CHARACTERS, but the code
 * matched on the reading, so every other character reading yi1 or bu4 was
 * rewritten too.
 */
describe('character-specific rules need the character', () => {
  it('does not touch 医院, which merely reads yi1', () => {
    const r = applyToneSandhiDetailed(['yi1', 'yuan4'], ['医', '院']);
    expect(r.syllables).toEqual(['yi1', 'yuan4']); // not yi2 yuan4 → "yí yuàn"
    expect(r.changes).toEqual([]);
  });

  it('does not touch 部队, which merely reads bu4', () => {
    const r = applyToneSandhiDetailed(['bu4', 'dui4'], ['部', '队']);
    expect(r.syllables).toEqual(['bu4', 'dui4']); // not "bú duì"
    expect(r.changes).toEqual([]);
  });

  it('still transforms when the character is unknown, but says it is unconfirmed', () => {
    // Existing callers that pass no hanzi keep their behaviour; the flag is what
    // stops the UI citing a rule it cannot vouch for.
    const r = applyToneSandhiDetailed(['yi1', 'yuan4']);
    expect(r.syllables).toEqual(['yi2', 'yuan4']);
    expect(r.changes[0].characterConfirmed).toBe(false);
  });

  it('treats a blank slot as unknown rather than as a mismatch', () => {
    const r = applyToneSandhiDetailed(['bu4', 'shi4'], [undefined, '是']);
    expect(r.syllables).toEqual(['bu2', 'shi4']);
    expect(r.changes[0].characterConfirmed).toBe(false);
  });

  it('never marks third-tone sandhi unconfirmed — it has no character condition', () => {
    for (const hanzi of [undefined, ['我', '好'], [undefined, undefined]]) {
      const r = applyToneSandhiDetailed(['wo3', 'hao3'], hanzi);
      expect(r.changes[0].characterConfirmed).toBe(true);
    }
  });
});

describe('runs of three or more third tones', () => {
  it('flags the run instead of claiming the grouping is right', () => {
    // 我很好 is wǒ hén hǎo, because [我][很好] groups that way — but the grouping
    // is syntactic and this code applies the rule left to right, so it produces
    // wó hén hǎo. The output is asserted as-is because that is what it does; the
    // caveat is what keeps the UI from presenting it as settled.
    const r = applyToneSandhiDetailed(['wo3', 'hen3', 'hao3'], ['我', '很', '好']);
    expect(r.syllables).toEqual(['wo2', 'hen2', 'hao3']);
    expect(r.changes.map((c) => c.index)).toEqual([0, 1]);
    for (const c of r.changes) expect(c.caveatId).toBe('long-third-run');
  });

  it('does not flag a plain two-syllable pair', () => {
    const r = applyToneSandhiDetailed(['hen3', 'hao3'], ['很', '好']);
    expect(r.changes[0].caveatId).toBeUndefined();
  });

  it('measures the run from citation tones, not from what a neighbour became', () => {
    // ni3 hao3 ma5: a two-run followed by a neutral. No caveat.
    const r = applyToneSandhiDetailed(['ni3', 'hao3', 'ma5'], ['你', '好', '吗']);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].caveatId).toBeUndefined();
  });
});

describe('deriveSandhiChanges', () => {
  it('recovers the rule from the two displayed strings', () => {
    const changes = deriveSandhiChanges('bù shì', ['bú', 'shì'], '不是');
    expect(changes.get(0)).toMatchObject({
      ruleId: 'bu-before-fourth',
      triggerTone: 4,
    });
  });

  it('explains nothing when the character cannot be confirmed', () => {
    // 医院: the transformation is in the displayed string (legacy data), but no
    // rule may be cited for it.
    expect(deriveSandhiChanges('yī yuàn', ['yí', 'yuàn'], '医院').size).toBe(0);
    // Same reading with no characters at all — still unconfirmed.
    expect(deriveSandhiChanges('yī yuàn', ['yí', 'yuàn']).size).toBe(0);
  });

  it('explains a confirmed 一', () => {
    expect(deriveSandhiChanges('yī dìng', ['yí', 'dìng'], '一定').get(0)).toBeDefined();
  });

  it('drops everything when the displayed string does not match the rule output', () => {
    // This is what makes a hand-edited or stale reading safe without detecting
    // it: the prediction simply stops matching what is on screen.
    expect(deriveSandhiChanges('hěn hǎo', ['hén', 'hào'], '很好').size).toBe(0);
    expect(deriveSandhiChanges('hěn hǎo', ['hén', 'hǎo'], '很好').get(0)).toBeDefined();
  });

  it('gives up on a length mismatch rather than misaligning', () => {
    expect(deriveSandhiChanges('hěn hǎo', ['hén'], '很好').size).toBe(0);
    expect(deriveSandhiChanges('hěn hǎo', ['hén', 'hǎo', 'ma'], '很好').size).toBe(0);
  });

  it('handles a missing base pinyin', () => {
    expect(deriveSandhiChanges(undefined, ['hén', 'hǎo']).size).toBe(0);
    expect(deriveSandhiChanges('', ['hén', 'hǎo']).size).toBe(0);
  });

  it('explains a change caused by an appended lookahead syllable', () => {
    // 不 alone in its row: without the next syllable there is nothing to
    // condition the rule on, with it the row can explain itself.
    expect(deriveSandhiChanges('bù', ['bú'], '不').size).toBe(0);
    const withNext = deriveSandhiChanges('bù shì', ['bú', 'shì'], '不是');
    expect(withNext.get(0)?.triggerIndex).toBe(1);
  });
});

describe('alignHanzi', () => {
  it('drops punctuation and latin so counts line up', () => {
    expect(alignHanzi('你好。', 2)).toEqual(['你', '好']);
    expect(alignHanzi('我很好！', 3)).toEqual(['我', '很', '好']);
  });

  it('refuses to align when the counts disagree', () => {
    expect(alignHanzi('花儿', 3)).toBeUndefined();
    expect(alignHanzi('你好', 3)).toBeUndefined();
    expect(alignHanzi(undefined, 2)).toBeUndefined();
  });
});

describe('SANDHI_RULES', () => {
  it('covers every rule id the code can actually emit', () => {
    // Non-vacuous by construction: it asserts the emitted SET, so a rule that
    // stopped firing, or a new one that started, fails here rather than passing
    // on an empty list.
    const emitted = new Set(
      [
        applyToneSandhiDetailed(['wo3', 'hao3'], ['我', '好']),
        applyToneSandhiDetailed(['bu4', 'shi4'], ['不', '是']),
        applyToneSandhiDetailed(['yi1', 'ge4'], ['一', '个']),
        applyToneSandhiDetailed(['yi1', 'tian1'], ['一', '天']),
      ].flatMap((r) => r.changes.map((c) => c.ruleId)),
    );
    expect([...emitted].sort()).toEqual(APPLIED_RULES.map((r) => r.id).sort());
    for (const id of emitted) {
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
    expect(SANDHI_RULES['half-third'].applied).toBe(false);
    expect(SANDHI_RULES['neutral-tone'].applied).toBe(false);
    expect(SANDHI_RULES['neutral-tone'].note).toMatch(/NOT sandhi/);
    expect(SANDHI_RULES['yi-unchanged'].applied).toBe(false);
  });

  it('repeats the 一 caveat on the rules that fire, since unapplied rules never show', () => {
    // 一月 comes out yí yuè, so the caveat has to reach the reader from the rule
    // that produced it — the 'yi-unchanged' entry alone is never rendered.
    expect(SANDHI_RULES['yi-before-fourth'].note).toMatch(/ordinal/);
    expect(SANDHI_RULES['yi-before-others'].note).toMatch(/ordinal/);
  });

  it('does not claim 不 always stays bù outside a fourth tone', () => {
    // 好不好 is hǎo bu hǎo — the earlier wording asserted otherwise.
    expect(SANDHI_RULES['bu-before-fourth'].note).toMatch(/好不好/);
  });

  it('keeps every id consistent with its key', () => {
    for (const [key, rule] of Object.entries(SANDHI_RULES)) {
      expect(rule.id).toBe(key);
    }
    for (const [key, text] of Object.entries(SANDHI_CAVEATS)) {
      expect(key.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(20);
    }
  });
});

describe('read-more links', () => {
  it('gives every applied rule somewhere to read the rule stated independently', () => {
    for (const rule of APPLIED_RULES) {
      expect(rule.readMore?.length, rule.id).toBeGreaterThan(0);
    }
  });

  it('points only at https URLs, so nothing renders a dead scheme', () => {
    for (const rule of Object.values(SANDHI_RULES)) {
      for (const r of rule.readMore ?? []) {
        expect(r.url, rule.id).toMatch(/^https:\/\//);
        expect(r.label.length, rule.id).toBeGreaterThan(3);
      }
    }
  });

  it('sends the A-不-A caveat somewhere that explains A-不-A', () => {
    // The note raises a construction it has no room to teach; the link is the
    // answer to the question the note provokes.
    const urls = SANDHI_RULES['bu-before-fourth'].readMore!.map((r) => r.url);
    expect(urls.some((u) => /Affirmative-negative_question/.test(u))).toBe(true);
  });
});
