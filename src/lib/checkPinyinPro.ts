/**
 * Second opinion on the LLM's pinyin, from pinyin-pro (#185).
 *
 * WHY A SECOND OPINION RATHER THAN A REPLACEMENT
 * Choosing between a polyphone's readings is a semantic call, not a lookup.
 * 还 is "hái" (still) or "huán" (repay) depending on what the sentence means,
 * and no dictionary can settle it — CEDICT has no 还钱 entry at all, and
 * pinyin-pro reads 他还钱了 as "ta1 hai2 qian2 le0" when it should be "huan2".
 * The model is the only component that understands "repay money", so its value
 * stands. pinyin-pro just tells the user when the two disagree.
 *
 * This complements checkPinyin, which compares against CC-CEDICT. The two catch
 * different things: CEDICT is authoritative but has gaps, while pinyin-pro
 * always answers and is segmentation-aware. A word missing from CEDICT — where
 * checkPinyin can only shrug with cedict-unknown — still gets checked here.
 *
 * Review-only. buildFlagsForSave re-derives persisted flags from checkPinyin
 * and scanSegmentation alone, so these never reach meaning_flags and need no
 * migration.
 */
import { pinyin as toPinyin } from 'pinyin-pro';
import { collapsePinyin, deSandhi } from './checkPinyin';

export interface PinyinProFlag {
  kind: 'pinyin-pro-disagreement';
  headword: string;
  /** What the model produced — the value that will be saved. */
  llmValue: string;
  /** What pinyin-pro read for the same characters, in sentence context. */
  pinyinProValue: string;
}

/**
 * pinyin-pro writes neutral tone as 0; this app uses 5.
 *
 * It also applies 一 and 不 sandhi in numeric output ("一个" → "yi2 ge4"),
 * which contradicts the citation-form contract for pinyinNumeric. Those two are
 * the only lexical sandhi it applies — third tone is correctly left alone
 * (我很好 → "wo3 hen3 hao3") — so forcing them back is a complete fix, not a
 * patch. Without it every 一 and 不 in the corpus would raise a false flag.
 */
function normalize(chars: string[], syllables: string[]): string[] {
  return syllables.map((syl, i) => {
    if (chars[i] === '一') return 'yi1';
    if (chars[i] === '不') return 'bu4';
    return syl.replace(/0$/, '5');
  });
}

/**
 * Read the whole sentence with pinyin-pro and return one syllable per
 * character. Done sentence-wide rather than per token because pinyin-pro
 * disambiguates polyphones from surrounding context — 我去银行 gives "hang2"
 * only because it can see the whole word.
 *
 * Returns null when the syllable count doesn't line up with the character
 * count, which happens with punctuation or latin text mixed in. Better to skip
 * the check than to compare misaligned syllables and flag everything.
 */
export function readSentence(chinese: string): string[] | null {
  const chars = Array.from(chinese);
  try {
    const raw = toPinyin(chinese, { toneType: 'num', type: 'string' }).trim();
    const syllables = raw.split(/\s+/).filter(Boolean);
    if (syllables.length !== chars.length) return null;
    return normalize(chars, syllables);
  } catch {
    return null;
  }
}

/**
 * Compare one token's pinyin against the sentence reading.
 *
 * @param syllables The token's slice of readSentence's output.
 * @returns A flag when they disagree, otherwise null.
 */
export function checkPinyinPro(
  surfaceForm: string,
  llmValue: string,
  syllables: string[],
): PinyinProFlag | null {
  const pinyinProValue = syllables.join(' ');
  if (!pinyinProValue) return null;

  const target = collapsePinyin(pinyinProValue);
  // Accept the de-sandhied form too. pinyin-pro's output is forced to citation
  // above, but the model sometimes writes sandhi into pinyinNumeric ("bu2 shi4"
  // for 不是). checkPinyin already tolerates that, and flagging it here would
  // fire on every 不 and 一 in the corpus for a mistake that is not a reading
  // error at all.
  if (
    target === collapsePinyin(llmValue) ||
    target === collapsePinyin(deSandhi(llmValue))
  ) {
    return null;
  }

  return {
    kind: 'pinyin-pro-disagreement',
    headword: surfaceForm,
    llmValue,
    pinyinProValue,
  };
}
