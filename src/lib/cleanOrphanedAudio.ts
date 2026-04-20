import { supabase } from './supabase';
import { AUDIO_BUCKET } from './audioStorage';
import * as remote from '../db/remoteRepo';

const LIST_PAGE_SIZE = 1000;

export interface OrphanReport {
  totalInBucket: number;
  totalInDb: number;
  orphans: string[];
  removed: string[];
  failed: { path: string; reason: string }[];
}

async function listAllUserObjects(userId: string): Promise<string[]> {
  const all: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .list(userId, { limit: LIST_PAGE_SIZE, offset });
    if (error) throw new Error(`Failed to list bucket: ${error.message}`);
    const page = data ?? [];
    for (const obj of page) all.push(`${userId}/${obj.name}`);
    if (page.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return all;
}

/**
 * One-off sweep to delete Storage blobs that no longer have a matching
 * audio_recordings row — left behind by migration 009 (which stopped
 * the server-side DELETE trigger from throwing but also stopped it
 * from succeeding). Run once per user via DevTools:
 *
 *   await window.__cleanOrphanedAudio()
 *
 * Don't run while actively recording audio — an in-flight upload that
 * has reached the bucket but not the DB row yet will be misclassified
 * as an orphan.
 */
export async function cleanOrphanedAudio(): Promise<OrphanReport> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    throw new Error('Not signed in — cannot clean orphaned audio.');
  }

  const [bucketPaths, dbPathList] = await Promise.all([
    listAllUserObjects(userId),
    remote.getAllAudioStoragePaths(),
  ]);
  const dbPaths = new Set(dbPathList);

  const orphans = bucketPaths.filter((p) => !dbPaths.has(p));

  const removed: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  // Supabase Storage caps remove() at 1000 keys per request.
  const BATCH = 1000;
  for (let i = 0; i < orphans.length; i += BATCH) {
    const chunk = orphans.slice(i, i + BATCH);
    const { data: rmData, error: rmErr } = await supabase.storage
      .from(AUDIO_BUCKET)
      .remove(chunk);
    if (rmErr) {
      for (const p of chunk) failed.push({ path: p, reason: rmErr.message });
      continue;
    }
    const confirmed = new Set((rmData ?? []).map((obj) => obj.name).filter((n): n is string => !!n));
    for (const p of chunk) {
      if (confirmed.has(p)) removed.push(p);
      else failed.push({ path: p, reason: 'not confirmed deleted' });
    }
  }

  return {
    totalInBucket: bucketPaths.length,
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
