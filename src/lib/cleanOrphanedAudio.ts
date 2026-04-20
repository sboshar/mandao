import { supabase } from './supabase';

const BUCKET = 'audio-recordings';

export interface OrphanReport {
  totalInBucket: number;
  totalInDb: number;
  orphans: string[];
  removed: string[];
  failed: { path: string; reason: string }[];
}

/**
 * One-off sweep to delete Storage blobs that no longer have a matching
 * audio_recordings row — left behind by migration 009 (which stopped
 * the server-side DELETE trigger from throwing but also stopped it
 * from succeeding, so every blob deleted via cascade since the
 * platform change was orphaned). Run once per user via DevTools:
 *
 *   await window.__cleanOrphanedAudio()
 *
 * Lists every object under the current user's folder in the
 * audio-recordings bucket, joins against audio_recordings.storage_path
 * in the DB, deletes blobs whose path isn't referenced by any row.
 */
export async function cleanOrphanedAudio(): Promise<OrphanReport> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    throw new Error('Not signed in — cannot clean orphaned audio.');
  }

  const { data: objects, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(userId, { limit: 1000 });
  if (listErr) throw new Error(`Failed to list bucket: ${listErr.message}`);
  const bucketPaths = new Set(
    (objects ?? []).map((o) => `${userId}/${o.name}`),
  );

  const { data: rows, error: rowErr } = await supabase
    .from('audio_recordings')
    .select('storage_path')
    .eq('user_id', userId);
  if (rowErr) throw new Error(`Failed to query rows: ${rowErr.message}`);
  const dbPaths = new Set(
    (rows ?? [])
      .map((r) => (r as { storage_path: string | null }).storage_path)
      .filter((p): p is string => !!p),
  );

  const orphans = [...bucketPaths].filter((p) => !dbPaths.has(p));

  const removed: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  if (orphans.length > 0) {
    const { data: rmData, error: rmErr } = await supabase.storage
      .from(BUCKET)
      .remove(orphans);
    if (rmErr) {
      for (const p of orphans) failed.push({ path: p, reason: rmErr.message });
    } else {
      for (const obj of rmData ?? []) {
        if (obj.name) removed.push(obj.name);
      }
      for (const p of orphans) {
        if (!removed.includes(p)) {
          failed.push({ path: p, reason: 'not confirmed deleted' });
        }
      }
    }
  }

  return {
    totalInBucket: bucketPaths.size,
    totalInDb: dbPaths.size,
    orphans,
    removed,
    failed,
  };
}

export async function runCleanOrphanedAudioInConsole(): Promise<OrphanReport> {
  const report = await cleanOrphanedAudio();
  console.log(
    `Orphan sweep: ${report.totalInBucket} objects in bucket, ${report.totalInDb} rows in DB, ` +
      `${report.orphans.length} orphaned, ${report.removed.length} removed, ` +
      `${report.failed.length} failed`,
  );
  if (report.orphans.length > 0) {
    console.group('Orphans');
    console.table(report.orphans);
    console.groupEnd();
  }
  if (report.failed.length > 0) {
    console.group('Failed deletions');
    console.table(report.failed);
    console.groupEnd();
  }
  return report;
}
