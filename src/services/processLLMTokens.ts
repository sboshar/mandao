import { checkPinyin, type CheckPinyinFlag } from '../lib/checkPinyin';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

export interface ProcessedToken extends LLMTokenResponse {
  pinyinNumeric: string;
}

export interface ProcessResult {
  tokens: ProcessedToken[];
  flags: CheckPinyinFlag[];
}

/**
 * Observation-only pass: run checkPinyin on each LLM token, collect flags,
 * return tokens unchanged. Segmentation is trusted as-is — the LLM has
 * sentence context and we'd rather flag disagreements than silently
 * re-segment behind the user's back.
 */
export function processLLMTokens(response: LLMResponse): ProcessResult {
  const tokens: ProcessedToken[] = [];
  const flags: CheckPinyinFlag[] = [];

  for (const t of response.tokens) {
    const result = checkPinyin(t.surfaceForm, t.pinyinNumeric);
    if (result.flag) flags.push(result.flag);
    tokens.push({ ...t, pinyinNumeric: t.pinyinNumeric });
  }

  return { tokens, flags };
}
