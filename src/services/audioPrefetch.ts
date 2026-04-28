/**
 * Eager prefetch of audio recordings into the local audioBlobs cache.
 *
 * Strategy:
 *   1. Enumerate all audioRecordings with a storagePath that aren't already cached.
 *   2. Order them: due-soon → recently created → rest.
 *   3. Fetch (with concurrency limit) until the user's configured cap is reached.
 *   4. On overflow (cap or QuotaExceededError), evict by lastPlayedAt LRU.
 *
 * Runs in the background after sync; soft-fails on individual fetch errors.
 */
import { localDb } from '../db/localDb';
import { supabase } from '../lib/supabase';
import * as local from '../db/localRepo';
import type { AudioRecording } from '../db/schema';
import { AUDIO_BUCKET } from '../lib/audioStorage';
import { getAudioCacheCapBytes } from '../stores/audioCacheSettingsStore';

const SIGNED_URL_TTL_SECONDS = 60;
const CONCURRENCY = 4;
const RECENT_CREATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let prefetchInFlight: Promise<void> | null = null;

/**
 * Run a prefetch pass. Concurrent calls share a single in-flight pass —
 * callers can fire-and-forget on every sync without piling up work.
 */
export function runAudioPrefetch(): Promise<void> {
  if (prefetchInFlight) return prefetchInFlight;
  prefetchInFlight = (async () => {
    try {
      await prefetchInternal();
    } catch (e) {
      console.warn('Audio prefetch failed:', e);
    } finally {
      prefetchInFlight = null;
    }
  })();
  return prefetchInFlight;
}

async function prefetchInternal(): Promise<void> {
  if (!navigator.onLine) return;

  const cap = getAudioCacheCapBytes();
  const allRecs = await local.getAllAudioRecordings();
  const cachedIds = await local.getCachedAudioRecordingIds();

  // Anything without a storagePath is either a local-only clip (already
  // cached at insert time) or somehow malformed; nothing to fetch.
  const candidates = allRecs.filter(
    (r) => !!r.storagePath && !cachedIds.has(r.id)
  );

  // Build prefetch order using sentenceId → due-soon membership and
  // createdAt recency. We order outside the DB so we don't keep an open
  // Dexie cursor across many awaits.
  const dueSentenceIds = await getDueSentenceIds();
  const now = Date.now();

  const ordered = candidates
    .map((r) => ({
      rec: r,
      tier: dueSentenceIds.has(r.sentenceId)
        ? 0
        : now - r.createdAt < RECENT_CREATE_WINDOW_MS
          ? 1
          : 2,
    }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Within a tier, newest first.
      return b.rec.createdAt - a.rec.createdAt;
    })
    .map((entry) => entry.rec);

  if (ordered.length === 0) return;

  // Worker pool: pull from the queue and fetch each in turn. We re-read
  // total bytes from the table on every iteration instead of mutating a
  // shared counter — concurrent workers' fetches and evictions would
  // make the counter drift (e.g., worker A's evict already reflects
  // worker B's just-written blob, then B does counter+=size and double-
  // counts itself), causing the cap to be over- or under-respected.
  const queue = ordered.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const usage = await local.getAudioCacheUsage();
          if (usage.totalBytes >= cap) break;
          const rec = queue.shift();
          if (!rec) break;
          try {
            const fetchedSize = await fetchAndStore(rec);
            if (fetchedSize > 0) {
              const post = await local.getAudioCacheUsage();
              if (post.totalBytes > cap) {
                // Evict back below the cap (with a small margin) before
                // letting more inflights finish.
                await evictToTarget(Math.floor(cap * 0.9));
              }
            }
          } catch (e) {
            // Best-effort. One bad URL/network blip shouldn't kill the pass.
            console.warn(`Prefetch failed for recording ${rec.id}:`, e);
          }
        }
      })()
    );
  }
  await Promise.all(workers);
}

/** Fetch a single recording's bytes and store them. Returns sizeBytes on
 *  success, 0 on skip/failure. Throws only on QuotaExceededError so the
 *  caller can react. */
async function fetchAndStore(rec: AudioRecording): Promise<number> {
  if (!rec.storagePath) return 0;

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(rec.storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return 0;

  let blob: Blob;
  try {
    const resp = await fetch(data.signedUrl);
    if (!resp.ok) return 0;
    blob = await resp.blob();
  } catch {
    return 0;
  }
  // Don't cache empty responses — a 0-byte entry forces every play to
  // re-fetch with no convergence.
  if (blob.size === 0) return 0;

  const entry = await local.makeAudioBlobEntry(rec.id, blob, rec.mimeType);

  try {
    await local.putAudioBlob(entry);
  } catch (e: unknown) {
    if (isQuotaExceeded(e)) {
      // Recover: aggressively evict and retry once.
      await evictToTarget(Math.floor(getAudioCacheCapBytes() * 0.5));
      try {
        await local.putAudioBlob(entry);
      } catch {
        return 0;
      }
    } else {
      return 0;
    }
  }
  return entry.sizeBytes;
}

/** Pick LRU entries to evict to bring the cache at or below `targetBytes`.
 *  Pure: doesn't mutate. Reused by both eviction and the Settings preview
 *  so the count the user sees matches what actually gets deleted. */
async function selectEvictionCandidates(targetBytes: number): Promise<{
  ids: string[];
  freedBytes: number;
  postTotal: number;
}> {
  const usage = await local.getAudioCacheUsage();
  if (usage.totalBytes <= targetBytes) {
    return { ids: [], freedBytes: 0, postTotal: usage.totalBytes };
  }
  const sorted = await local.getAudioBlobsSortedByLru();
  const ids: string[] = [];
  let freedBytes = 0;
  let running = usage.totalBytes;
  for (const entry of sorted) {
    if (running <= targetBytes) break;
    ids.push(entry.recordingId);
    freedBytes += entry.sizeBytes;
    running -= entry.sizeBytes;
  }
  return { ids, freedBytes, postTotal: running };
}

/** Drop oldest-played entries until total cache size is at or below `targetBytes`.
 *  Returns the post-eviction total. */
async function evictToTarget(targetBytes: number): Promise<number> {
  const { ids, postTotal } = await selectEvictionCandidates(targetBytes);
  if (ids.length > 0) await local.deleteAudioBlobs(ids);
  return postTotal;
}

/** Sentences whose cards are due now or in the next 24h, across all decks.
 *  Cheap query — pulled directly from Dexie, no scheduler logic involved. */
async function getDueSentenceIds(): Promise<Set<string>> {
  const horizon = Date.now() + 24 * 60 * 60 * 1000;
  const dueCards = await localDb.srsCards
    .where('due')
    .belowOrEqual(horizon)
    .toArray();
  return new Set(dueCards.map((c) => c.sentenceId));
}

function isQuotaExceeded(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: number };
  return (
    err.name === 'QuotaExceededError' ||
    err.code === 22 ||
    err.code === 1014
  );
}

/** Drop the entire cache. Used by Settings → Clear cache. */
export async function clearAudioCache(): Promise<void> {
  await local.clearAudioBlobs();
}

/** Shrink cache to a target byte size by LRU-evicting the oldest-played
 *  entries. No-op if already under the target. Returns the bytes freed. */
export async function shrinkAudioCacheTo(targetBytes: number): Promise<number> {
  const before = (await local.getAudioCacheUsage()).totalBytes;
  const after = await evictToTarget(targetBytes);
  return Math.max(0, before - after);
}

/** Preview what shrinking would evict, without actually doing it. Used by
 *  the Settings UI to show "X recordings (Y MB) will be deleted" in the
 *  confirmation prompt. */
export async function previewShrink(targetBytes: number): Promise<{ evictCount: number; freedBytes: number }> {
  const { ids, freedBytes } = await selectEvictionCandidates(targetBytes);
  return { evictCount: ids.length, freedBytes };
}
