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
import { normalizePinyinNumeric } from './toneSandhi';

export interface ExistingMeaning {
  headword: string;
  pinyin: string;
  english: string;
}

/** Look up existing meanings for characters in the sentence */
/** Longest headword worth sweeping for. Meanings are words, not clauses; six
 *  characters covers compounds and four-character idioms. */
const MAX_HEADWORD_LEN = 6;

/**
 * Look up every meaning the deck already has for anything appearing in this
 * sentence — words as well as characters.
 *
 * This used to sweep single characters only, which quietly defeated the whole
 * point. If 忘我 was already stored as "engrossed" and a new sentence used it,
 * the model was never told, glossed it "forget self" from scratch, and
 * findOrCreateMeaning forked a SECOND 忘我 row on the differing englishShort.
 * Adding a second context to a word is exactly what the suggestion feature
 * exists to do, so the omission turned that feature against itself.
 *
 * Longest headwords come first: seeing 忘我 before 忘 and 我 is the order in
 * which the information is useful.
 */
export async function getExistingMeanings(
  chinese: string
): Promise<ExistingMeaning[]> {
  const text = chinese.replace(/\s/g, '');
  const chars = Array.from(text);

  // Every distinct substring up to MAX_HEADWORD_LEN. Deduped, because a
  // repeated character would otherwise be queried once per occurrence.
  const candidates = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    for (let len = 1; len <= MAX_HEADWORD_LEN && i + len <= chars.length; len++) {
      candidates.add(chars.slice(i, i + len).join(''));
    }
  }

  const found = await Promise.all(
    [...candidates].map((headword) => repo.getMeaningsByHeadword(headword)),
  );

  return found
    .flat()
    .sort((a, b) => b.headword.length - a.headword.length)
    .map((m) => ({
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
Meanings already in the user's deck for words and characters in this sentence (reuse the exact English string when it fits this context):
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
- Reduplicated forms that function as a single lexical or grammatical unit should be emitted as one token (哥哥, 看看, 试试, 慢慢).
- Skip punctuation.
- Every character in the input must appear exactly once in exactly one token.

## Do not merge separate words

A token must be a WORD. Two words that happen to sit next to each other are two
tokens, however often they co-occur.

Particles are ALWAYS their own token. Never attach 的, 了, 着, 吗, 呢, 吧, 过 to
the word before them:

  ❌ 我的 as one token        ✅ 我 + 的
  ❌ 吃了 as one token        ✅ 吃 + 了

Merging a pronoun with 的 also corrupts the pronoun: in 我 + 的 the possessive
belongs to 的, and 我 still means "I", not "my".

The copula 是 is its own token — it is a verb, not part of what precedes it:

  ❌ 这是 as one token        ✅ 这 + 是

Test: could this token appear in a dictionary as a headword? 我的 and 这是 could
not. 上班 and 非常 could.

# 2. Whole-sentence English

${translationRule}

# 3. Token-level English

For each token, provide exactly ONE concise English meaning for the token as used in this sentence.

This is the meaning of the WHOLE TOKEN.

Choose the single meaning that best fits the context.

Do not provide multiple alternative translations.

For example, if a Chinese word can reasonably be translated as either "begin" or "start" in a particular context, choose whichever ONE is the best contextual gloss rather than outputting "begin/start".

## Function words use a FIXED gloss

Particles and grammatical markers do not get a translation — they get a name for
what they do. Use these EXACT strings. Do not paraphrase them, do not invent
variants, and do not translate the character.

  的   possessive particle           我的书
  的   modifier particle             漂亮的女孩
  地   adverbial particle            慢慢地走
  得   complement particle           说得很好
  了   completion particle           我吃了饭
  了   change-of-state particle      天黑了
  过   experiential particle         我吃过
  着   durative particle             门开着
  吗   yes/no question particle      你好吗
  呢   follow-up question particle   你呢
  吧   suggestion particle           走吧
  啊   emphasis particle             好啊
  呀   emphasis particle             好呀
  们   plural suffix                 我们

Several characters appear twice because they have genuinely different functions.
Pick by what the character is doing in THIS sentence — 的 joining a possessor to
a thing is "possessive particle"; 的 joining a description to a noun is "modifier
particle".

Wording matters as much as accuracy here. "completed action" and "perfective
marker" may describe 了 correctly, but only "completion particle" is the string
this deck uses, and a different wording creates a second card for the same
morpheme.

These strings apply at BOTH levels — as the token's english when the particle is
its own token, and as its character gloss inside the token's characters array.

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

For grammatical characters, use the fixed strings from the function-word table
above ("possessive particle", "completion particle", "plural suffix", …) rather
than inventing a description.

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

  冰箱 → "refrigerator"
    冰 → "ice"           ✅ contributes
    箱 → "box"           ✅ contributes    ("ice box" → refrigerator)
    冰 → "refrigerator"  ❌ this is the whole token's meaning, not the character's

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

These are meanings the user has already studied. They are candidates, not
mandatory — but reusing one is the default, and departing from one has a cost.

When an existing meaning fits, reuse the EXACT English string. A different
wording for the same sense does not read as a synonym downstream; it creates a
SECOND card for a word that already has one, with its own review schedule.

This matters most for WORDS. A multi-character word listed above has already
been given a settled gloss, so unless that gloss is plainly wrong for this
sentence, use it verbatim. If 忘我 is listed as "engrossed", do not write
"forget self" — that is the same word, glossed twice.

For single CHARACTERS the bar is lower, because the same character legitimately
contributes different senses to different compounds (§4). Depart freely when the
listed sense does not fit the compound at hand.

Do not force a user's existing meaning merely because the same character
appears. In particular, Mandarin pronouns are not inherently possessive — 他 is
"he", not "his"; 我 is "I", not "my". Possession requires 的.

# 7. Polyphones

Many characters have more than one reading. Which one is correct depends on what the
character MEANS here, not on which reading is most common in isolation. Different
readings of the same character are effectively different words.

  觉: 觉得 → jue2;  睡觉 → jiao4
  教: 教书 → jiao1; 教室 → jiao4
  空: 空气 → kong1; 有空 → kong4
  为: 为了 → wei4;  以为 → wei2

The same character can take DIFFERENT readings twice in one sentence, when it is being
used with different meanings each time. Do not assume that because a character was read
one way earlier in the sentence, it takes that reading again. Decide each occurrence
from its own context.

# 8. pinyinNumeric

"pinyinNumeric" is citation-form pinyin.

Readings are verified against a dictionary after you answer, and corrected where
the dictionary is unambiguous. The place your answer matters most is POLYPHONES —
characters with more than one reading, where only the sentence tells you which is
correct. Spend your effort there.

Rules:
- lowercase ASCII letters ONLY. Never tone marks. Write "zhe4", never "zhè4" and
  never "zhè". Tone marks belong nowhere in this field.
- EVERY syllable ends in a tone digit 1-5. No syllable may be left bare.
- A syllable with no audible tone is NEUTRAL, and neutral is written 5 — not
  omitted, not 0. "yi4 si5", never "yi4 si" and never "yi4 si0".
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

# 9. Part of speech

Assign exactly ONE part of speech to each TOKEN as used in the sentence.

Use only:

"noun" | "verb" | "adj" | "adv" | "prep" | "conj" | "particle" | "measure" | "pronoun" | "number" | "other"

Do not assign multiple parts of speech.

# 10. Transliteration

Set "isTransliteration" to true only for genuine phonetic loanwords where the characters are primarily being used for their sounds rather than their normal semantic meanings.

For example, in a phonetic borrowing such as 沙发 (sofa), the characters are primarily phonetic rather than semantic.

For transliterations, each character's English should describe the phonetic role rather than inventing ordinary semantic meanings, in the form: phonetic (sounds like '<syllable>').

Set "isTransliteration" to false for ordinary native Chinese words and compounds (好吃, 电脑).

# 11. Output schema

{
  "chinese": string,
  "english": string,
  "tokens": [
    {
      "surfaceForm": string,
      "pinyinNumeric": string,
      "english": string,
      "partOfSpeech": "noun"|"verb"|"adj"|"adv"|"prep"|"conj"|"particle"|"measure"|"pronoun"|"number"|"other",
      "isTransliteration": boolean,
      "characters": [
        {
          "char": string,
          "pinyinNumeric": string,
          "english": string
        }
      ]
    }
  ]
}

# 12. Final validation

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
- "pinyinNumeric" contains exactly one syllable per character.
- Every syllable in "pinyinNumeric" ends in a digit 1-5, neutral written as 5.
- "pinyinNumeric" contains no tone marks — ASCII letters and digits only.
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

      // The model emits tone marks and bare syllables into pinyinNumeric no
      // matter how firmly the prompt forbids it, and each variant raised a
      // spurious flag against an equivalent dictionary value. Normalized here
      // so every consumer sees the documented format.
      t.pinyinNumeric = normalizePinyinNumeric(t.pinyinNumeric);
      for (const c of t.characters ?? []) {
        if (c.pinyinNumeric) c.pinyinNumeric = normalizePinyinNumeric(c.pinyinNumeric);
      }
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
