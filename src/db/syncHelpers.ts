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
 * Pick a file extension for an audio Storage object based on the Blob's
 * MIME type. Used to build the deterministic Storage path
 * `{user_id}/{id}.{ext}`. Accepts codec-qualified types (e.g. webm;codecs=opus).
 */
export function extensionFromMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base.includes('webm')) return 'webm';
  if (base.includes('mpeg')) return 'mp3';
  if (base.includes('mp4')) return 'm4a';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('wav')) return 'wav';
  if (base.includes('aac')) return 'aac';
  return 'bin';
}

/**
 * Re-arm one op that had given up, so the next push picks it up again.
 *
 * The stale error text goes with it. Pressing Retry is a claim that something
 * changed on the server, and leaving "Could not find the 'usage' column" on a
 * row that is about to be retried would describe a state that no longer holds —
 * then reappear unchanged if the retry failed for an entirely different reason.
 */
export function rearmFailedOp(op: SyncOp): void {
  op.status = 'pending';
  op.attempts = 0;
  delete op.lastError;
  delete op.lastErrorCode;
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
