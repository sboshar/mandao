/**
 * Suggest colloquial sentences that use a word you already know (#187).
 *
 * A meaning normally enters the deck attached to exactly one sentence — the one
 * you happened to add. Seeing 上 only inside 上班 teaches a collocation, not a
 * word. This asks the model for other natural uses so the same meaning can be
 * met in a second context.
 *
 * REGISTER IS THE WHOLE FEATURE. The failure mode is textbook output:
 * grammatical, correct, and nothing a person would actually say. There is no
 * corpus in the app to ground against — CEDICT carries no frequency data and no
 * example sentences — so the register has to be carried by the prompt, and the
 * user is the final filter. That's also why suggestions are cheap to reject.
 */
import { generateCompletion } from './aiProvider';
import * as repo from '../db/repo';

export interface PhraseSuggestion {
  chinese: string;
  english: string;
  /** Why this is a natural thing to say — shown to help the user choose. */
  note?: string;
}

/** Ceiling on what we ask for. More than this is hard to scan and rarely useful. */
const MAX_SUGGESTIONS = 8;

/**
 * Build the request. Takes an array so that selecting several words — asking
 * for sentences that use them together — is a UI change rather than a
 * service change.
 */
export function buildSuggestionPrompt(
  headwords: string[],
  glossByHeadword?: Map<string, string>,
): string {
  const targets = headwords
    .map((h) => {
      const gloss = glossByHeadword?.get(h);
      return gloss ? `  ${h} — "${gloss}"` : `  ${h}`;
    })
    .join('\n');

  const together =
    headwords.length > 1
      ? `\nEvery sentence must use ALL of the target words together. If there is no natural way to use them all in one sentence, return fewer suggestions — or an empty list. Do NOT force them into a contrived sentence just to fill the quota.\n`
      : '';

  return `Suggest up to ${MAX_SUGGESTIONS} short, natural Chinese sentences that use the target word${headwords.length > 1 ? 's' : ''} below.

Target${headwords.length > 1 ? 's' : ''}:
${targets}
${together}
# What makes a good suggestion

Write what a native speaker would ACTUALLY SAY in everyday conversation.

- Everyday spoken register. Think message to a friend, not a textbook exercise.
- Short. Roughly 4-12 characters. These become flashcards.
- The target word must appear verbatim, in its normal usage.
- Vary the contexts. Different grammatical roles and situations teach more than
  five variations of one pattern.

# What to avoid

- Textbook sentences. "这是一本书" is grammatical and worthless.
- Formal or literary register unless the word itself is formal.
- Sentences that exist only to contain the word, with no communicative point.
- Explaining the word instead of using it.
- Rare or archaic senses. Suggest the usage a learner will actually meet.

If the word is itself formal or literary, say so in the note rather than
inventing casual usage that does not exist.

# Output

Return ONLY a JSON array. No markdown, no prose, no code fences.

[
  {
    "chinese": string,   // the sentence, characters only
    "english": string,   // natural English translation
    "note": string       // brief: the situation where you'd say this
  }
]

Return an empty array [] if there is no natural suggestion to make.`;
}

/** Parse the model's array, tolerating the usual fence/prose noise. */
export function parseSuggestions(raw: string): PhraseSuggestion[] {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '').trim();

  // Slice to the outermost array so a stray preamble doesn't break JSON.parse.
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start > 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of suggestions');

  return parsed
    .filter((s) => s && typeof s.chinese === 'string' && s.chinese.trim())
    .map((s) => ({
      chinese: String(s.chinese).trim(),
      english: typeof s.english === 'string' ? s.english.trim() : '',
      note: typeof s.note === 'string' ? s.note.trim() : undefined,
    }))
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Drop suggestions already in the deck.
 *
 * ingestSentence rejects duplicates at save time, but discovering that after
 * the user picked one wastes an analysis call and reads as a bug. Filtering
 * here means the list only ever offers something new.
 */
async function removeExisting(
  suggestions: PhraseSuggestion[],
): Promise<PhraseSuggestion[]> {
  const kept: PhraseSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of suggestions) {
    const key = s.chinese.trim();
    if (seen.has(key)) continue; // the model sometimes repeats itself
    seen.add(key);
    const existing = await repo.getSentenceByNormalizedChinese(key);
    if (!existing) kept.push(s);
  }
  return kept;
}

/**
 * Fetch suggestions for one or more headwords.
 *
 * Throws when the AI provider isn't configured or the response can't be
 * parsed — the caller surfaces the message, since this is a user-initiated
 * action and silent failure would look like "nothing happened".
 */
export async function suggestPhrases(
  headwords: string[],
  glossByHeadword?: Map<string, string>,
): Promise<PhraseSuggestion[]> {
  const targets = headwords.map((h) => h.trim()).filter(Boolean);
  if (targets.length === 0) return [];

  const prompt = buildSuggestionPrompt(targets, glossByHeadword);
  const raw = await generateCompletion(prompt);
  const suggestions = parseSuggestions(raw);

  // A suggestion that doesn't contain the word it was asked for is a
  // non-answer, whatever else it may be.
  const onTarget = suggestions.filter((s) =>
    targets.every((t) => s.chinese.includes(t)),
  );

  return removeExisting(onTarget);
}
