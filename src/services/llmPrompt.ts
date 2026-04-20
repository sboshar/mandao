/**
 * LLM prompt generator for sentence analysis.
 *
 * Flow: user enters sentence → LLM tokenizes and analyzes → user reviews
 * The LLM handles: segmentation, English translation, pinyin, tone sandhi, character breakdowns, POS.
 */
import * as repo from '../db/repo';
import { getMeaningPinyin } from '../lib/meaningPinyin';
import { gatherCedictHits, formatCedictBlock } from '../lib/cedictSweep';

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
  const perChar = await Promise.all(
    chars.map((ch) => repo.getMeaningsByHeadword(ch)),
  );
  return perChar.flat().map((m) => ({
    headword: m.headword,
    pinyin: getMeaningPinyin(m),
    english: m.englishShort,
  }));
}

/**
 * Generate LLM prompt that tokenizes and analyzes a Chinese sentence.
 * The LLM handles both segmentation into words and filling in definitions.
 *
 * Async because we sweep CC-CEDICT for every relevant substring and
 * include those readings as authoritative references in the prompt.
 * The write-time pipeline overrides LLM pinyin with CEDICT anyway, but
 * grounding the prompt up-front produces fewer overrides + fewer flags.
 */
export async function generateAnalysisPrompt(
  chinese: string,
  existingMeanings?: ExistingMeaning[],
  /** Characters the previous response omitted — tells the model to include them this time. */
  missingChars?: string[],
): Promise<string> {
  const retrySection = missingChars && missingChars.length > 0
    ? `\nPrevious attempt omitted: ${missingChars.join(' ')}. Every Hanzi character must appear in exactly one token's surfaceForm.\n`
    : '';

  let existingSection = '';
  if (existingMeanings && existingMeanings.length > 0) {
    const lines = existingMeanings
      .map((m) => `  ${m.headword} [${m.pinyin}] = "${m.english}"`)
      .join('\n');
    existingSection = `
User's existing meanings (reuse the exact english string when it fits this context):
${lines}
`;
  }

  const cedictHits = await gatherCedictHits(chinese);
  const cedictSection = formatCedictBlock(cedictHits);

  return `Tokenize and analyze a Chinese sentence. Return ONLY the JSON object below — no markdown, no prose, no code fences.

Sentence: ${chinese}
${retrySection}${existingSection}${cedictSection}
# Output schema

{
  "chinese": string,              // the input sentence verbatim
  "english": string,              // natural English translation
  "pinyinSandhi": string,         // whole-sentence pinyin, diacritics, sandhi applied
  "tokens": [
    {
      "surfaceForm": string,      // one word or character as segmented
      "pinyinNumeric": string,    // CITATION form, lowercase ASCII + tone digits 1-5
      "pinyinSandhi": string,     // same syllables with diacritics, sandhi applied
      "english": string,          // THIS token's meaning in THIS sentence
      "partOfSpeech": "noun"|"verb"|"adj"|"adv"|"prep"|"conj"|"particle"|"measure"|"pronoun"|"number"|"other",
      "isTransliteration": boolean,
      "characters": [             // present on EVERY token (including single-char)
        { "char": string, "pinyinNumeric": string, "pinyinSandhi": string, "english": string }
      ]
    }
  ]
}

# Rules

## pinyinNumeric (most important — get this right)
- Lowercase ASCII + tone digits 1–5. 5 = neutral. Space between syllables.
- Citation form only. Do NOT apply sandhi: "bu4 shi4" NOT "bu2 shi4"; "yi1 ge4" NOT "yi2 ge4". Sandhi belongs in pinyinSandhi.
- When CEDICT above lists a reading for the whole token, copy it verbatim.
- For multi-character compounds in CEDICT, use the compound's reading — NOT character readings combined:
    哥哥 → ge1 ge5       (not ge1 ge1)
    休息 → xiu1 xi5      (not xiu1 xi1)
    早上 → zao3 shang5   (not zao3 shang4)
    不客气 → bu4 ke4 qi5 (not bu4 ke4 qi4)
- For polyphones (multiple CEDICT entries), pick the reading that fits this sentence's context:
    行: 银行 → hang2; 行走 → xing2
    为: 为了 → wei4; 以为 → wei2

## Segmentation
- Linguistically correct word boundaries. CEDICT compounds above are one token.
- Do NOT split compounds (作业 is one token, not two). Do NOT merge separate words.
- Skip punctuation (。，！？).

## pinyinSandhi
- Apply all sandhi (3rd-tone, 不, 一). Use diacritics.
- Exactly one syllable per character. Never pull syllables from neighboring tokens.

## characters array
- Required on every token.
- Each entry's english is THAT CHARACTER's contribution, not the compound's meaning.
- Test: the gloss should still make sense if the character appeared in a different compound.

## isTransliteration
- True only for phonetic loanwords: 汉堡 (hamburger), 咖啡 (coffee), 沙发 (sofa), 巧克力 (chocolate).
- When true, each character's english must be: phonetic (sounds like '<syllable>').
- Default false. Native compounds (好吃, 电脑) are false.

## english (token-level)
- Contextual meaning only. For particles (了, 的), give the grammatical function ("completion particle", "possessive particle").

Before returning, verify each token's pinyinSandhi syllable count equals its surfaceForm character count.

Return ONLY the JSON.`;
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
