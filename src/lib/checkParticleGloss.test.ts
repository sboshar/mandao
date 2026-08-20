import { describe, it, expect } from 'vitest';
import { checkParticleGloss, PARTICLE_GLOSSES } from './checkParticleGloss';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('checkParticleGloss', () => {
  it('accepts the canonical gloss', () => {
    expect(checkParticleGloss('的', 'de5', 'possessive particle')).toBeNull();
    expect(checkParticleGloss('了', 'le5', 'completion particle')).toBeNull();
    expect(checkParticleGloss('们', 'men5', 'plural suffix')).toBeNull();
  });

  it('accepts either gloss where a character has two functions', () => {
    // 我的书 vs 漂亮的女孩 — genuinely different jobs, both canonical.
    expect(checkParticleGloss('的', 'de5', 'modifier particle')).toBeNull();
    expect(checkParticleGloss('了', 'le5', 'change-of-state particle')).toBeNull();
  });

  it('flags an accurate but non-canonical wording', () => {
    // "perfective marker" describes 了 correctly. It would still fork a second
    // Meaning row, because dedup is on the exact string.
    const f = checkParticleGloss('了', 'le5', 'perfective marker');
    expect(f).not.toBeNull();
    expect(f?.headword).toBe('了');
    expect(f?.llmValue).toBe('perfective marker');
    expect(f?.allowed).toContain('completion particle');
  });

  it('flags a translation of the character', () => {
    // Observed shape of the failure: glossing the particle as a content word.
    expect(checkParticleGloss('的', 'de5', 'of')).not.toBeNull();
    expect(checkParticleGloss('了', 'le5', 'past tense')).not.toBeNull();
  });

  it('ignores case and surrounding whitespace', () => {
    expect(checkParticleGloss('的', 'de5', '  Possessive Particle ')).toBeNull();
  });

  it('stays quiet on a content reading of the same character', () => {
    // 过 as guo4 is the verb "to cross"; 着 as zhao2 is "to touch/catch". Those
    // are not particle uses and must not be held to a particle gloss.
    expect(checkParticleGloss('过', 'guo4', 'to cross')).toBeNull();
    expect(checkParticleGloss('着', 'zhao2', 'to touch')).toBeNull();
    expect(checkParticleGloss('了', 'liao3', 'to understand')).toBeNull();
  });

  it('ignores characters not in the table', () => {
    expect(checkParticleGloss('我', 'wo3', 'I')).toBeNull();
    expect(checkParticleGloss('在', 'zai4', 'at')).toBeNull(); // deliberately omitted
  });

  it('is the single source of these glosses, so nothing can drift', () => {
    // The prompt used to restate the table as literal text, and a test asserted
    // the two agreed. The prompt now renders the menu FROM this map, so there is
    // no second copy to disagree with — asserted by checking the glosses appear
    // nowhere in the template as hardcoded strings.
    // Comments are stripped: a gloss named in a code comment is documentation,
    // not a second copy the model can be sent.
    const src = readFileSync(resolve(__dirname, '../services/llmPrompt.ts'), 'utf-8');
    const prompt = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hardcoded = Object.values(PARTICLE_GLOSSES)
      .flatMap((e) => e.allowed)
      .filter((gloss) => prompt.includes(`"${gloss}"`) || prompt.includes(`  ${gloss}  `));
    expect(hardcoded).toEqual([]);
  });

  it('lists every canonical gloss as self-consistent', () => {
    // Guards against a typo in the table making a gloss unreachable.
    for (const [char, { pinyin, allowed }] of Object.entries(PARTICLE_GLOSSES)) {
      expect(allowed.length).toBeGreaterThan(0);
      for (const gloss of allowed) {
        expect(checkParticleGloss(char, pinyin, gloss)).toBeNull();
      }
    }
  });
});
