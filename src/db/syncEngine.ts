/**
 * Sync engine: push local outbox to Supabase RPCs, pull remote changes by USN.
 *
 * Push: groups pending outbox ops by type and calls the corresponding
 * server-side RPC. Inflight recovery on startup handles crash/tab-kill.
 *
 * Pull: loops pull_changes(lastUsn) until caught up, applying merge rules:
 *   - review_logs: append-only (skip duplicates)
 *   - srs_cards: last-answered-wins by lastReview timestamp
 *   - everything else: server wins (simple upsert)
 *   - graves: delete from local Dexie
 */
import { supabase } from '../lib/supabase';
import { localDb, type SyncOp } from './localDb';
import {
  meaningFromRow,
  meaningLinkFromRow,
  sentenceFromRow,
  tokenFromRow,
  srsCardFromRow,
  deckFromRow,
  reviewLogFromRow,
  audioRecordingFromRow,
  audioRecordingToRow,
} from './mappers';
import { getCachedUserIdOrThrow } from './remoteRepo';
import { computeSafeUsn, groupConsecutiveRuns, type TableStats } from './syncHelpers';
import { useSyncStore } from '../stores/syncStore';

// ============================================================
// Device ID (stable per browser)
// ============================================================

let _deviceId: string | null = null;

export function getDeviceId(): string {
  if (_deviceId) return _deviceId;
  const stored = localStorage.getItem('mandao_device_id');
  if (stored) { _deviceId = stored; return stored; }
  const id = crypto.randomUUID();
  localStorage.setItem('mandao_device_id', id);
  _deviceId = id;
  return id;
}

// ============================================================
// Push: drain outbox → server RPCs
// ============================================================

const MAX_ATTEMPTS = 5;

/**
 * Recover any rows stuck as 'inflight' from a previous crash or tab kill.
 * Must be called once at startup before the first pushOutbox.
 */
async function recoverInflightOps(): Promise<void> {
  await localDb.outbox
    .where('status')
    .equals('inflight')
    .modify({ status: 'pending' });
}

async function pushOutbox(): Promise<void> {
  const pending = await localDb.outbox
    .where('status')
    .equals('pending')
    .sortBy('createdAt');

  if (pending.length === 0) return;

  const ids = pending.map((o) => o.id!);
  await localDb.outbox.where('id').anyOf(ids).modify({ status: 'inflight' });

  const runs = groupConsecutiveRuns(pending);

  const succeeded: number[] = [];
  const failed: number[] = [];

  try {
    for (let i = 0; i < runs.length; i++) {
      const ops = runs[i];
      try {
        await pushOpBatch(ops);
        succeeded.push(...ops.map((o) => o.id!));
      } catch (e) {
        if (e instanceof PartialBatchError) {
          succeeded.push(...e.succeeded);
          failed.push(...e.failed);
        } else {
          console.error(`Sync push failed for ${ops[0].op}:`, e);
          failed.push(...ops.map((o) => o.id!));
        }
        // Stop processing further runs to preserve causal ordering.
        // Remaining un-attempted ops stay inflight → reset in finally.
        break;
      }
    }
  } finally {
    if (succeeded.length > 0) {
      await localDb.outbox.bulkDelete(succeeded);
    }
    if (failed.length > 0) {
      await localDb.outbox
        .where('id')
        .anyOf(failed)
        .modify((op: SyncOp) => {
          op.status = op.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending';
          op.attempts += 1;
        });
    }
    const handled = new Set([...succeeded, ...failed]);
    const unaccounted = ids.filter((id) => !handled.has(id));
    if (unaccounted.length > 0) {
      await localDb.outbox
        .where('id')
        .anyOf(unaccounted)
        .modify({ status: 'pending' });
    }
  }
}

/**
 * Push a batch of ops (all same type). For batch RPCs (reviewCard,
 * deleteEntity), the entire batch succeeds or fails together. For
 * sequential ops (ingestBundle, updateTags), each is attempted
 * individually — partial results are returned via the thrown error.
 */
async function pushOpBatch(ops: SyncOp[]): Promise<void> {
  switch (ops[0].op) {
    case 'reviewCard':
      await pushReviewOps(ops);
      break;
    case 'ingestBundle':
      await pushSequential(ops, pushIngestBundle);
      break;
    case 'deleteEntity':
      await pushDeleteOps(ops);
      break;
    case 'deleteAllData':
      await pushDeleteAllData();
      break;
    case 'updateTags':
      await pushSequential(ops, pushUpdateTags);
      break;
    case 'upsertAudioRecording':
      await pushSequential(ops, pushUpsertAudioRecording);
      break;
  }
}

/**
 * Process ops one-at-a-time, recording individual success/failure.
 * Throws a PartialBatchError if any fail, so the caller can
 * mark only the actually-failed ops.
 */
class PartialBatchError extends Error {
  succeeded: number[];
  failed: number[];
  constructor(succeeded: number[], failed: number[]) {
    super('Partial batch failure');
    this.succeeded = succeeded;
    this.failed = failed;
  }
}

async function pushSequential(
  ops: SyncOp[],
  fn: (op: SyncOp) => Promise<void>,
): Promise<void> {
  const ok: number[] = [];
  const bad: number[] = [];
  for (const op of ops) {
    try {
      await fn(op);
      ok.push(op.id!);
    } catch {
      bad.push(op.id!);
    }
  }
  if (bad.length > 0) throw new PartialBatchError(ok, bad);
}

async function pushReviewOps(ops: SyncOp[]): Promise<void> {
  const payload = ops.map((o) => o.payload);
  const { error } = await supabase.rpc('apply_review_ops', { ops: payload });
  if (error) throw new Error(error.message);
}


async function pushIngestBundle(op: SyncOp): Promise<void> {
  const { error } = await supabase.rpc('apply_ingest_bundle', { bundle: op.payload });
  if (error) throw new Error(error.message);
}

async function pushDeleteOps(ops: SyncOp[]): Promise<void> {
  const payload = ops.map((o) => o.payload);
  const { error } = await supabase.rpc('apply_delete_ops', { ops: payload });
  if (error) throw new Error(error.message);
}

async function pushDeleteAllData(): Promise<void> {
  const { error } = await supabase.rpc('delete_all_user_data');
  if (error) throw new Error(error.message);
}

/**
 * Pick a file extension for the Storage object name based on the Blob's
 * MIME type. Path is `{user_id}/{id}.{ext}` — matching the server-side
 * `audio_recordings_path_owner_prefix` CHECK constraint.
 */
function extensionFromMime(mime: string): string {
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
 * upsert:true makes retries idempotent on the deterministic path. FK 23503
 * handles the race where the parent sentence was deleted remotely between
 * enqueue and push — we silently drop the op and clean up instead of
 * retrying into a permanent failure.
 */
async function pushUpsertAudioRecording(op: SyncOp): Promise<void> {
  const payload = op.payload as {
    id: string;
    sentenceId: string;
    name: string;
    mimeType: string;
    durationMs: number | null;
    source: 'voice-input' | 'manual';
    createdAt: number;
  };

  const rec = await localDb.audioRecordings.get(payload.id);
  if (!rec || !rec.blob) return;

  const userId = getCachedUserIdOrThrow();
  const ext = extensionFromMime(payload.mimeType);
  const storagePath = `${userId}/${payload.id}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('audio-recordings')
    .upload(storagePath, rec.blob, {
      contentType: payload.mimeType,
      upsert: true,
    });
  if (uploadErr) throw new Error(uploadErr.message);

  const { error: rowErr } = await supabase
    .from('audio_recordings')
    .upsert(audioRecordingToRow(payload, userId, storagePath));
  if (rowErr) {
    if ((rowErr as { code?: string }).code === '23503') {
      try {
        await supabase.storage.from('audio-recordings').remove([storagePath]);
      } catch {}
      await localDb.audioRecordings.delete(payload.id);
      return;
    }
    throw new Error(rowErr.message);
  }

  await localDb.audioRecordings.update(payload.id, { storagePath });
}

async function pushUpdateTags(op: SyncOp): Promise<void> {
  const { id, tags } = op.payload;
  // Uses RLS-protected direct update. The bump_sync_meta trigger
  // auto-sets usn + updated_at on the server side.
  // Explicit user_id filter for defense-in-depth alongside RLS.
  const userId = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('sentences')
    .update({ tags })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Pull: fetch changes from server since lastUsn
// ============================================================

const PULL_PAGE_SIZE = 1000;
const MAX_PULL_PAGES = 50;

async function pullChanges(): Promise<void> {
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const advanced = await pullOnePage();
    if (!advanced) break;
  }
}

/**
 * Pull one page of changes. Returns true if maxUsn advanced (more pages may exist).
 */
async function pullOnePage(): Promise<boolean> {
  const meta = await localDb.syncMeta.get('lastUsn');
  const lastUsn = (meta?.value as number) ?? 0;

  const { data, error } = await supabase.rpc('pull_changes', {
    last_usn: lastUsn,
    max_rows: PULL_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  if (!data) return false;

  const changes = data as {
    meanings: any[];
    meaning_links: any[];
    sentences: any[];
    sentence_tokens: any[];
    decks: any[];
    srs_cards: any[];
    review_logs: any[];
    audio_recordings?: any[];
    graves: any[];
  };
  const audioRows = changes.audio_recordings ?? [];

  const stats: TableStats[] = [];
  let syncResult: { safeUsn: number; anyTruncated: boolean } | null = null;

  function trackRows(rows: any[]): number {
    let tableMax = lastUsn;
    for (const r of rows) {
      if (r.usn > tableMax) tableMax = r.usn;
    }
    stats.push({ maxUsn: tableMax, count: rows.length });
    return tableMax;
  }

  await localDb.transaction(
    'rw',
    [
      localDb.meanings,
      localDb.meaningLinks,
      localDb.sentences,
      localDb.sentenceTokens,
      localDb.srsCards,
      localDb.decks,
      localDb.reviewLogs,
      localDb.audioRecordings,
      localDb.syncMeta,
    ],
    async () => {
      // Simple tables: server-wins upsert via bulkPut (much faster than per-row put)
      if (changes.meanings.length > 0) {
        await localDb.meanings.bulkPut(changes.meanings.map(meaningFromRow));
      }
      trackRows(changes.meanings);

      if (changes.meaning_links.length > 0) {
        await localDb.meaningLinks.bulkPut(changes.meaning_links.map(meaningLinkFromRow));
      }
      trackRows(changes.meaning_links);

      if (changes.sentences.length > 0) {
        await localDb.sentences.bulkPut(changes.sentences.map(sentenceFromRow));
      }
      trackRows(changes.sentences);

      if (changes.sentence_tokens.length > 0) {
        await localDb.sentenceTokens.bulkPut(changes.sentence_tokens.map(tokenFromRow));
      }
      trackRows(changes.sentence_tokens);

      if (changes.decks.length > 0) {
        await localDb.decks.bulkPut(changes.decks.map(deckFromRow));
      }
      trackRows(changes.decks);

      // SRS cards: last-answered-wins merge (requires per-row check)
      for (const r of changes.srs_cards) {
        const remote = srsCardFromRow(r);
        const existing = await localDb.srsCards.get(remote.id);
        if (!existing) {
          await localDb.srsCards.put(remote);
        } else {
          const remoteLastReview = remote.lastReview ?? 0;
          const localLastReview = existing.lastReview ?? 0;
          if (remoteLastReview >= localLastReview) {
            await localDb.srsCards.put(remote);
          }
        }
      }
      trackRows(changes.srs_cards);

      // Review logs: append-only (skip duplicates, requires per-row check)
      for (const r of changes.review_logs) {
        const existing = await localDb.reviewLogs.get(r.id);
        if (!existing) {
          await localDb.reviewLogs.put(reviewLogFromRow(r));
        }
      }
      trackRows(changes.review_logs);

      // Audio recordings: server wins for metadata, but preserve any local
      // blob (the wire row has none, and we don't want to drop cached bytes).
      if (audioRows.length > 0) {
        const mapped = audioRows.map(audioRecordingFromRow);
        const existing = await localDb.audioRecordings.bulkGet(mapped.map((r) => r.id));
        const merged = mapped.map((r, i) => ({ ...r, blob: existing[i]?.blob }));
        await localDb.audioRecordings.bulkPut(merged);
      }
      trackRows(audioRows);

      for (const g of changes.graves) {
        const { entity_type, entity_id } = g;
        switch (entity_type) {
          case 'sentence': {
            const cards = await localDb.srsCards.where('sentenceId').equals(entity_id).toArray();
            const cardIds = cards.map((c) => c.id);
            if (cardIds.length > 0) {
              await localDb.reviewLogs.where('cardId').anyOf(cardIds).delete();
            }
            await localDb.srsCards.where('sentenceId').equals(entity_id).delete();
            await localDb.sentenceTokens.where('sentenceId').equals(entity_id).delete();
            await localDb.audioRecordings.where('sentenceId').equals(entity_id).delete();
            await localDb.sentences.delete(entity_id);
            break;
          }
          case 'meaning':
            await localDb.meaningLinks.where('parentMeaningId').equals(entity_id).delete();
            await localDb.meaningLinks.where('childMeaningId').equals(entity_id).delete();
            await localDb.meanings.delete(entity_id);
            break;
          case 'deck': {
            const deckCards = await localDb.srsCards.where('deckId').equals(entity_id).toArray();
            const deckCardIds = deckCards.map((c) => c.id);
            if (deckCardIds.length > 0) {
              await localDb.reviewLogs.where('cardId').anyOf(deckCardIds).delete();
            }
            await localDb.srsCards.where('deckId').equals(entity_id).delete();
            await localDb.decks.delete(entity_id);
            break;
          }
          case 'srs_card': {
            await localDb.reviewLogs.where('cardId').equals(entity_id).delete();
            await localDb.srsCards.delete(entity_id);
            break;
          }
          case 'review_log':
            await localDb.reviewLogs.delete(entity_id);
            break;
          case 'meaning_link':
            await localDb.meaningLinks.delete(entity_id);
            break;
          case 'sentence_token':
            await localDb.sentenceTokens.delete(entity_id);
            break;
          case 'audio_recording':
            // Row delete drops the local blob too; the server already wiped
            // the Storage object via the delete trigger.
            await localDb.audioRecordings.delete(entity_id);
            break;
        }
      }
      trackRows(changes.graves);

      syncResult = computeSafeUsn(stats, lastUsn, PULL_PAGE_SIZE);
      if (syncResult.safeUsn > lastUsn) {
        await localDb.syncMeta.put({ key: 'lastUsn', value: syncResult.safeUsn });
      }
    }
  );

  const totalRows = stats.reduce((sum, s) => sum + s.count, 0);
  return totalRows > 0 && syncResult!.anyTruncated;
}

// ============================================================
// Full sync cycle
// ============================================================

let syncInProgress = false;

export async function runSync(): Promise<void> {
  if (syncInProgress) return;
  if (!navigator.onLine) {
    useSyncStore.getState().setOnline(false);
    return;
  }

  syncInProgress = true;
  const store = useSyncStore.getState();
  store.setStatus('syncing');

  try {
    await recoverInflightOps();
    await pushOutbox();
    await pullChanges();

    const remaining = await localDb.outbox.where('status').equals('pending').count();
    const stuck = await localDb.outbox.where('status').equals('failed').count();
    store.setPendingCount(remaining + stuck);
    store.setLastSyncedAt(Date.now());
    if (stuck > 0) {
      store.setError(`${stuck} operation(s) failed permanently`);
    } else {
      store.setStatus('synced');
    }
  } catch (e: any) {
    console.error('Sync failed:', e);
    store.setError(e.message || 'Sync failed');
  } finally {
    syncInProgress = false;
  }
}

// ============================================================
// Debounced sync trigger (called after each local write)
// ============================================================

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSyncSoon(delayMs = 2000): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    runSync();
  }, delayMs);
}

// ============================================================
// Online/offline listeners + periodic sync
// ============================================================

let periodicInterval: ReturnType<typeof setInterval> | null = null;
let onlineHandler: (() => void) | null = null;
let offlineHandler: (() => void) | null = null;

export function startSyncListeners(): void {
  stopSyncListeners();

  onlineHandler = () => {
    useSyncStore.getState().setOnline(true);
    runSync();
  };
  offlineHandler = () => {
    useSyncStore.getState().setOnline(false);
  };

  window.addEventListener('online', onlineHandler);
  window.addEventListener('offline', offlineHandler);

  periodicInterval = setInterval(() => {
    if (navigator.onLine) runSync();
  }, 60_000);
}

export function stopSyncListeners(): void {
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  if (offlineHandler) {
    window.removeEventListener('offline', offlineHandler);
    offlineHandler = null;
  }
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}
