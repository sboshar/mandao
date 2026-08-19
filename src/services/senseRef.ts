/**
 * Sense references (#194).
 *
 * The deck used to decide whether a token was a word you already knew by
 * comparing gloss strings with ===. That asks "did the model type the same
 * characters?" when the question is "is this the same sense?" — so 忘我 stored
 * as "absorbed" and returned as "engrossed" produced a second card for one
 * sense, and nobody decided it.
 *
 * Now the senses already in the deck are rendered as a numbered menu, and the
 * model states which one a token uses, or declares a new one. On reuse the
 * model's own wording is discarded and the stored gloss is kept, so phrasing
 * stops being load-bearing.
 */

/** The literal a token uses to declare it is introducing a sense. */
export const NEW_SENSE = 'new';

/** The minimum needed to offer a sense and resolve a reference to it. */
export interface SenseOption {
  headword: string;
  english: string;
  /** "冰箱#1" — what the model writes back. */
  ref: string;
  /** The Meaning this resolves to. */
  id: string;
}

export type OfferedSense = SenseOption;

export type ResolvedSense =
  | { kind: 'existing'; meaningId: string; english: string }
  | { kind: 'new'; english: string };

/**
 * Group meanings by headword and number them, in the order they will be
 * rendered. Indexes are per-request and positional — they never leave the
 * prompt, and code maps them back to real Meaning ids from this same map.
 */
export function buildOfferedSenses(senses: SenseOption[]): Map<string, OfferedSense[]> {
  const byHeadword = new Map<string, OfferedSense[]>();
  for (const sense of senses) {
    byHeadword.set(sense.headword, [...(byHeadword.get(sense.headword) ?? []), sense]);
  }
  return byHeadword;
}

/**
 * Resolve what the model chose.
 *
 * Throws on anything malformed, which routes into the same retry path as a
 * missing surfaceForm. An invalid reference is a detectable failure worth
 * retrying; the alternative — guessing what was meant — is how silent
 * duplicates got created in the first place.
 */
export function resolveSense(
  token: { surfaceForm: string; english: string; senseRef?: string },
  offered: Map<string, OfferedSense[]>,
): ResolvedSense {
  const available = offered.get(token.surfaceForm) ?? [];
  const ref = token.senseRef?.trim();

  if (!ref) {
    // Required only where there was actually something to choose from. Most
    // tokens have no stored senses, and demanding a reference for those would
    // be noise; but staying silent when senses WERE offered is exactly the
    // duplicate-creating case, so that is rejected.
    if (available.length > 0) {
      throw new Error(
        `Token "${token.surfaceForm}" has ${available.length} known sense(s) but no senseRef`,
      );
    }
    return { kind: 'new', english: token.english };
  }

  if (ref === NEW_SENSE) {
    if (!token.english?.trim()) {
      throw new Error(`Token "${token.surfaceForm}" declared a new sense with no english`);
    }
    return { kind: 'new', english: token.english };
  }

  const parsed = /^(.+)#(\d+)$/.exec(ref);
  if (!parsed) throw new Error(`Malformed senseRef "${ref}"`);
  const [, headword, index] = parsed;

  // The reference repeats the headword on purpose: a free cross-check that the
  // model has not attached one token's sense to another.
  if (headword !== token.surfaceForm) {
    throw new Error(`senseRef "${ref}" used on token "${token.surfaceForm}"`);
  }

  const chosen = available[Number(index) - 1];
  if (!chosen) throw new Error(`senseRef "${ref}" was not offered`);

  // The stored gloss wins. Whatever the model wrote in `english` was a claim
  // about this sense, not a new name for it.
  return { kind: 'existing', meaningId: chosen.id, english: chosen.english };
}

/**
 * True when the model introduced a sense for a headword that already had some.
 *
 * Not an error — a word can genuinely gain a sense — but it is the moment a
 * duplicate would be created, so review surfaces it for confirmation rather
 * than letting it happen silently.
 */
export function isUnexpectedNewSense(
  token: { surfaceForm: string; senseRef?: string },
  offered: Map<string, OfferedSense[]>,
): boolean {
  const available = offered.get(token.surfaceForm) ?? [];
  return available.length > 0 && token.senseRef?.trim() === NEW_SENSE;
}
