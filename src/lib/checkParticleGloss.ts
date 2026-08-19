/**
 * Keep function-word glosses to a fixed vocabulary.
 *
 * WHY THIS IS ENFORCED RATHER THAN SUGGESTED
 * findOrCreateMeaning dedups on the exact englishShort string, so every wording
 * the model invents for 了 becomes its own Meaning row with its own SRS
 * schedule: "completion particle", "completed action", "perfective marker",
 * "past tense marker". Function words appear in nearly every sentence, so they
 * fragment faster than anything else in the lexicon. Fixing the vocabulary is
 * what keeps one morpheme to one card.
 *
 * KEYED ON THE FUNCTION READING, NOT THE CHARACTER
 * Most of these characters also have content senses — 着 is zháo/zhuó, 了 is
 * liǎo in 了解, 过 is guò "to cross". Gating on the neutral-tone function
 * reading means a content use is never flagged for failing to look like a
 * particle.
 *
 * Deliberately omitted: 在 (verb "to be at", preposition "at", and progressive
 * marker — too polyfunctional for a closed list) and 个 (measure word but also
 * "individual"). Better to check nothing than to raise flags that are wrong.
 */

export interface ParticleGlossFlag {
  kind: 'particle-gloss';
  headword: string;
  /** What the model wrote. */
  llmValue: string;
  /** The canonical glosses for this function word. */
  allowed: string[];
}

/**
 * character → { the pinyin that marks its function use, canonical glosses }.
 *
 * Several entries allow more than one gloss because the same character has
 * genuinely distinct functions that deserve distinct cards — 我的书's 的 is
 * possessive, 漂亮的女孩's 的 is attributive.
 */
export const PARTICLE_GLOSSES: Record<string, { pinyin: string; allowed: string[] }> = {
  的: { pinyin: 'de5', allowed: ['possessive particle', 'modifier particle'] },
  地: { pinyin: 'de5', allowed: ['adverbial particle'] },
  得: { pinyin: 'de5', allowed: ['complement particle'] },
  了: { pinyin: 'le5', allowed: ['completion particle', 'change-of-state particle'] },
  过: { pinyin: 'guo5', allowed: ['experiential particle'] },
  着: { pinyin: 'zhe5', allowed: ['durative particle'] },
  吗: { pinyin: 'ma5', allowed: ['yes/no question particle'] },
  呢: { pinyin: 'ne5', allowed: ['follow-up question particle'] },
  吧: { pinyin: 'ba5', allowed: ['suggestion particle'] },
  啊: { pinyin: 'a5', allowed: ['emphasis particle'] },
  呀: { pinyin: 'ya5', allowed: ['emphasis particle'] },
  们: { pinyin: 'men5', allowed: ['plural suffix'] },
};

/** Compare loosely: case and surrounding whitespace shouldn't count. */
function normalize(gloss: string): string {
  return gloss.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Check one token's gloss against the canonical vocabulary.
 *
 * Returns null when the token isn't a tracked function word, when its reading
 * shows a content use, or when the gloss is already canonical.
 */
export function checkParticleGloss(
  surfaceForm: string,
  pinyinNumeric: string,
  english: string,
): ParticleGlossFlag | null {
  const entry = PARTICLE_GLOSSES[surfaceForm];
  if (!entry) return null;
  // A content reading (着 as zhao2, 过 as guo4) is not a particle use.
  if (normalize(pinyinNumeric) !== entry.pinyin) return null;

  const got = normalize(english);
  if (entry.allowed.some((a) => normalize(a) === got)) return null;

  return {
    kind: 'particle-gloss',
    headword: surfaceForm,
    llmValue: english,
    allowed: entry.allowed,
  };
}
