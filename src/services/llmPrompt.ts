/**
 * LLM prompt generator for sentence analysis.
 *
 * Flow: CC-CEDICT tokenizer segments first → user adjusts → segments passed to LLM
 * The LLM fills in: English translation, pinyin, tone sandhi, character breakdowns, POS.
 */
import * as repo from '../db/repo';

export interface ExistingMeaning {
  headword: string;
  pinyin: string;
  english: string;
}

/** Look up existing meanings for the given segments (not individual characters within compounds) */
export async function getExistingMeaningsForSegments(
  segments: string[]
): Promise<ExistingMeaning[]> {
  const unique = [...new Set(segments)];
  const results: ExistingMeaning[] = [];

  for (const seg of unique) {
    const meanings = await repo.getMeaningsByHeadword(seg);

    for (const m of meanings) {
      results.push({
        headword: m.headword,
        pinyin: m.pinyin,
        english: m.englishShort,
      });
    }
  }

  return results;
}

/**
 * Generate LLM prompt with pre-segmented tokens.
 * The tokenizer has already split the sentence — the LLM just fills in definitions.
 */
export function generateAnalysisPrompt(
  chinese: string,
  segments: string[],
  existingMeanings?: ExistingMeaning[]
): string {
  let existingSection = '';
  if (existingMeanings && existingMeanings.length > 0) {
    const lines = existingMeanings
      .map((m) => `  ${m.headword} [${m.pinyin}] = "${m.english}"`)
      .join('\n');
    existingSection = `
These meanings already exist in my app for characters in this sentence:
${lines}

If a character/word has the same meaning as one listed above, pick it from the list (use the exact English string). Otherwise, assign a new meaning.
`;
  }

  const segmentList = segments.map((s) => `"${s}"`).join(', ');

  return `Analyze this Chinese sentence and return ONLY a JSON object (no markdown, no explanation, no code fences).

Sentence: ${chinese}
Pre-segmented tokens (DO NOT change the segmentation): [${segmentList}]
${existingSection}
Return this exact JSON structure:
{
  "chinese": "${chinese}",
  "english": "natural English translation",
  "pinyinSandhi": "full sentence pinyin with tone sandhi applied using diacritics",
  "tokens": [
    {
      "surfaceForm": "the Chinese word/character EXACTLY as given in the pre-segmented tokens above",
      "pinyinNumeric": "pinyin with tone numbers BEFORE sandhi e.g. hao3",
      "pinyinSandhi": "pinyin with diacritics AFTER tone sandhi applied",
      "english": "meaning IN THIS CONTEXT (not all meanings)",
      "partOfSpeech": "one of: noun, verb, adj, adv, prep, conj, particle, measure, pronoun, number, other",
      "characters": [
        {
          "char": "individual character",
          "pinyinNumeric": "tone number pinyin for this character e.g. cheng2",
          "pinyinSandhi": "pinyin with diacritics after sandhi",
          "english": "meaning of this character IN THE CONTEXT OF THIS WORD"
        }
      ]
    }
  ]
}

Rules:
- Use EXACTLY the pre-segmented tokens provided above. Do NOT re-segment or merge/split them. Output one token object per segment, in order.
- For pinyinNumeric: use tone numbers 1-5 (5 = neutral), separate syllables within a word by spaces (e.g. "cha4 bu4 duo1")
- For pinyinSandhi: apply all tone sandhi rules (3rd tone sandhi, 不 sandhi, 一 sandhi) and write with diacritics
- For english: give the CONTEXTUAL meaning only, not all possible meanings
- For particles like 了 or 的, give their grammatical function as the english (e.g. "completion particle", "possessive particle")
- For the "characters" array: include it for ALL tokens, even single-character ones
  - For single-character tokens: the characters array has one entry matching the token
  - For multi-character tokens: give each character's OWN independent meaning — the semantic building block it contributes to the compound, NOT the compound's meaning repeated or paraphrased onto the character
  - Test: the character meaning should make sense if the character appeared in a DIFFERENT compound word. If the meaning only makes sense within this specific word, you are giving the word's meaning, not the character's meaning.
  - Think of it as etymology: what does each character bring to the table? The compound's meaning emerges from combining the characters' individual meanings.
- Return ONLY the JSON, nothing else`;
}

export interface LLMCharacterResponse {
  char: string;
  pinyinNumeric: string;
  pinyinSandhi?: string;
  english: string;
}

export interface LLMTokenResponse {
  surfaceForm: string;
  pinyinNumeric: string;
  pinyinSandhi?: string;
  english: string;
  partOfSpeech: string;
  characters?: LLMCharacterResponse[];
}

export interface LLMResponse {
  chinese: string;
  english: string;
  pinyinSandhi?: string;
  tokens: LLMTokenResponse[];
}

/** Parse the JSON response from the LLM. Handles common issues. */
export function parseLLMResponse(raw: string): LLMResponse {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  // Normalize curly/smart quotes to straight quotes (LLMs sometimes produce these)
  cleaned = cleaned.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  cleaned = cleaned.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  try {
    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.tokens || !Array.isArray(parsed.tokens)) {
      throw new Error('Response missing "tokens" array');
    }

    for (let i = 0; i < parsed.tokens.length; i++) {
      const t = parsed.tokens[i];
      if (!t.surfaceForm) throw new Error(`Token ${i} missing "surfaceForm"`);
      if (!t.pinyinNumeric) throw new Error(`Token ${i} missing "pinyinNumeric"`);
      if (!t.english) throw new Error(`Token ${i} missing "english"`);
    }

    return parsed as LLMResponse;
  } catch (e: any) {
    if (e instanceof SyntaxError) {
      throw new Error(
        `Could not parse JSON. Make sure you copied the entire response from the LLM.\n\nParse error: ${e.message}`
      );
    }
    throw e;
  }
}
