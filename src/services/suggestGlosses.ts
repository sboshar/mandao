/**
 * Alternative glosses for one word in one sentence.
 *
 * Reached from an uncertainty flag, where the model has said its own answer was
 * a judgement call. The alternative was a link out to a chat model: leave the
 * app, read prose, come back, type the gloss by hand — four steps to change one
 * field, and typing reintroduces the free-text problem senseRef exists to
 * remove.
 *
 * So this returns CANDIDATES YOU CLICK, plus the reasoning inline. Same
 * choose-don't-type principle as senseRef, one level down.
 *
 * It also looks up what the deck already holds for the word and asks the model
 * to point at one of those when it fits. That closes a gap: declaredNewSense
 * warns that a new sense is being minted, but offers nothing to pick instead.
 *
 * Narrower than the full analysis — one word, one sentence — which is an easier
 * task than analysing everything at once. Worth remembering that it is the same
 * model with the same blind spots, though: on a word it glossed badly it may
 * offer several wordings of the same wrong answer. Useful, not authoritative.
 */
import { generateCompletion } from './aiProvider';
import * as repo from '../db/repo';
import { getMeaningPinyin } from '../lib/meaningPinyin';

export interface GlossCandidate {
  english: string;
  /** Why this one — a few words, not an essay. */
  note?: string;
  /**
   * Set when this candidate is a sense the deck already has. Choosing it should
   * reuse that row rather than create one.
   */
  meaningId?: string;
}

export interface GlossSuggestions {
  /** What the word is doing in this sentence, in a sentence or two. */
  reasoning: string;
  candidates: GlossCandidate[];
}

const MAX_CANDIDATES = 5;

export function buildGlossPrompt(
  sentence: string,
  surfaceForm: string,
  currentGloss: string,
  existing: { id: string; pinyin: string; english: string }[],
): string {
  const existingBlock = existing.length
    ? `\nSenses this user's deck already has for ${surfaceForm}:\n${existing
        .map((e, i) => `  [${i + 1}] "${e.english}"  (${e.pinyin})`)
        .join('\n')}\n\nWhen one of these is the right answer, return it as a candidate with its
number in "existingIndex". Reusing a sense the user already studies is better
than a fresh wording of the same thing.\n`
    : '';

  return `A learner is adding a Chinese sentence to a flashcard deck. One word's English
gloss is in doubt and they need better options.

Sentence: ${sentence}
Word: ${surfaceForm}
Current gloss: "${currentGloss}"
${existingBlock}
# What to return

First, briefly explain what ${surfaceForm} is doing in THIS sentence — the sense it
carries here, and why. Two or three sentences. If the current gloss is wrong, say
so and say why.

Then give up to ${MAX_CANDIDATES} candidate glosses, best first.

# What makes a good candidate

- It names what ${surfaceForm} names, in THIS sentence.
- It stands alone. This goes on a flashcard with the sentence nowhere in sight,
  so a fragment lifted out of a translation is not a candidate — "lost" is not a
  gloss for a word meaning absorbed, it is a piece of the phrase "lost in".
- It covers only what ${surfaceForm} contributes. The other words in the sentence
  carry their own meaning and get their own cards, so do not fold any of it in.
  A degree word, measure word or quantifier next to it is especially easy to
  absorb, because the English reads naturally with it included — in 他很高, 高 is
  "tall", not "very tall"; "very" is 很's job.
- A phrase is fine when a phrase is the accurate answer. Brevity is not the goal.
- Include the current gloss as a candidate if it is defensible, so the learner can
  keep it deliberately.
- Do not pad the list. Three good candidates beat five with two duplicates.

# Output

Return ONLY a JSON object. No markdown, no prose outside the JSON, no code fences.

{
  "reasoning": string,
  "candidates": [
    {
      "english": string,        // the gloss
      "note": string,           // a few words on why, or ""
      "existingIndex": number   // the number above when this is one of the deck's
                                // senses, otherwise 0
    }
  ]
}`;
}

export function parseGlossSuggestions(
  raw: string,
  existing: { id: string }[],
): GlossSuggestions {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '').trim();

  // Slice to the outermost object so a stray preamble doesn't break the parse.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start > 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  const parsed = JSON.parse(cleaned);
  const rawCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

  const seen = new Set<string>();
  const candidates: GlossCandidate[] = [];
  for (const c of rawCandidates) {
    const english = typeof c?.english === 'string' ? c.english.trim() : '';
    if (!english) continue;
    const key = english.toLowerCase();
    if (seen.has(key)) continue; // the model repeats itself
    seen.add(key);

    const idx = Number(c?.existingIndex) || 0;
    candidates.push({
      english,
      note: typeof c?.note === 'string' && c.note.trim() ? c.note.trim() : undefined,
      meaningId: idx > 0 ? existing[idx - 1]?.id : undefined,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return {
    reasoning: typeof parsed?.reasoning === 'string' ? parsed.reasoning.trim() : '',
    candidates,
  };
}

/**
 * Ask for alternative glosses. Throws on a provider or parse failure, since
 * this is user-initiated and silence would read as nothing happening.
 */
export async function suggestGlosses(
  sentence: string,
  surfaceForm: string,
  currentGloss: string,
): Promise<GlossSuggestions> {
  const stored = await repo.getMeaningsByHeadword(surfaceForm);
  const existing = stored.map((m) => ({
    id: m.id,
    pinyin: getMeaningPinyin(m),
    english: m.englishShort,
  }));

  const raw = await generateCompletion(
    buildGlossPrompt(sentence, surfaceForm, currentGloss, existing),
  );
  return parseGlossSuggestions(raw, existing);
}
