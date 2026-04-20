import { resegmentWithCedict, type Resegmentable } from '../lib/resegment';
import { checkPinyin, type CheckPinyinFlag } from '../lib/checkPinyin';
import { lookup as cedictLookup } from '../lib/cedict';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

interface LLMTokenResegInput extends Resegmentable {
  original: LLMTokenResponse;
}

export interface ProcessedToken extends LLMTokenResponse {
  pinyinNumeric: string;
}

export interface ProcessResult {
  tokens: ProcessedToken[];
  flags: CheckPinyinFlag[];
}

function cedictGloss(surfaceForm: string): string | null {
  const entries = cedictLookup(surfaceForm);
  if (entries.length === 0) return null;
  const first = entries[0].english.split('/').filter(Boolean)[0];
  return first?.trim() || null;
}

/**
 * Apply the observation-only pipeline to an LLM response:
 *   1. Re-merge mis-segmented compounds using CEDICT longest-match.
 *      (Structural fix — the LLM got segmentation wrong; not an opinion.)
 *   2. For merged compounds, concatenate the source tokens' LLM pinyin
 *      into the compound's pinyinNumeric. Common outcome: ge1+ge1 for
 *      哥哥. checkPinyin will flag this as cedict-disagreement and the
 *      review UI lets the user one-click accept CEDICT's reading.
 *   3. Use CEDICT's gloss as the merged compound's english — the LLM
 *      only produced character-level english, so this is the only
 *      available source.
 *   4. Run checkPinyin per token. Collect flags. Never mutate values.
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
  const flags: CheckPinyinFlag[] = [];

  for (const seg of resegmented) {
    const isMerged = seg.sources.length > 1;
    const firstSource = seg.sources[0]?.original;

    const pinyinNumeric = isMerged
      ? seg.sources.map((s) => s.pinyinNumeric).filter(Boolean).join(' ')
      : firstSource?.pinyinNumeric ?? '';

    const result = checkPinyin(seg.surfaceForm, pinyinNumeric);
    if (result.flag) flags.push(result.flag);

    const base: LLMTokenResponse = firstSource ?? ({} as LLMTokenResponse);
    const englishOverride = isMerged ? cedictGloss(seg.surfaceForm) : null;

    tokens.push({
      ...base,
      surfaceForm: seg.surfaceForm,
      pinyinNumeric,
      english: englishOverride ?? base.english ?? '',
      characters: isMerged ? undefined : base.characters,
    });
  }

  return { tokens, flags };
}
