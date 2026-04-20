import { resegmentWithCedict, type Resegmentable } from '../lib/resegment';
import { resolvePinyin, type ResolvePinyinFlag } from '../lib/resolvePinyin';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

interface LLMTokenResegInput extends Resegmentable {
  original: LLMTokenResponse;
}

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
  const input: LLMTokenResegInput[] = response.tokens.map((t) => ({
    surfaceForm: t.surfaceForm,
    pinyinNumeric: t.pinyinNumeric,
    english: t.english,
    original: t,
  }));
  const resegmented = resegmentWithCedict(input);

  const tokens: ProcessedToken[] = [];
  const flags: ResolvePinyinFlag[] = [];
  let hasFormatViolation = false;

  for (const seg of resegmented) {
    const firstSource = seg.sources[0]?.original;
    // For a merged compound, individual source pinyins were cleared; let
    // resolvePinyin fall into the CEDICT-override branch with empty input.
    const llmPinyin = seg.pinyinNumeric || firstSource?.pinyinNumeric || '';

    const result = resolvePinyin(seg.surfaceForm, llmPinyin);
    if (result.flag) flags.push(result.flag);
    if (result.hasFormatViolation) hasFormatViolation = true;

    tokens.push({
      ...(firstSource ?? ({} as LLMTokenResponse)),
      surfaceForm: seg.surfaceForm,
      pinyinNumeric: result.pinyinNumeric,
    });
  }

  return { tokens, flags, hasFormatViolation };
}
