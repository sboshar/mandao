/**
 * LLM prompt generator for sentence analysis.
 *
 * Flow: user enters sentence → LLM tokenizes and analyzes → user reviews
 * The LLM handles: segmentation, English translation, pinyin, tone sandhi, character breakdowns, POS.
 */
import * as repo from '../db/repo';

export interface ExistingMeaning {
  headword: string;
  pinyin: string;
  english: string;
}

/** Look up existing meanings for characters in the sentence */
export async function getExistingMeanings(
  chinese: string
): Promise<ExistingMeaning[]> {
  const chars = [...new Set(Array.from(chinese.replace(/\s/g, '')))];
  const results: ExistingMeaning[] = [];

  for (const ch of chars) {
    const meanings = await repo.getMeaningsByHeadword(ch);

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
 * Generate LLM prompt that tokenizes and analyzes a Chinese sentence.
 * The LLM handles both segmentation into words and filling in definitions.
 */
export function generateAnalysisPrompt(
  chinese: string,
  existingMeanings?: ExistingMeaning[],
  /** Characters the previous response omitted — tells the model to include them this time. */
  missingChars?: string[],
): string {
  const retrySection = missingChars && missingChars.length > 0
    ? `\nIMPORTANT: A previous analysis of this sentence omitted these characters: ${missingChars.join(' ')}. Include them as tokens this time. Every Hanzi character in the sentence must appear in exactly one token's surfaceForm.\n`
    : '';
  let existingSection = '';
  if (existingMeanings && existingMeanings.length > 0) {
    const lines = existingMeanings
      .map((m) => `  ${m.headword} [${m.pinyin}] = "${m.english}"`)
      .join('\n');
    existingSection = `
Reference Meanings (use these EXACT strings for character-level English when they fit):
${lines}

If a character has multiple reference meanings listed, pick the one that fits this context. Use the exact English string from the list. Only assign a new meaning if none of the reference meanings apply.
`;
  }

  return `Tokenize and analyze this Chinese sentence. Return ONLY a JSON object (no markdown, no explanation, no code fences).

Sentence: ${chinese}
${retrySection}${existingSection}
First, segment the sentence into words (tokens). Use linguistically correct word boundaries — for example, 作业 is one word meaning "homework", not two separate characters. Segment the way a native speaker would identify distinct words.

Then return this exact JSON structure:
{
  "chinese": "${chinese}",
  "english": "natural English translation",
  "pinyinSandhi": "full sentence pinyin with tone sandhi applied using diacritics",
  "tokens": [
    {
      "surfaceForm": "the Chinese word/character as segmented",
      "pinyinNumeric": "pinyin with tone numbers BEFORE sandhi e.g. hao3",
      "pinyinSandhi": "pinyin with diacritics AFTER tone sandhi applied",
      "english": "meaning IN THIS CONTEXT (not all meanings)",
      "partOfSpeech": "one of: noun, verb, adj, adv, prep, conj, particle, measure, pronoun, number, other",
      "isTransliteration": false,
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
- Segment into linguistically correct words. Do NOT split compound words into individual characters (e.g. 作业 = one token, 正在 = one token). Do NOT merge separate words.
- Exclude punctuation tokens (。，！？ etc.) — only include content words.
- For pinyinNumeric: use tone numbers 1-5 (5 = neutral), separate syllables within a word by spaces (e.g. "cha4 bu4 duo1"). When a character has multiple accepted pronunciations, prefer the most common colloquial spoken form
- For pinyinSandhi: apply all tone sandhi rules (3rd tone sandhi, 不 sandhi, 一 sandhi) and write with diacritics. Each token's pinyinSandhi must contain ONLY the syllables for that token's characters — never include syllables from neighboring tokens. For example, 作业 should be "zuòyè" (2 syllables for 2 characters), NOT "zuò zuòyè".
- For english: give the CONTEXTUAL meaning only, not all possible meanings
- For particles like 了 or 的, give their grammatical function as the english (e.g. "completion particle", "possessive particle")
- For the "characters" array: include it for ALL tokens, even single-character ones
  - For single-character tokens: the characters array has one entry matching the token
  - For multi-character tokens: give each character's OWN independent meaning — the semantic building block it contributes to the compound, NOT the compound's meaning repeated or paraphrased onto the character
  - Test: the character meaning should make sense if the character appeared in a DIFFERENT compound word. If the meaning only makes sense within this specific word, you are giving the word's meaning, not the character's meaning.
  - Think of it as etymology: what does each character bring to the table? The compound's meaning emerges from combining the characters' individual meanings.
- isTransliteration: set true ONLY when the token is a phonetic loanword — the characters were chosen to approximate a foreign word's SOUND, and their normal literal meanings do not compose into the token's meaning. Examples: 汉堡 (hamburger), 咖啡 (coffee), 沙发 (sofa), 巧克力 (chocolate), 披萨 (pizza), 沙拉 (salad), 三明治 (sandwich), 可乐 (cola), 吉他 (guitar), 摩托 (motor), 麦克风 (microphone). Set false for native compounds (好吃, 作业, 电脑 "electric brain", etc.) and for semantic loans that translate meaning rather than sound.
  - When isTransliteration is true, each character's "english" MUST be the phonetic gloss: "phonetic (sounds like '<syllable>')" — do NOT invent a literal meaning for that character in this word. The character's normal meanings still exist in isolation, but in this compound the character is contributing sound, not sense.
  - Omit the field or set it to false when uncertain — false is the safe default.
- Validation: before returning, verify that each token's pinyinSandhi has exactly as many syllables as characters in its surfaceForm. If not, you have accidentally merged pinyin from a neighboring token — fix it.
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
  /** True for phonetic loanwords (e.g. 汉堡 = hamburger) — characters contribute sound, not meaning. */
  isTransliteration?: boolean;
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
