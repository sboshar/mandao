import { resegmentWithCedict } from '../lib/resegment';
import { resolvePinyin, type ResolvePinyinFlag } from '../lib/resolvePinyin';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

/**
 * Shape matching what the ingest path expects downstream. Mirrors
 * LLMTokenResponse but with guaranteed string pinyinNumeric after
 * resolution.
 */
export interface ProcessedToken extends LLMTokenResponse {
  pinyinNumeric: string;
}

export interface ProcessResult {
  tokens: ProcessedToken[];
  flags: ResolvePinyinFlag[];
  /** True iff any token still has a format violation after resolution.
   *  Caller should retry the LLM once with a stricter reminder. */
  hasFormatViolation: boolean;
}

/**
 * Apply the write-time policy to an LLM response:
 *   1. Re-merge mis-segmented compound tokens using CEDICT longest-match.
 *   2. For each token, run resolvePinyin: CEDICT overrides for
 *      single-reading headwords; coerce close polyphone misses; flag
 *      novel readings and CEDICT-unknown words.
 *   3. Collect flags + detect residual format violations so the caller
 *      can decide whether to retry the LLM.
 */
export function processLLMTokens(response: LLMResponse): ProcessResult {
  const resegmented = resegmentWithCedict(
    response.tokens.map((t) => ({
      surfaceForm: t.surfaceForm,
      pinyinNumeric: t.pinyinNumeric,
      english: t.english,
      _orig: t,
    })),
  );

  const tokens: ProcessedToken[] = [];
  const flags: ResolvePinyinFlag[] = [];
  let hasFormatViolation = false;

  for (const seg of resegmented) {
    const original = (seg as unknown as { _orig: LLMTokenResponse })._orig;
    // If resegment merged tokens, we cleared pinyin — rebuild from LLM
    // values for constituent chars when possible, else leave empty and
    // let resolvePinyin fall into the CEDICT-override branch.
    const llmPinyin =
      seg.pinyinNumeric || (original?.pinyinNumeric ?? '');

    const result = resolvePinyin(seg.surfaceForm, llmPinyin);
    if (result.flag) {
      flags.push(result.flag);
      if (result.flag.kind === 'format-violation') hasFormatViolation = true;
    }

    tokens.push({
      // Preserve the LLM's per-token extra fields where we have them.
      ...(original ?? ({} as LLMTokenResponse)),
      surfaceForm: seg.surfaceForm,
      pinyinNumeric: result.pinyinNumeric,
      // Keep the LLM's other fields (english, partOfSpeech, characters…)
      // untouched — we only arbitrate pinyinNumeric here.
    });
  }

  return { tokens, flags, hasFormatViolation };
}
