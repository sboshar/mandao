/**
 * Ask the model what KIND of sentence this is and when you would use it (#212).
 *
 * Every other AI call in this app is about meaning: what the words denote, how
 * they are pronounced, how the whole thing translates. None of it answers the
 * question a learner actually has when a card comes up — could I say this, to
 * whom, and where would it sound wrong. A sentence can be word-perfect and
 * still be something no one says, or something you would not say to your boss,
 * and nothing on the card admits it.
 *
 * THE STRUCTURE IS THE POINT. A single "tell me about this sentence" field
 * comes back as a paragraph in which the two facts you can act on — how formal
 * it is, whether it is spoken or written — are a clause somewhere in the middle,
 * and the concrete situations dissolve into "various everyday contexts". Asking
 * for named fields forces the model to commit: pick one register from a closed
 * list, name what the sentence DOES, list situations one at a time. The prose
 * field then carries only what prose is good for.
 *
 * The prose is English — this is a note for the learner, not more material to
 * memorize, and it is deliberately not a second translation, since
 * re-translating is the most common way this answer goes empty. The one piece of
 * Mandarin it does ask for is per-situation: the line that moment actually
 * sounds like, which the panel offers for adding to the deck. A situation
 * described only in English can be read but not studied.
 */
import { generateCompletion, configuredModel } from './aiProvider';
import {
  SENTENCE_MEDIUMS,
  SENTENCE_REGISTERS,
  type SentenceMedium,
  type SentenceRegister,
  type SentenceUsage,
  type UsageSituation,
} from '../db/schema';

/** Ceiling on situations. More than four is a list nobody reads on a card. */
const MAX_SITUATIONS = 4;

/**
 * Length caps.
 *
 * Not a style preference — the description renders on the back of a flashcard
 * between the translation and the audio controls, and a model that decides to
 * write an essay would push everything else off the screen. Truncating is
 * better than letting one answer reflow the card.
 */
const MAX_DESCRIPTION = 1200;
const MAX_SITUATION = 240;
const MAX_EXAMPLE = 60;
const MAX_SPEECH_ACT = 80;
const MAX_CAUTION = 400;

/** What each register means, stated in the prompt so the choice isn't a guess. */
const REGISTER_GUIDE = `  "formal"    — business, officialdom, service encounters, strangers you are
                being careful with. 您, 请, 麻烦您, full grammatical forms.
  "neutral"   — the default. Fine with almost anyone; neither stiff nor familiar.
  "casual"    — friends, family, peers. Contractions, sentence-final particles,
                dropped subjects, the way people actually talk.
  "slang"     — young speakers, internet, in-group. Dates fast; a learner should
                know it is slang before using it.
  "literary"  — written prose, set phrases, chengyu-heavy, classical flavour.
                Saying it aloud in conversation would sound like a recitation.`;

const MEDIUM_GUIDE = `  "spoken"    — you would say this; written down it looks like a transcript.
  "written"   — signs, messages, articles, forms. Said aloud it sounds stilted.
  "both"      — ordinary in either.`;

/**
 * Build the request.
 *
 * The English translation goes in because without it the model spends the
 * answer working out what the sentence means and never reaches usage. It is
 * given as settled, not as something to check.
 */
export function buildUsagePrompt(chinese: string, english?: string): string {
  const meaning = english && english.trim()
    ? `It means: "${english.trim()}"\n`
    : '';

  return `Explain WHEN A LEARNER WOULD USE OR MEET the Chinese sentence below.

Sentence: ${chinese}
${meaning}
Answer in English, about usage. The learner already has the translation and the
per-word glosses; this is the part those cannot tell them.

# What to answer

## register — how formal it is, one of:

${REGISTER_GUIDE}

Register in Chinese is mostly a fact about the RELATIONSHIP between the people
talking, not about how hard the words are. Judge who could say this to whom.

## medium — where it lives, one of:

${MEDIUM_GUIDE}

## speechAct — what the sentence DOES

A few words naming the move being made: "asking a price", "declining politely",
"agreeing reluctantly", "warning someone off". Not a topic label, and not a
restatement of the translation.

## description — two to four sentences

How and when you would use or see this. Say who says it to whom, and what makes
this the phrasing they would reach for rather than another way of saying the same
thing. Mention anything that would surprise a learner: that it is softer or
blunter than the English looks, that it implies a relationship, that it is only
ever heard in one setting.

If the sentence is a textbook construction that no one actually says, SAY SO
PLAINLY. That is the single most useful thing you can tell someone about a
sentence they are about to memorize.

## situations — up to ${MAX_SITUATIONS} concrete situations

Each one has an English description and a Mandarin line from that moment.

### situation — English, one line

A situation a person could picture:

  ✅ "A taxi has stopped one street early and you want to get out here"
  ✅ "Turning down a second helping at a friend's parents' house"
  ❌ "In transportation contexts"          — a category, not a situation
  ❌ "When declining something"            — that is the speech act again

Vary them. Four versions of one situation teach less than two different ones.

### chinese — what that moment sounds like

A Mandarin line belonging to that situation, characters only, roughly 4-14
characters. Either works:

  - THE LINE THAT PROMPTS IT — what the other person says just before. For a
    reply like 还行, the question 周末怎么样？ is the more useful half: a learner who
    can only say the answer cannot hear the question.
  - A FULLER VERSION OF THE REPLY — the sentence as it would really be said in
    that situation, with whatever comes with it.

THIS BECOMES ITS OWN FLASHCARD, so it must stand on its own: a complete, natural
utterance someone would actually produce, not a fragment and not a description.

Do NOT return the sentence being explained verbatim — it is already a card. A
longer sentence that contains it is fine; the bare sentence again is not.

Make the four lines different from each other. If two situations would produce
the same Mandarin, change one of the situations.

### english — a natural translation of YOUR chinese line

Translate the Mandarin you just wrote. Not the situation restated, and not the
translation of the sentence being explained.

## caution — optional

Where this would land wrong: who not to say it to, what it would imply if you
misjudged the setting, a near-identical phrasing that means something else.
Return "" when there is genuinely nothing to warn about — an empty string is a
real answer here, and inventing a caution for a perfectly ordinary sentence is
worse than leaving it out.

# What not to do

- Do not translate the sentence again, or paraphrase the translation.
- Do not gloss individual words or characters. They have their own cards.
- Do not hedge. "This could be used in many different contexts" is not an
  answer; if the sentence really is context-free, say that it is ordinary and
  say what makes it ordinary.
- Do not describe Chinese in general. Every sentence of the answer must be about
  THIS sentence.

# Output

Return ONLY a JSON object. No markdown, no prose, no code fences.

{
  "register": ${SENTENCE_REGISTERS.map((r) => `"${r}"`).join(' | ')},
  "medium": ${SENTENCE_MEDIUMS.map((m) => `"${m}"`).join(' | ')},
  "speechAct": string,
  "description": string,
  "situations": [
    {
      "situation": string,
      "chinese": string,
      "english": string
    }
  ],
  "caution": string
}`;
}

/** Trim, collapse internal whitespace, and cap. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** CJK ideographs — an "example" with no Hanzi in it is not a Mandarin line. */
const HANZI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Coerce whatever is in `situations` into the current shape.
 *
 * Two callers, one job. The parser runs it over fresh model output, where the
 * shape is whatever the model felt like; the panel runs it over stored notes,
 * where entries written before the Mandarin examples existed are bare strings.
 * Normalizing in one place means neither has to know about the other's mess, and
 * an old note keeps rendering its English situations instead of vanishing.
 *
 * A situation with no usable Mandarin keeps its English and loses the example
 * rather than being dropped: the description of the moment is the older half of
 * the feature and still worth reading.
 */
export function readSituations(value: unknown): UsageSituation[] {
  if (!Array.isArray(value)) return [];
  const out: UsageSituation[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const situation = clean(entry, MAX_SITUATION);
      if (situation) out.push({ situation });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const situation = clean(entry.situation, MAX_SITUATION);
    const chinese = clean(entry.chinese, MAX_EXAMPLE);
    const english = clean(entry.english, MAX_SITUATION);
    // The English situation is what makes the row worth showing; an example
    // with nothing to introduce it belongs in the suggestion panel, not here.
    if (!situation) continue;
    out.push(
      HANZI.test(chinese)
        ? { situation, chinese, ...(english ? { english } : {}) }
        : { situation },
    );
  }
  return out;
}

/**
 * Parse the model's object.
 *
 * `description` is the only required field: it is the answer, and a response
 * without one failed regardless of what else came back. Everything else
 * degrades — a register outside the list falls back to "neutral" rather than
 * sinking a good description, because an unrecognized label is a formatting
 * miss and the prose is the part the learner reads.
 */
export function parseSentenceUsage(raw: string): Omit<SentenceUsage, 'generatedAt' | 'model'> {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '').trim();

  // Slice to the outermost object so the preamble the prompt forbade — and
  // which arrives anyway — doesn't break JSON.parse.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start > 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object describing the sentence');
  }

  const description = clean(parsed.description, MAX_DESCRIPTION);
  if (!description) throw new Error('Response had no description');

  const register = SENTENCE_REGISTERS.includes(parsed.register)
    ? (parsed.register as SentenceRegister)
    : 'neutral';
  const medium = SENTENCE_MEDIUMS.includes(parsed.medium)
    ? (parsed.medium as SentenceMedium)
    : 'both';

  const situations = readSituations(parsed.situations).slice(0, MAX_SITUATIONS);

  const caution = clean(parsed.caution, MAX_CAUTION);

  return {
    register,
    medium,
    speechAct: clean(parsed.speechAct, MAX_SPEECH_ACT),
    description,
    situations,
    ...(caution ? { caution } : {}),
  };
}

/**
 * Fetch usage notes for one sentence.
 *
 * Throws when AI isn't configured or the answer can't be parsed. Every caller
 * is acting on an explicit request — a button, or adding a sentence — so the
 * message is worth showing; failing silently would read as a dead button.
 */
export async function generateSentenceUsage(
  chinese: string,
  english?: string,
): Promise<SentenceUsage> {
  const raw = await generateCompletion(buildUsagePrompt(chinese.trim(), english));
  const model = configuredModel();
  return {
    ...parseSentenceUsage(raw),
    generatedAt: Date.now(),
    ...(model ? { model } : {}),
  };
}
