/**
 * Sanity check: does the analyzer's token list fully cover the source sentence?
 * LLMs occasionally drop a character (commonly pronouns like 我/她), and the
 * ingestion layer trusts the response verbatim. This catches the gap before save.
 */
import { pinyin as toPinyin } from 'pinyin-pro';

const HANZI = /[\u4e00-\u9fff]/;

function hanziOnly(s: string): string[] {
  return [...s].filter((c) => HANZI.test(c));
}

export interface MissingToken {
  surfaceForm: string;
  pinyinNumeric: string;
  insertAtIndex: number;
}

export interface CoverageResult {
  complete: boolean;
  /** Source Hanzi present in the sentence but not in any token. */
  missing: MissingToken[];
}

/**
 * Positional diff: walk source chars in order, advancing through the concatenated
 * token stream. Any source char that doesn't match the expected token char is
 * recorded as missing, with the token index where it should be inserted to keep
 * final ordering correct.
 */
export function computeTokenCoverage(
  source: string,
  tokens: ReadonlyArray<{ surfaceForm: string }>
): CoverageResult {
  const sourceHanzi = hanziOnly(source);
  const tokenHanziPerToken = tokens.map((t) => hanziOnly(t.surfaceForm));
  const tokenStream = tokenHanziPerToken.flat();

  if (sourceHanzi.join('') === tokenStream.join('')) {
    return { complete: true, missing: [] };
  }

  const missing: MissingToken[] = [];
  let streamIdx = 0;
  let tokenIdx = 0;
  let consumedInToken = 0;

  for (const srcCh of sourceHanzi) {
    if (streamIdx < tokenStream.length && tokenStream[streamIdx] === srcCh) {
      streamIdx++;
      consumedInToken++;
      while (
        tokenIdx < tokenHanziPerToken.length &&
        consumedInToken >= tokenHanziPerToken[tokenIdx].length
      ) {
        tokenIdx++;
        consumedInToken = 0;
      }
    } else {
      // Best-effort numeric pinyin from pinyin-pro. Format matches the app's
      // convention ("hao3 chi1"); single-char so we just take one syllable.
      let py = '';
      try {
        py = toPinyin(srcCh, { toneType: 'num', type: 'string' }).trim();
      } catch {
        py = '';
      }
      missing.push({
        surfaceForm: srcCh,
        pinyinNumeric: py,
        insertAtIndex: tokenIdx,
      });
    }
  }

  return { complete: missing.length === 0, missing };
}
