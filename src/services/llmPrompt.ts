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
  /** "忘我#1" — what the model writes back to choose this sense (#194). */
  ref: string;
  /** The Meaning this ref resolves to. */
  id: string;
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

  const meanings = found
    .flat()
    .sort((a, b) => b.headword.length - a.headword.length);

  // Numbering must match buildOfferedSenses, since the model writes these refs
  // back and resolveSense looks them up by position.
  const seen = new Map<string, number>();
  return meanings.map((m) => {
    const n = (seen.get(m.headword) ?? 0) + 1;
    seen.set(m.headword, n);
    return {
      headword: m.headword,
      pinyin: getMeaningPinyin(m),
      english: m.englishShort,
      ref: `${m.headword}#${n}`,
      id: m.id,
    };
  });
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
    const byHeadword = new Map<string, ExistingMeaning[]>();
    for (const m of existingMeanings) {
      byHeadword.set(m.headword, [...(byHeadword.get(m.headword) ?? []), m]);
    }
    const lines = [...byHeadword.entries()]
      .map(([headword, senses]) =>
        [
          `  ${headword}`,
          ...senses.map((m) => `    ${m.ref}  [${m.pinyin}]  "${m.english}"`),
        ].join('\n'),
      )
      .join('\n');
    existingSection = `
Senses already in the user's deck for words and characters in this sentence.

For each token, set "senseRef" to the id of the sense it carries here. When it
carries a sense that is NOT listed, set "senseRef" to "new" and put your gloss in
"english".

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
    ? `A reference translation is supplied above, from a dedicated translation system.
It is usually right about WHAT THE SENTENCE MEANS. Treat it as a strong starting
point, not as text to copy.

YOUR JOB AT THIS LEVEL IS THE MOST NATURAL ENGLISH, not fidelity to the reference.

Machine translations are often correct about meaning but rarely the most natural
wording. Overriding is expected, not exceptional. If a shorter or more idiomatic
sentence says the same thing, write that one instead — do not stay close to the
reference's phrasing out of caution. A rendering that reads as translated English
rather than as something a fluent speaker would say is the wrong answer, even when
every word of it is defensible.

What you may NOT do is change what the sentence MEANS, and in particular you may
not drift toward a more literal or dictionary-flavoured reading. The reference was
produced with the whole sentence in view; an isolated dictionary sense was not. If
you disagree with the reference about meaning rather than wording, it is more
likely right than you are.

Treat its reading as a constraint on the rest of your analysis: token and character
glosses should be consistent with how the sentence is rendered.`
    : `Translate the complete sentence into THE MOST NATURAL ENGLISH — the version a
fluent speaker would actually say, not a rendering that reads as translated.

Prefer the natural contextual meaning over a literal word-for-word mapping. A
sentence in which every word is defensible but the whole reads as translation
English is the wrong answer.`;

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

  ❌ 你的 as one token        ✅ 你 + 的
  ❌ 他睡了 as one token      ✅ 他 + 睡 + 了

Merging a pronoun with 的 also corrupts the pronoun: in 你 + 的 the possessive
belongs to 的, and 你 still means "you", not "your".

The copula 是 is its own token — it is a verb, not part of what precedes it:

  ❌ 那是 as one token        ✅ 那 + 是

Test: could this token appear in a dictionary as a headword? 你的 and 那是 could
not. 冰箱 and 教室 could.

# 2. Whole-sentence English

${translationRule}

# 3. Token-level English

For each token, provide exactly ONE concise English meaning — THE MEANING IT
CARRIES IN THIS SENTENCE, not the meaning it has on its own.

This is the single most important instruction in this section. The gloss is not a
dictionary entry. It is what the word is doing HERE.

Ask: how did I render this word in the sentence translation above? That is the
gloss. If the sentence says a word means one thing and you are about to write down
another, you are writing the dictionary's answer instead of the sentence's, and
that is wrong.

A word can carry a sense in one sentence that is unrelated to the sense it usually
carries alone. That is normal, and it is exactly what this field is for. Reaching
for the common standalone meaning when the context points elsewhere is the most
frequent error in this task.

### But the gloss must still stand on its own

Contextual does NOT mean "a piece of my translation". This gloss goes on a
flashcard with the sentence nowhere in sight, so it has to mean something by
itself.

DO NOT PICK A WORD OUT OF YOUR OWN TRANSLATION. This is the most common way this
field goes wrong. Your English sentence contains words that sit NEXT to the right
meaning without being it, and reaching into it for one of them produces a gloss
that looks supported by the sentence and is still wrong.

TEST: cover the sentence and read the gloss alone. Does it name the same thing the
Chinese word names?

  translation "…she burst into laughter"
    gloss "burst"     ✗ alone this means to rupture. It is a fragment of the
                        phrase "burst into", not a meaning of the word

  translation "…he brought flowers as a thank-you"
    gloss "thank-you" ✗ that is the sentiment, if the word names the FLOWERS
    gloss "bouquet"   ✓ names the same thing the word names

A gloss may be a phrase — many are, and a phrase is often the only accurate
answer. The requirement is not brevity or that it look like a headword. The
requirement is that it denote what the Chinese word denotes, with the sentence
taken away.

This is the meaning of the WHOLE TOKEN.

Do not provide multiple alternative translations.

For example, if a Chinese word can reasonably be translated as either "begin" or "start" in a particular context, choose whichever ONE is the best contextual gloss rather than outputting "begin/start".

## Function words use a FIXED gloss

Particles and grammatical markers do not get a translation — they get a name for
what they do. Use these EXACT strings. Do not paraphrase them, do not invent
variants, and do not translate the character.

  的   possessive particle           妈妈的手机
  的   modifier particle             漂亮的女孩
  地   adverbial particle            慢慢地走
  得   complement particle           说得很好
  了   completion particle           他睡了
  了   change-of-state particle      天亮了
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

### The sentence translation binds the token glosses

Your sentence translation has already committed to what each word means here. Every
token gloss must agree with that commitment.

Do not translate a word one way in the sentence and a different way in its own
gloss. If your sentence renders a word as one thing and an isolated dictionary
would render it as another, THE SENTENCE WINS — it was written with the whole
context in view, and the dictionary sense was not.

This is the most common way an analysis goes wrong: the sentence is translated by
reading the context, while the token gloss is filled in from what the word usually
means on its own. The two then contradict each other, and the contradiction is the
error — not a difference of emphasis.

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

# 6. Choosing a sense — "senseRef"

EVERY token needs a "senseRef". It says which sense of that word the token
carries.

  senseRef: "<ref>"   the token carries that listed sense
  senseRef: "new"     the token carries a sense that is NOT listed

Use a listed ref whenever the token carries that sense, EVEN IF you would have
worded the gloss differently. A different wording of a listed sense is not a new
sense — it is the same card described twice, and choosing "new" for it creates a
duplicate with its own review schedule.

  listed:  冰箱#1  "refrigerator"
  you would have written "fridge"
  → senseRef: "冰箱#1"     ✅ same sense, listed wording wins
  → senseRef: "new"        ❌ this is not a new sense

Choose "new" only when the token genuinely carries a sense none of the listed
ones covers — a different meaning, not a different phrasing.

When a token's headword has no listed senses, use "new".

Still write "english" either way. When you reference a listed sense it is read as
a claim about that sense and checked against it; the listed wording is what gets
stored. When you choose "new", "english" is the gloss that will be stored.

Do not force a listed sense merely because the same character appears. In
particular, Mandarin pronouns are not inherently possessive — 他 is "he", not
"his"; 我 is "I", not "my". Possession requires 的.

# 7. Flagging your own uncertainty

Set "uncertain" to true on a token when your answer for it is a judgement call
rather than a fact, and put a brief reason in "uncertaintyNote". Otherwise set it
to false and leave the note empty.

Flag a token when:
- no English word denotes it cleanly, and your gloss is an approximation
- two senses were both defensible here and you picked one
- the compound does not decompose, so the character glosses do not compose into it
- the segmentation was arguable — the run could reasonably be split another way
- the reading depended on a judgement about meaning rather than a lookup

Do NOT flag ordinary vocabulary. A common noun with a direct English equivalent is
not uncertain because a synonym exists. If most tokens in a sentence are flagged,
the flag has stopped carrying information.

The note is for the user reviewing this card, not an apology. Say what the choice
was, in a few words: "could also be X", "no exact English equivalent", "literal
parts do not compose".

Being uncertain is not a failure and does not lower the quality of your answer. An
unflagged wrong gloss is worse than a flagged one, because the user has no reason
to look at it.

# 8. Polyphones

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

# 9. pinyinNumeric

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
  "tokens": [
    {
      "surfaceForm": string,
      "pinyinNumeric": string,
      "english": string,
      "senseRef": string,
      "uncertain": boolean,
      "uncertaintyNote": string,
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

# 13. Final validation

Before returning the JSON, verify all of the following:

- "chinese" exactly matches the input sentence.
- "english" is a natural translation of the complete sentence.
- "english" is natural English, and where a reference translation was supplied it
  does not contradict that reference's MEANING (rewording is fine).
- Word segmentation is linguistically correct.
- Every character appears exactly once in exactly one token.
- Every token's "characters" array contains exactly the token's characters in order.
- Every token has exactly ONE contextual English meaning.
- Every character has exactly ONE English gloss.
- Every character gloss is the single best gloss for that character's contribution to its word in context.
- No token gloss contradicts how that token is rendered in the sentence translation.
- Character glosses cohere with their token's gloss, except where the token is genuinely lexicalized.
- Where a coherent reading was available, it was chosen over the more common standalone sense.
- Character glosses do not simply repeat the whole word's meaning.
- Character glosses contain no alternatives.
- Character glosses contain no "/" characters.
- Character glosses contain no "or".
- Character glosses contain no multiple synonyms.
- Character glosses do not contain comma-separated lists of meanings.
- Every token has a "senseRef": a listed ref, or "new".
- "uncertain" is set on tokens that were a judgement call, with a brief note, and
  not on ordinary vocabulary.
- A listed ref was used wherever the token carries that sense, even if you would
  have worded it differently.
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
  /** Which stored sense this token uses, or "new" (#194). */
  senseRef?: string;
  /** The model's own judgement that this token was a close call. */
  uncertain?: boolean;
  /** Brief reason, shown at review when uncertain is set. */
  uncertaintyNote?: string;
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
