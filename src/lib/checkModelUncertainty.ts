/**
 * Surface the model's own uncertainty at review (#194 follow-up).
 *
 * Every other checker in this pipeline compares the model against an external
 * source — CC-CEDICT for readings, a fixed vocabulary for particles. None of
 * them can see the cases the model itself found hard: a word with no clean
 * English equivalent, two defensible senses, a compound whose parts do not
 * compose. Those are exactly the glosses worth a human glance, and they were
 * invisible.
 *
 * This is not a correctness check. It carries a claim the model volunteered,
 * so it says "worth a look", never "this is wrong".
 */

export interface ModelUncertaintyFlag {
  kind: 'model-uncertain';
  headword: string;
  llmValue: string;
  /** The model's stated reason, when it gave one. */
  note?: string;
}

export function checkModelUncertainty(token: {
  surfaceForm: string;
  english: string;
  uncertain?: boolean;
  uncertaintyNote?: string;
}): ModelUncertaintyFlag | null {
  if (!token.uncertain) return null;
  return {
    kind: 'model-uncertain',
    headword: token.surfaceForm,
    llmValue: token.english,
    note: token.uncertaintyNote?.trim() || undefined,
  };
}
