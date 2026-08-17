import { checkPinyin, type CheckPinyinFlag } from '../lib/checkPinyin';
import { checkParticleGloss, type ParticleGlossFlag } from '../lib/checkParticleGloss';
import { scanSegmentation, type SegmentationFlag } from '../lib/segmentationCheck';
import { applyToneSandhi, numericStringToDiacritic } from './toneSandhi';
import type { LLMResponse, LLMTokenResponse } from './llmPrompt';

export type IngestFlag = CheckPinyinFlag | SegmentationFlag | ParticleGlossFlag;

export interface ProcessedToken extends LLMTokenResponse {
  pinyinNumeric: string;
}

export interface ProcessResult {
  tokens: ProcessedToken[];
  flags: IngestFlag[];
}

/**
 * ONE CHECKER, NOT TWO. A pinyin-pro cross-check ran here briefly, on the
 * theory that it would cover words CEDICT lacks. Measurement killed it: over a
 * 300-word sample of CEDICT compounds with a neutral second syllable,
 * pinyin-pro matched no CEDICT reading 69% of the time, and is plainly wrong on
 * common words — 值得 as "zhi2 de2", 事情 as "shi4 qing2", 位置 as "wei4 zhi4".
 * A second opinion that unreliable produces noise and offers bad fixes, and the
 * model's own readings have so far been correct where they were checkable. So
 * CEDICT is the single source, and the "Look it up" link is the real tiebreaker.
 *
 * Observation-only pass:
 *   - checkPinyin on each token (disagreements with CC-CEDICT).
 *   - checkParticleGloss on each token (function-word glosses off the canonical
 *     vocabulary, which would fragment one morpheme across several rows).
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

  for (const t of tokens) {
    const result = checkPinyin(t.surfaceForm, t.pinyinNumeric);
    if (result.flag) flags.push(result.flag);

    // Function words carry a fixed vocabulary; an invented wording would become
    // its own Meaning row for a morpheme that already has one.
    const glossFlag = checkParticleGloss(t.surfaceForm, t.pinyinNumeric, t.english);
    if (glossFlag) flags.push(glossFlag);
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
