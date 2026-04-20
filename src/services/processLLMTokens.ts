import { resegmentWithCedict, type Resegmentable } from '../lib/resegment';
import { resolvePinyin, type ResolvePinyinFlag } from '../lib/resolvePinyin';
import { lookup as cedictLookup } from '../lib/cedict';
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
}

function cedictGloss(surfaceForm: string): string | null {
  const entries = cedictLookup(surfaceForm);
  if (entries.length === 0) return null;
  const first = entries[0].english.split('/').filter(Boolean)[0];
  return first?.trim() || null;
}

/**
 * Apply the write-time policy to an LLM response:
 *   1. Re-merge mis-segmented compound tokens using CEDICT longest-match.
 *   2. For each token, run resolvePinyin: CEDICT overrides for
 *      single-reading headwords; coerce close polyphone misses; flag
 *      novel readings and CEDICT-unknown words.
 *   3. For merged compounds, prefer CEDICT's gloss over the first
 *      constituent character's english (which would otherwise be e.g.
 *      "elder brother" for a merged 哥哥 rather than "older brother").
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

  for (const seg of resegmented) {
    const firstSource = seg.sources[0]?.original;
    const isMerged = seg.sources.length > 1;
    const llmPinyin = seg.pinyinNumeric || firstSource?.pinyinNumeric || '';

    const result = resolvePinyin(seg.surfaceForm, llmPinyin);
    if (result.flag) flags.push(result.flag);

    const base: LLMTokenResponse = firstSource ?? ({} as LLMTokenResponse);
    const englishOverride = isMerged ? cedictGloss(seg.surfaceForm) : null;

    tokens.push({
      ...base,
      surfaceForm: seg.surfaceForm,
      pinyinNumeric: result.pinyinNumeric,
      english: englishOverride ?? base.english ?? '',
      // Character-level breakdown from the first source can't describe
      // the compound accurately; clear it so the user re-populates from
      // the compound's canonical definition.
      characters: isMerged ? undefined : base.characters,
    });
  }

  return { tokens, flags };
}
