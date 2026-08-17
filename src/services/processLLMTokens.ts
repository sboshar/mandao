import { checkPinyin, type CheckPinyinFlag } from '../lib/checkPinyin';
import { scanSegmentation, type SegmentationFlag } from '../lib/segmentationCheck';
import { checkPinyinPro, readSentence, type PinyinProFlag } from '../lib/checkPinyinPro';
import { applyToneSandhi, numericStringToDiacritic } from './toneSandhi';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

export type IngestFlag = CheckPinyinFlag | SegmentationFlag | PinyinProFlag;

export interface ProcessedToken extends LLMTokenResponse {
  pinyinNumeric: string;
}

export interface ProcessResult {
  tokens: ProcessedToken[];
  flags: IngestFlag[];
}

/**
 * Observation-only pass:
 *   - checkPinyin on each token (disagreements with CC-CEDICT).
 *   - checkPinyinPro on each token (disagreements with pinyin-pro).
 *   - scanSegmentation across the token list (mergeable runs of single-char
 *     tokens that CEDICT treats as one compound, e.g. 哥+哥 → 哥哥).
 * Never mutates a token's pinyinNumeric. The review UI decides whether to
 * apply any suggestion.
 *
 * The LLM's pinyin stands because choosing a polyphone's reading is semantic,
 * not a lookup: 还 is "hái" or "huán" depending on whether the sentence means
 * "still" or "repay", and CEDICT has no 还钱 entry while pinyin-pro misreads it.
 * Only the model understands the sentence, so it decides and the two checkers
 * raise flags when they disagree.
 *
 * pinyinSandhi IS derived here, unlike pinyinNumeric. Sandhi is rule-based once
 * the readings are known, ingestion.ts recomputes it at save time anyway, and
 * deriving it here means review displays the value that will actually be
 * persisted — previously review showed the model's sandhi while a different
 * recomputed one got saved.
 */
export function processLLMTokens(response: LLMResponse): ProcessResult {
  const tokens: ProcessedToken[] = response.tokens.map((t) => ({ ...t }));
  const flags: IngestFlag[] = [];

  // pinyin-pro reads the whole sentence at once so it can disambiguate
  // polyphones from context; each token then takes its slice.
  const sentence = response.chinese || tokens.map((t) => t.surfaceForm).join('');
  const sentenceSyllables = readSentence(sentence);
  const proReadings = new Map<string, string[]>();
  if (sentenceSyllables) {
    let charOffset = 0;
    for (const t of tokens) {
      const charCount = Array.from(t.surfaceForm).length;
      const slice = sentenceSyllables.slice(charOffset, charOffset + charCount);
      charOffset += charCount;
      if (slice.length === charCount) proReadings.set(t.surfaceForm, slice);
    }
  }

  for (const t of tokens) {
    const slice = proReadings.get(t.surfaceForm);
    const result = checkPinyin(t.surfaceForm, t.pinyinNumeric);

    if (result.flag) {
      // cedict-unknown claims the reading is "unchecked". That was true when
      // CEDICT was the only reference, but pinyin-pro answers for words CEDICT
      // has never heard of — and its silence here means it AGREES. Reporting an
      // unchecked reading that was in fact checked and confirmed is just noise,
      // so it's suppressed. Words CEDICT knows still flag normally.
      const coveredByPinyinPro = result.flag.kind === 'cedict-unknown' && !!slice;
      if (!coveredByPinyinPro) flags.push(result.flag);
    }

    if (slice) {
      const flag = checkPinyinPro(t.surfaceForm, t.pinyinNumeric, slice);
      if (flag) flags.push(flag);
    }
  }

  for (const flag of scanSegmentation(tokens)) {
    flags.push(flag);
  }

  // Sandhi spans token boundaries — 不 and 一 shift based on the following
  // syllable, which may belong to the next token — so flatten, transform, slice.
  const allSyllables = tokens.flatMap((t) =>
    t.pinyinNumeric.split(/\s+/).filter(Boolean),
  );
  const sandhied = applyToneSandhi(allSyllables);
  let offset = 0;
  for (const t of tokens) {
    const count = t.pinyinNumeric.split(/\s+/).filter(Boolean).length;
    t.pinyinSandhi = numericStringToDiacritic(
      sandhied.slice(offset, offset + count).join(' '),
    );
    offset += count;
  }

  return { tokens, flags };
}
