/**
 * Pure helper functions for the sync engine.
 * Extracted so they can be tested without Dexie/Supabase dependencies.
 */
import type { SyncOp } from './localDb';

export interface TableStats {
  maxUsn: number;
  count: number;
}

/**
 * Compute the safe USN cursor after a pull page.
 * If any table was truncated (returned >= pageSize rows), we advance
 * only to the minimum of those tables' max USNs. This prevents
 * permanently skipping rows from tables that had more data.
 *
 * Returns { safeUsn, anyTruncated }.
 */
export function computeSafeUsn(
  stats: TableStats[],
  lastUsn: number,
  pageSize: number,
): { safeUsn: number; anyTruncated: boolean } {
  const truncated = stats.filter((s) => s.count >= pageSize);
  let safeUsn: number;
  if (truncated.length > 0) {
    safeUsn = Math.min(...truncated.map((s) => s.maxUsn));
  } else {
    safeUsn = Math.max(lastUsn, ...stats.map((s) => s.maxUsn));
  }
  return { safeUsn, anyTruncated: truncated.length > 0 };
}

/**
 * Group outbox ops into consecutive runs of the same type.
 * Preserves causal ordering (e.g. ingest before its delete).
 */
export function groupConsecutiveRuns(ops: SyncOp[]): SyncOp[][] {
  const runs: SyncOp[][] = [];
  for (const op of ops) {
    const last = runs[runs.length - 1];
    if (last && last[0].op === op.op) {
      last.push(op);
    } else {
      runs.push([op]);
    }
  }
  return runs;
}
