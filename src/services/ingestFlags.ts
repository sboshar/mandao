import { checkPinyin } from '../lib/checkPinyin';
import { scanSegmentation } from '../lib/segmentationCheck';
import type { IngestFlag as PersistedIngestFlag } from './ingestion';

interface TokenShape {
  surfaceForm: string;
  pinyinNumeric: string;
}

/**
 * Build the flag records a sentence will persist, by re-running
 * checkPinyin + scanSegmentation against the final token list the
 * user is about to save. This is the single source of truth for
 * "what flags should land in meaning_flags" — AddSentencePage calls
 * this at save time so manual edits + merges are reflected.
 *
 * llmValueByHeadword lets the persisted flag keep a memory of what
 * the LLM originally emitted, even if the user has since changed the
 * value in the review form.
 */
export function buildFlagsForSave(
  tokenInputs: TokenShape[],
  llmValueByHeadword: Map<string, string>,
): PersistedIngestFlag[] {
  const flags: PersistedIngestFlag[] = [];

  for (const t of tokenInputs) {
    const check = checkPinyin(t.surfaceForm, t.pinyinNumeric);
    if (!check.flag) continue;
    flags.push({
      headword: t.surfaceForm,
      storedPinyin: t.pinyinNumeric,
      llmValue: llmValueByHeadword.get(t.surfaceForm) ?? t.pinyinNumeric,
      flagKind: check.flag.kind,
      cedictSuggestions: check.cedictSuggestions,
    });
  }

  for (const seg of scanSegmentation(tokenInputs)) {
    flags.push({
      headword: seg.headword,
      storedPinyin: seg.llmValue,
      llmValue: llmValueByHeadword.get(seg.headword) ?? seg.llmValue,
      flagKind: seg.kind,
      cedictSuggestions: seg.cedictSuggestions,
    });
  }

  return flags;
}
