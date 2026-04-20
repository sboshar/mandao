import { lookup, loadCedict, firstGloss, type DictEntry } from './cedict';

export interface CedictHit {
  sub: string;
  entries: DictEntry[];
  firstPos: number;
}

const CJK_RE = /^[\u4e00-\u9fff]+$/;

function isCJK(s: string): boolean {
  return CJK_RE.test(s);
}

/**
 * Collect every CC-CEDICT entry whose headword is a substring of the sentence.
 * Filters to reduce noise in the LLM prompt:
 *   - length ≥ 2 (compounds): always included, these carry compound readings
 *     (哥哥 [ge1 ge5], 早上 [zao3 shang5]) the LLM needs to know about.
 *   - length == 1 (single char): only when the character is a polyphone —
 *     multiple CEDICT entries. Single-reading single chars (我 [wo3], 渴 [ke3])
 *     are dropped; the LLM already knows them and they drown the signal.
 *
 * Deduped by substring, sorted longest-first so compound hits appear above
 * character hits in the rendered prompt block.
 */
export async function gatherCedictHits(
  chinese: string,
  maxLen = 4,
): Promise<CedictHit[]> {
  /** Bound prompt size for long, compound-dense sentences. */
  const MAX_HITS = 40;
  await loadCedict();
  const seen = new Map<string, CedictHit>();
  for (let i = 0; i < chinese.length; i++) {
    for (let len = 1; len <= maxLen && i + len <= chinese.length; len++) {
      const sub = chinese.slice(i, i + len);
      if (seen.has(sub)) continue;
      if (!isCJK(sub)) continue;
      const entries = lookup(sub);
      if (entries.length === 0) continue;
      if (len === 1 && entries.length < 2) continue;
      seen.set(sub, { sub, entries, firstPos: i });
    }
  }
  const sorted = [...seen.values()].sort(
    (a, b) => b.sub.length - a.sub.length || a.firstPos - b.firstPos,
  );
  return sorted.slice(0, MAX_HITS);
}

/**
 * Render hits as a human-readable prompt block. Empty string if no hits.
 */
export function formatCedictBlock(hits: CedictHit[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map((h) => {
    const pinyins = h.entries.map((e) => e.pinyin).join(' | ');
    const gloss = firstGloss(h.sub);
    return `  ${h.sub}  [${pinyins}]${gloss ? '  /' + gloss + '/' : ''}`;
  });
  return `\nCC-CEDICT readings for substrings of this sentence. Emit each compound (length ≥ 2) as a SINGLE token with the listed pinyin — never split it into character tokens, never recompute the reading from characters:
${lines.join('\n')}
`;
}
