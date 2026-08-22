/**
 * Which of these words use the character in THIS sense, commonest first (#204).
 *
 * Reading already separated the morphemes deterministically, but it cannot split
 * senses inside one reading: 长 as zhang3 is both "chief" (部长, 家长, 校长) and
 * "to grow" (长大, 长相, 助长). Deciding which is a judgement about meaning, so
 * it is the one part of this feature a model does.
 *
 * THE MODEL PICKS NUMBERS, NEVER WORDS. Candidates come from CEDICT and are sent
 * numbered; the reply is a list of indexes. That makes an invented word
 * structurally impossible rather than something to detect afterwards — the same
 * choose-don't-type discipline as senseRef, one level along. Anything out of
 * range is dropped and counted, so a malformed reply degrades to a shorter list
 * instead of a wrong one.
 *
 * Ordering rides along in the same call. It is a closed list, so this is "sort
 * these 40 real words by how common they are" rather than recall, and the call
 * was already being made. A mis-ordered list still holds only real words with
 * the right sense — a much cheaper error than a fabricated entry, which is why
 * ranking is acceptable here while generation is not. If the order proves poor,
 * a frequency list is the fix, not a better prompt.
 */
import { generateCompletion } from './aiProvider';
import type { CharWord } from './charWords';

export interface SameSenseResult {
  /** Kept words, in the order the model returned. */
  words: CharWord[];
  /** How it read the sense — shown so a wrong reading of the sense is visible. */
  reasoning: string;
  /** Indexes that pointed nowhere. Non-zero means the reply was malformed. */
  droppedInvalid: number;
}

export function buildSameSensePrompt(
  char: string,
  reading: string,
  sense: string,
  candidates: CharWord[],
): string {
  const list = candidates
    .map((c, i) => `  [${i + 1}] ${c.word}  (${c.pinyin})  ${c.gloss}`)
    .join('\n');

  return `A learner is studying the Chinese character ${char}, in this sense:

  ${char} (${reading}) — "${sense}"

Below are real dictionary words that contain ${char} and read it the same way.
Some use ${char} in the sense above; others use a different sense of it.

${list}

# What to return

Pick the numbers of the words where ${char} carries the sense "${sense}".

Order them by how common the WORD is in everyday modern Chinese, commonest
first — the words a learner is most likely to meet should come first.

# Rules

- Return ONLY numbers from the list above. Do not name a word that is not
  listed, and do not invent one.
- Leave out a word if ${char} means something else in it, even though it is
  pronounced the same. A character often has several unrelated senses under one
  reading.
- Leave out a word if ${char} is only there for its sound, contributing no
  meaning — common in names and borrowings.
- Do not pad the list. Six well-chosen words beat twenty with half of them
  wrong or obscure.

# Output

Return ONLY a JSON object. No markdown, no prose outside the JSON, no fences.

{
  "reasoning": string,   // one or two sentences: what sense you matched on
  "keep": number[]       // the numbers, commonest first
}`;
}

export function parseSameSense(
  raw: string,
  candidates: CharWord[],
): SameSenseResult {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '').trim();

  // Slice to the outermost object so a stray preamble doesn't break the parse.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start > 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  const parsed = JSON.parse(cleaned);
  const keep = Array.isArray(parsed?.keep) ? parsed.keep : [];

  const words: CharWord[] = [];
  const used = new Set<number>();
  let droppedInvalid = 0;
  for (const value of keep) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > candidates.length) {
      droppedInvalid++;
      continue;
    }
    if (used.has(n)) continue; // the model repeats itself
    used.add(n);
    words.push(candidates[n - 1]);
  }

  return {
    words,
    reasoning:
      typeof parsed?.reasoning === 'string' ? parsed.reasoning.trim() : '',
    droppedInvalid,
  };
}

/**
 * Narrow a candidate list to one sense of the character. Throws on a provider
 * or parse failure, since this is user-initiated and silence would read as
 * nothing having happened.
 */
export async function findSameSenseWords(
  char: string,
  reading: string,
  sense: string,
  candidates: CharWord[],
): Promise<SameSenseResult> {
  if (candidates.length === 0) {
    return { words: [], reasoning: '', droppedInvalid: 0 };
  }
  const raw = await generateCompletion(
    buildSameSensePrompt(char, reading, sense, candidates),
  );
  return parseSameSense(raw, candidates);
}
