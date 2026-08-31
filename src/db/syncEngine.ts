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
import { AUDIO_BUCKET } from '../lib/audioStorage';
import { localDb, type SyncOp } from './localDb';
import type { Deck, Meaning, SentenceUsage } from './schema';
import { hydrateFSRSSettingsFromBlob } from '../stores/fsrsSettingsStore';
import type { FailedOp } from '../stores/syncStore';
import { runAudioPrefetch } from '../services/audioPrefetch';
import { audioBlobToBlob } from './localRepo';

/** Sync error that preserves the Postgres code so the outbox can tell
 *  permanent (CHECK violation, missing column) apart from transient
 *  (network, rate limit). */
export class SyncError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export function syncErrorFrom(
  e: { message?: string; code?: string } | null | undefined,
  fallback = 'Unknown sync error',
): SyncError {
  return new SyncError(e?.message ?? fallback, e?.code);
}

/** Postgres error families that are permanent — retrying can't fix them
 *  without a code / schema change:
 *    23xxx — integrity_constraint_violation (CHECK, NOT NULL, FK, unique)
 *    42xxx — syntax_error_or_access_rule_violation (missing column,
 *            function signature mismatch, insufficient_privilege)
 *    58xxx — system_error (server-side internal errors)
 */
export function isPermanentSyncError(e: unknown): boolean {
  if (!(e instanceof SyncError) || !e.code) return false;
  return /^(23|42|58)/.test(e.code);
}
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
import {
  computeSafeUsn,
  extensionFromMime,
  groupConsecutiveRuns,
  rearmFailedOp,
  type TableStats,
} from './syncHelpers';
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

/**
 * Re-arm ops that gave up, then sync — what the error banner's Retry means.
 *
 * pushOutbox only reads 'pending', and nothing else in the engine ever moves an
 * op off 'failed', so before this existed the Retry button ran a sync that
 * skipped precisely the ops it was offering to retry. The banner stayed up
 * forever and the writes never landed, even once the cause was gone.
 *
 * And the cause usually IS gone by the time someone presses it: the permanent
 * families are permanent for an unattended retry loop, not for a person who has
 * just added the missing column or fixed the constraint. A schema cache that had
 * not caught up (PGRST204) is the same story with a code the families do not
 * even match. Pressing Retry is a claim that something changed on the server, so
 * attempts resets to zero and the stale error text is cleared rather than left
 * to describe a state that no longer holds.
 *
 * Only ever called from an explicit user action — automatic retry keeps its
 * MAX_ATTEMPTS ceiling, which is what stops a genuinely broken op from being
 * pushed forever.
 */
export async function retryFailedOps(): Promise<void> {
  await localDb.outbox.where('status').equals('failed').modify(rearmFailedOp);
  await runSync();
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
  const failed: { id: number; error: unknown }[] = [];

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
          for (const op of ops) failed.push({ id: op.id!, error: e });
        }
        // Stop processing further runs to preserve causal ordering.
        // Remaining un-attempted ops stay inflight → reset in finally.
        break;
      }
    }
  } finally {
    // Atomic: succeeded deletes + failed updates + unaccounted resets
    // all commit together, so a tab crash mid-finally leaves a
    // consistent outbox.
    await localDb.transaction('rw', localDb.outbox, async () => {
      if (succeeded.length > 0) {
        await localDb.outbox.bulkDelete(succeeded);
      }
      for (const { id, error } of failed) {
        const permanent = isPermanentSyncError(error);
        const message = (error as Error)?.message ?? String(error);
        const code = error instanceof SyncError ? error.code : undefined;
        await localDb.outbox
          .where('id')
          .equals(id)
          .modify((op: SyncOp) => {
            op.lastError = message;
            op.lastErrorCode = code;
            if (permanent) {
              // Retrying can't fix a CHECK violation / missing column.
              op.status = 'failed';
              op.attempts = MAX_ATTEMPTS;
            } else {
              op.attempts += 1;
              op.status = op.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
            }
          });
      }
      const handled = new Set([
        ...succeeded,
        ...failed.map((f) => f.id),
      ]);
      const unaccounted = ids.filter((id) => !handled.has(id));
      if (unaccounted.length > 0) {
        await localDb.outbox
          .where('id')
          .anyOf(unaccounted)
          .modify({ status: 'pending' });
      }
    });
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
    case 'updateSentenceUsage':
      await pushSequential(ops, pushUpdateSentenceUsage);
      break;
    case 'updateDeck':
      await pushSequential(ops, pushUpdateDeck);
      break;
    case 'updateMeaning':
      await pushSequential(ops, pushUpdateMeaning);
      break;
    case 'upsertAudioRecording':
      await pushSequential(ops, pushUpsertAudioRecording);
      break;
    case 'deleteStorageObjects':
      await pushSequential(ops, pushDeleteStorageObjects);
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
  failed: { id: number; error: unknown }[];
  constructor(succeeded: number[], failed: { id: number; error: unknown }[]) {
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
  const bad: { id: number; error: unknown }[] = [];
  for (const op of ops) {
    try {
      await fn(op);
      ok.push(op.id!);
    } catch (e) {
      bad.push({ id: op.id!, error: e });
    }
  }
  if (bad.length > 0) throw new PartialBatchError(ok, bad);
}

async function pushReviewOps(ops: SyncOp[]): Promise<void> {
  const payload = ops.map((o) => o.payload);
  const { error } = await supabase.rpc('apply_review_ops', { ops: payload });
  if (error) throw syncErrorFrom(error);
}


async function pushIngestBundle(op: SyncOp): Promise<void> {
  const { error } = await supabase.rpc('apply_ingest_bundle', { bundle: op.payload });
  if (error) throw syncErrorFrom(error);
}

async function pushDeleteOps(ops: SyncOp[]): Promise<void> {
  const payload = ops.map((o) => o.payload);
  const { error } = await supabase.rpc('apply_delete_ops', { ops: payload });
  if (error) throw syncErrorFrom(error);
}

async function pushDeleteAllData(): Promise<void> {
  const { error } = await supabase.rpc('delete_all_user_data');
  if (error) throw syncErrorFrom(error);
}

/**
 * upsert:true makes retries idempotent on the deterministic path. FK 23503
 * handles the race where the parent sentence was deleted remotely between
 * enqueue and push — we silently drop the op and clean up instead of
 * retrying into a permanent failure.
 *
 * If the local row already has `storagePath` set, the blob is already in
 * Storage and this push is a metadata-only change (e.g. rename). We skip
 * the Storage upload — the server-side immutable trigger would reject a
 * path change anyway, and re-uploading on every rename wastes bandwidth.
 * This also lets renames on rows pulled from another device (no local
 * blob) actually reach the server.
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
  if (!rec) return;
  const cachedBlob = await localDb.audioBlobs.get(payload.id);
  // Nothing local to upload and nothing on the server either.
  if (!cachedBlob && !rec.storagePath) return;

  const userId = getCachedUserIdOrThrow();
  const isFirstUpload = !rec.storagePath;
  let storagePath = rec.storagePath;
  if (isFirstUpload) {
    if (!cachedBlob) return; // shouldn't happen: !storagePath && !cachedBlob already returned
    const ext = extensionFromMime(payload.mimeType);
    storagePath = `${userId}/${payload.id}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(storagePath, audioBlobToBlob(cachedBlob), {
        contentType: payload.mimeType,
        upsert: true,
      });
    if (uploadErr) throw syncErrorFrom(uploadErr);
  }

  const { error: rowErr } = await supabase
    .from('audio_recordings')
    .upsert(audioRecordingToRow(payload, userId, storagePath!));
  if (rowErr) {
    if ((rowErr as { code?: string }).code === '23503') {
      console.warn(
        `Dropping audio recording ${payload.id}: parent sentence ${payload.sentenceId} not found (FK 23503)`,
      );
      // Only clean up the Storage object we ourselves just uploaded. If
      // this was a metadata-only push, the cascade from the deleted
      // sentence already removed the object via the delete trigger.
      // Best-effort: a leaked orphan can be reaped by backfill later.
      if (isFirstUpload) {
        try {
          await supabase.storage.from(AUDIO_BUCKET).remove([storagePath!]);
        } catch (cleanupErr) {
          console.warn('Orphan upload cleanup failed', cleanupErr);
        }
      }
      await localDb.audioRecordings.delete(payload.id);
      return;
    }
    throw syncErrorFrom(rowErr);
  }

  if (isFirstUpload) {
    await localDb.audioRecordings.update(payload.id, { storagePath });
  }
}

/**
 * Drop the listed Storage objects. Throws on transport errors so the
 * outbox retries (the whole reason this isn't a fire-and-forget call
 * from repo.ts). Missing objects are not errors — Supabase Storage's
 * remove() silently skips paths it can't find — so a partial cleanup
 * still drains the op cleanly.
 */
async function pushDeleteStorageObjects(op: SyncOp): Promise<void> {
  const paths = (op.payload as { paths?: string[] })?.paths;
  if (!paths || paths.length === 0) return;
  // Supabase caps remove() at 1000 keys per request.
  const BATCH = 1000;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const { error } = await supabase.storage.from(AUDIO_BUCKET).remove(chunk);
    if (error) throw syncErrorFrom(error);
  }
}

async function pushUpdateDeck(op: SyncOp): Promise<void> {
  const { id, updates } = op.payload as { id: string; updates: Partial<Deck> };
  // Whitelist the fields that are safe to push. Anything else
  // (like timestamps managed by triggers) is filtered out.
  const FIELD_MAP: Partial<Record<keyof Deck, string>> = {
    name: 'name',
    description: 'description',
    newCardsPerDay: 'new_cards_per_day',
    reviewsPerDay: 'reviews_per_day',
    fsrsSettings: 'fsrs_settings',
  };
  const row: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (camel in updates) row[snake] = updates[camel as keyof Deck];
  }
  if (Object.keys(row).length === 0) return;

  const userId = getCachedUserIdOrThrow();
  const { error } = await supabase
    .from('decks')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw syncErrorFrom(error);
}

async function pushUpdateMeaning(op: SyncOp): Promise<void> {
  const { id, updates } = op.payload as { id: string; updates: Partial<Meaning> };
  // Mutable fields only. id/type/createdAt are immutable by convention;
  // updatedAt/usn are managed by the bump_sync_meta trigger.
  const FIELD_MAP: Partial<Record<keyof Meaning, string>> = {
    headword: 'headword',
    pinyinNumeric: 'pinyin_numeric',
    partOfSpeech: 'part_of_speech',
    englishShort: 'english_short',
    englishFull: 'english_full',
    level: 'level',
    isTransliteration: 'is_transliteration',
  };
  const row: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (camel in updates) row[snake] = updates[camel as keyof Meaning];
  }
  if (Object.keys(row).length === 0) return;

  const userId = getCachedUserIdOrThrow();
  const { error } = await supabase
    .from('meanings')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw syncErrorFrom(error);
}

async function pushUpdateTags(op: SyncOp): Promise<void> {
  const { id, tags } = op.payload;
  // Uses RLS-protected direct update. The bump_sync_meta trigger
  // auto-sets usn + updated_at on the server side.
  // Explicit user_id filter for defense-in-depth alongside RLS.
  const userId = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!userId) throw new SyncError('Not authenticated');
  const { error } = await supabase
    .from('sentences')
    .update({ tags })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw syncErrorFrom(error);
}

/**
 * Push usage notes (#212). Whole-object replace into the `usage` jsonb column,
 * or SQL NULL when the user deleted them; the trg_sentences_sync trigger bumps
 * usn + updated_at, and pull_changes returns the row via row_to_json, so no RPC
 * change is needed.
 */
async function pushUpdateSentenceUsage(op: SyncOp): Promise<void> {
  const { id, usage } = op.payload as { id: string; usage: SentenceUsage | null };
  const userId = getCachedUserIdOrThrow();
  const { error } = await supabase
    .from('sentences')
    .update({ usage })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw syncErrorFrom(error);
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
  if (error) throw syncErrorFrom(error);
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
      localDb.audioBlobs,
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
        const localDecks = changes.decks.map(deckFromRow);
        await localDb.decks.bulkPut(localDecks);
        // Mirror the (possibly updated) FSRS settings into the in-memory
        // store so the FSRS scheduler picks up the new params immediately.
        // TODO(multi-deck): the FSRS store is global today; once decks can
        // have per-deck settings, scope this to the active/default deck.
        for (const d of localDecks) hydrateFSRSSettingsFromBlob(d.fsrsSettings);
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

      // Audio recordings: server wins for metadata. Cached bytes live in
      // the audioBlobs table (keyed by id), so we can write rows directly.
      if (audioRows.length > 0) {
        await localDb.audioRecordings.bulkPut(audioRows.map(audioRecordingFromRow));
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
            const recs = await localDb.audioRecordings.where('sentenceId').equals(entity_id).toArray();
            const recIds = recs.map((r) => r.id);
            if (recIds.length > 0) {
              await localDb.audioBlobs.bulkDelete(recIds);
            }
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
            // The server already wiped the Storage object via the delete
            // trigger; drop our metadata row and any cached bytes too.
            await localDb.audioBlobs.delete(entity_id);
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
    const stuckRows = await localDb.outbox.where('status').equals('failed').toArray();
    const stuck = stuckRows.length;
    store.setPendingCount(remaining + stuck);

    // Cap samples — banner only needs enough for the details toggle.
    const samples: FailedOp[] = stuckRows.slice(-5).map((op) => ({
      op: op.op,
      lastError: op.lastError,
      lastErrorCode: op.lastErrorCode,
    }));
    store.setFailed(stuck, samples);

    store.setLastSyncedAt(Date.now());
    if (stuck === 0) {
      store.setStatus('synced');
    }
    // When stuck > 0, setFailed already set status='error' + errorMessage,
    // so a separate setError(...) call would duplicate the signal.

    // Fire-and-forget prefetch of newly-available audio.
    void runAudioPrefetch();
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
