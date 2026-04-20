import { checkPinyin, type CheckPinyinFlag } from '../lib/checkPinyin';
import { scanSegmentation, type SegmentationFlag } from '../lib/segmentationCheck';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

export type IngestFlag = CheckPinyinFlag | SegmentationFlag;

export interface ProcessedToken extends LLMTokenResponse {
  pinyinNumeric: string;
}

export interface ProcessResult {
  tokens: ProcessedToken[];
  flags: IngestFlag[];
}

/**
 * Observation-only pass:
 *   - checkPinyin on each token (pinyin-level disagreements).
 *   - scanSegmentation across the token list (mergeable runs of single-char
 *     tokens that CEDICT treats as one compound, e.g. 哥+哥 → 哥哥).
 * Never mutates tokens. The review UI decides whether to apply any suggestion.
 */
export function processLLMTokens(response: LLMResponse): ProcessResult {
  const tokens: ProcessedToken[] = response.tokens.map((t) => ({ ...t }));
  const flags: IngestFlag[] = [];

  for (const t of tokens) {
    const result = checkPinyin(t.surfaceForm, t.pinyinNumeric);
    if (result.flag) flags.push(result.flag);
  }

  for (const flag of scanSegmentation(tokens)) {
    flags.push(flag);
  }

  return { tokens, flags };
}
