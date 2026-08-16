/**
 * LLM prompt generator for sentence analysis.
 *
 * Flow: user enters sentence → LLM tokenizes and analyzes → user reviews
 * The LLM handles: segmentation, English translation, pinyin, tone sandhi, character breakdowns, POS.
 *
 * CC-CEDICT is deliberately NOT in this prompt (see #185). It was supplying
 * glosses picked by alphabetical accident — entries[0] of a byte-order sorted
 * file, which yields "Africa" for 非 and "surname Chang" for 常. CEDICT still
 * runs as a post-hoc validator in processLLMTokens (checkPinyin,
 * scanSegmentation), so disagreements surface as review flags instead of
 * being fed to the model as fact.
 */
import * as repo from '../db/repo';
import { getMeaningPinyin } from '../lib/meaningPinyin';

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
 *
 * @param translationReference Optional machine translation of the sentence.
 *   When supplied it is authoritative for the sentence-level english — the
 *   prompt instructs the model to copy it verbatim, and the caller enforces
 *   that regardless of what comes back.
 */
export async function generateAnalysisPrompt(
  chinese: string,
  existingMeanings?: ExistingMeaning[],
  /** Characters the previous response omitted — tells the model to include them this time. */
  missingChars?: string[],
  translationReference?: string,
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
User's existing character meanings (candidate meanings — reuse the exact English string when it fits this context):
${lines}
`;
  }

  const referenceSection = translationReference
    ? `
Reference translation (independent machine translation of this sentence):
  "${translationReference}"
`
    : '';

  const translationRule = translationReference
    ? `A reference translation is supplied above. Copy it into "english" VERBATIM.

This is not a judgement call. Do not reword it, do not "improve" it, and do not
replace it with a more literal rendering. The reference comes from a dedicated
translation system and is authoritative for the sentence level.

In particular: do NOT reason that a more literal gloss is "more accurate". The
sentence-level english is meant to be natural English, not a literal decomposition.
The literal reading lives in the token and character glosses, which is where you
should put it.

If the reference and your instinct disagree, the reference wins. Treat it as a
constraint on the rest of your analysis: choose token and character glosses that are
consistent with the reference's reading of the sentence.`
    : `Translate the complete sentence into natural English.

Prefer the natural contextual meaning over a literal word-for-word translation.`;

  return `Analyze the Chinese sentence below and return ONLY the JSON object specified at the end. No markdown, prose, explanations, or code fences.

Sentence: ${chinese}
${retrySection}${referenceSection}${existingSection}
# Core task

Analyze the sentence at two levels:

1. WORD LEVEL
   Identify the correct words, pronunciation, part of speech, and contextual English meaning.

2. CHARACTER LEVEL
   For every character inside every word, provide exactly ONE English gloss representing that character's best semantic or grammatical contribution to that word in this sentence.

The goal is contextual lexical decomposition: determine what each character contributes to the word as it is actually being used.

# 1. Segmentation

Segment the sentence according to natural Chinese word boundaries.

- Multi-character lexical words should be emitted as one token.
- Never split a lexical compound into individual character tokens.
- Do not merge separate words.
- Reduplicated forms that function as a single lexical or grammatical unit should be emitted as one token (哥哥, 看看, 试试, 慢慢).
- Skip punctuation.
- Every character in the input must appear exactly once in exactly one token.

# 2. Whole-sentence English

${translationRule}

# 3. Token-level English

For each token, provide exactly ONE concise English meaning for the token as used in this sentence.

This is the meaning of the WHOLE TOKEN.

Choose the single meaning that best fits the context.

Do not provide multiple alternative translations.

For example, if a Chinese word can reasonably be translated as either "begin" or "start" in a particular context, choose whichever ONE is the best contextual gloss rather than outputting "begin/start".

# 4. Character-level English

Every token MUST contain a "characters" array with exactly one entry for each character in the token, in the original order.

For each character, provide EXACTLY ONE English gloss representing that character's best semantic, lexical, or grammatical contribution to the word in this sentence.

Think:

  character → ONE best contextual gloss within the word

Do NOT think:

  character → all possible dictionary translations

The character gloss should describe the character's contribution to the word, not simply the meaning of the entire word.

### Important distinction

A character can have several possible English translations in isolation. You must select ONE.

For example, for a different sentence:

  他开始跑步
  他 → "he"
  开 → "begin"
  始 → "start"
  跑 → "run"
  步 → "step"

The point is not that every compound must decompose perfectly into independently translatable English words. The point is that each character should receive the ONE best contextual gloss that explains its role in the word.

Another example:

  电脑
  电 → "electricity"
  脑 → "brain"

The whole word means "computer", but neither character should receive "computer" as its character-level gloss.

Another example:

  火车
  火 → "fire"
  车 → "vehicle"

Again, the character glosses represent the characters' contributions, while the token-level gloss represents the meaning of the complete word.

### Single-gloss requirement

Every character's "english" field MUST contain exactly ONE gloss.

Never output:
- "do/make"
- "self/oneself"
- "begin/start"
- "work/labor"
- "X or Y"
- multiple synonyms
- comma-separated alternatives
- parenthetical alternatives

If multiple English words are plausible, choose the ONE that best fits the character's role in the word.

The gloss may be:
- one English word
- a short English phrase when necessary
- a grammatical label describing a grammatical contribution

For example, grammatical characters may receive glosses such as:
- "possession"
- "completion"
- "plurality"

The character gloss does not have to be the most common standalone translation of the character.

A character's meaning inside a compound may differ from its meaning as a standalone word. The same character takes different glosses in different compounds; that is expected for polysemous characters, not an inconsistency to smooth over.

Do not force an existing standalone meaning onto a character when it does not fit the character's role inside the word.

# 5. Consistency between levels

The three levels form a hierarchy: characters make up a token, tokens make up the
sentence. Your analysis must hold together as one reading of the sentence.

Before returning, read your glosses back upward:

  character glosses  →  should plausibly yield the token gloss
  token glosses      →  should plausibly yield the sentence translation

When a character is polysemous, THIS IS THE TIEBREAKER. Choose the sense that makes
the whole coherent, not the sense that is most common in isolation.

  他花了很多钱  ("He spent a lot of money")
    花钱 → "to spend money"
    花 → "to spend"      ← coherent with the sentence
    花 → "flower"        ← the common standalone sense, incoherent here

If two senses of a character are both defensible, prefer the one that composes into the
token gloss. If two token glosses are both defensible, prefer the one that composes into
the sentence translation.

### Coherence does NOT mean copying the whole meaning downward

Each part contributes to the whole; no part IS the whole.

  非常 → "very"
    非 → "not"      ✅ contributes
    常 → "usual"    ✅ contributes    ("not usual" → "extremely")
    非 → "very"     ❌ this is the whole token's meaning, not the character's

### When coherence is not achievable

Some words are lexicalized: the modern meaning is no longer recoverable from the parts,
usually for historical reasons. Forcing a compositional reading on these produces
nonsense.

  矛盾  "contradiction"   —  矛 = "spear",  盾 = "shield"
  消息  "news"            —  消 = "vanish", 息 = "breath"

For these, give each character its most defensible individual gloss and let the
mismatch stand. Do NOT invent a misleading meaning to make the compound look
compositional, and do NOT copy the token's meaning into its characters.

But do not reach for this escape hatch first. Use it only when no coherent reading
exists. If a sense of the character DOES compose into the token's meaning in this
sentence, that sense is the right answer.

The objective is accuracy, not forced literal decomposition — and not forced
incoherence either.

# 6. Existing user meanings

The supplied user meanings are candidate meanings, not mandatory meanings.

When an existing meaning fits the character's role in the current context, reuse the EXACT English string.

When it does not fit, choose the best contextual gloss instead.

Do not force a user's existing meaning merely because the same character appears. In particular, Mandarin pronouns are not inherently possessive — 他 is "he", not "his"; 我 is "I", not "my". Possession requires 的.

# 7. Polyphones

Many characters have more than one reading. Choose the reading appropriate to this sentence's context, not the most common reading in isolation.

  行: 银行 → hang2;  行走 → xing2
  重: 重复 → chong2; 很重 → zhong4
  长: 长度 → chang2; 长大 → zhang3
  为: 为了 → wei4;   以为 → wei2

# 8. pinyinNumeric

"pinyinNumeric" is citation-form pinyin.

Rules:
- lowercase ASCII
- tone numbers 1-5, where 5 = neutral tone
- spaces between syllables
- exactly one syllable per character
- NO tone sandhi

For example:

  不是
  pinyinNumeric: "bu4 shi4"

  一个
  pinyinNumeric: "yi1 ge4"

Do not change "pinyinNumeric" according to surface pronunciation.

### Neutral tone in compounds

Many common compounds take a neutral tone (5) on the second syllable, which is NOT
predictable from the characters' standalone readings. Use the compound's established
reading, not the concatenation of citation readings:

  哥哥   → "ge1 ge5"     (not "ge1 ge1")
  休息   → "xiu1 xi5"    (not "xiu1 xi1")
  早上   → "zao3 shang5" (not "zao3 shang4")
  不客气 → "bu4 ke4 qi5" (not "bu4 ke4 qi4")
  朋友   → "peng2 you5"  (not "peng2 you3")

This applies to reduplicated kinship and verb forms, and to many high-frequency
disyllabic words. When a compound has an established neutral-tone reading, use it.

# 9. pinyinSandhi

"pinyinSandhi" uses standard pinyin with tone marks and appropriate Mandarin sandhi.

Apply:
- third-tone sandhi
- 不 sandhi
- 一 sandhi
- other standard Mandarin pronunciation changes where appropriate

For example:

  不是
  pinyinSandhi: "bú shì"

  一个
  pinyinSandhi: "yí gè"

Do not apply these changes to "pinyinNumeric".

There must be exactly one syllable per character.

# 10. Part of speech

Assign exactly ONE part of speech to each TOKEN as used in the sentence.

Use only:

"noun" | "verb" | "adj" | "adv" | "prep" | "conj" | "particle" | "measure" | "pronoun" | "number" | "other"

Do not assign multiple parts of speech.

# 11. Transliteration

Set "isTransliteration" to true only for genuine phonetic loanwords where the characters are primarily being used for their sounds rather than their normal semantic meanings.

For example, in a phonetic borrowing such as 沙发 (sofa), the characters are primarily phonetic rather than semantic.

For transliterations, each character's English should describe the phonetic role rather than inventing ordinary semantic meanings, in the form: phonetic (sounds like '<syllable>').

Set "isTransliteration" to false for ordinary native Chinese words and compounds (好吃, 电脑).

# 12. Output schema

{
  "chinese": string,
  "english": string,
  "pinyinSandhi": string,
  "tokens": [
    {
      "surfaceForm": string,
      "pinyinNumeric": string,
      "pinyinSandhi": string,
      "english": string,
      "partOfSpeech": "noun"|"verb"|"adj"|"adv"|"prep"|"conj"|"particle"|"measure"|"pronoun"|"number"|"other",
      "isTransliteration": boolean,
      "characters": [
        {
          "char": string,
          "pinyinNumeric": string,
          "pinyinSandhi": string,
          "english": string
        }
      ]
    }
  ]
}

# 13. Final validation

Before returning the JSON, verify all of the following:

- "chinese" exactly matches the input sentence.
- "english" is a natural translation of the complete sentence.
- "english" is the reference translation verbatim when one was supplied.
- Word segmentation is linguistically correct.
- Every character appears exactly once in exactly one token.
- Every token's "characters" array contains exactly the token's characters in order.
- Every token has exactly ONE contextual English meaning.
- Every character has exactly ONE English gloss.
- Every character gloss is the single best gloss for that character's contribution to its word in context.
- Token glosses cohere with the sentence translation.
- Character glosses cohere with their token's gloss, except where the token is genuinely lexicalized.
- Where a coherent reading was available, it was chosen over the more common standalone sense.
- Character glosses do not simply repeat the whole word's meaning.
- Character glosses contain no alternatives.
- Character glosses contain no "/" characters.
- Character glosses contain no "or".
- Character glosses contain no multiple synonyms.
- Character glosses do not contain comma-separated lists of meanings.
- Existing meanings are reused exactly when appropriate.
- Polyphonic readings are resolved according to context.
- "pinyinNumeric" uses citation-form pronunciation with no sandhi.
- Established neutral-tone compound readings use tone 5.
- "pinyinSandhi" uses diacritics and appropriate sandhi.
- Every pinyin representation contains exactly one syllable per character.
- "isTransliteration" is true only for genuine phonetic transliterations.
- The output is valid JSON.

Return ONLY the JSON object.`;
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
  cleaned = cleaned.replace(/[“”„‟″‶]/g, '"');
  cleaned = cleaned.replace(/[‘’‚‛′‵]/g, "'");

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
