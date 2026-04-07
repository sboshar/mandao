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
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  Deck,
  ReviewLog,
} from './schema';
import { useSyncStore } from '../stores/syncStore';

// Row mappers (snake_case → camelCase) for pull results
function meaningFromRow(r: any): Meaning {
  return {
    id: r.id, headword: r.headword, pinyin: r.pinyin,
    pinyinNumeric: r.pinyin_numeric, partOfSpeech: r.part_of_speech,
    englishShort: r.english_short, englishFull: r.english_full,
    type: r.type, level: r.level,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function meaningLinkFromRow(r: any): MeaningLink {
  return {
    id: r.id, parentMeaningId: r.parent_meaning_id,
    childMeaningId: r.child_meaning_id, position: r.position, role: r.role,
  };
}

function sentenceFromRow(r: any): Sentence {
  return {
    id: r.id, chinese: r.chinese, english: r.english,
    pinyin: r.pinyin, pinyinSandhi: r.pinyin_sandhi,
    audioUrl: r.audio_url, source: r.source,
    tags: r.tags || [], createdAt: r.created_at,
  };
}

function tokenFromRow(r: any): SentenceToken {
  return {
    id: r.id, sentenceId: r.sentence_id, meaningId: r.meaning_id,
    position: r.position, surfaceForm: r.surface_form,
    pinyinSandhi: r.pinyin_sandhi,
  };
}

function srsCardFromRow(r: any): SrsCard {
  return {
    id: r.id, sentenceId: r.sentence_id, deckId: r.deck_id,
    reviewMode: r.review_mode, due: r.due,
    stability: r.stability, difficulty: r.difficulty,
    elapsedDays: r.elapsed_days, scheduledDays: r.scheduled_days,
    reps: r.reps, lapses: r.lapses, state: r.state,
    lastReview: r.last_review, createdAt: r.created_at,
  };
}

function deckFromRow(r: any): Deck {
  return {
    id: r.id, name: r.name, description: r.description,
    newCardsPerDay: r.new_cards_per_day, reviewsPerDay: r.reviews_per_day,
    createdAt: r.created_at,
  };
}

function reviewLogFromRow(r: any): ReviewLog {
  return {
    id: r.id, cardId: r.card_id, rating: r.rating,
    state: r.state, due: r.due,
    stability: r.stability, difficulty: r.difficulty,
    elapsedDays: r.elapsed_days, scheduledDays: r.scheduled_days,
    reviewedAt: r.reviewed_at,
  };
}

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

  const groups = new Map<string, SyncOp[]>();
  for (const op of pending) {
    const arr = groups.get(op.op) || [];
    arr.push(op);
    groups.set(op.op, arr);
  }

  const succeeded: number[] = [];
  const failed: number[] = [];

  try {
    for (const [opType, ops] of groups) {
      try {
        switch (opType) {
          case 'reviewCard':
            await pushReviewOps(ops);
            break;
          case 'ingestBundle':
            for (const op of ops) await pushIngestBundle(op);
            break;
        case 'deleteEntity':
          await pushDeleteOps(ops);
          break;
        case 'deleteAllData':
          await pushDeleteAllData();
          break;
        case 'updateTags':
          for (const op of ops) await pushUpdateTags(op);
          break;
        }
        succeeded.push(...ops.map((o) => o.id!));
      } catch (e) {
        console.error(`Sync push failed for ${opType}:`, e);
        failed.push(...ops.map((o) => o.id!));
      }
    }
  } finally {
    // Always reset state — even if bookkeeping itself throws,
    // the remaining inflight rows are caught by recoverInflightOps on next startup.
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
    // Safety net: any ids not in succeeded or failed are still inflight
    // (shouldn't happen, but guard against it)
    const unaccounted = ids.filter((id) => !succeeded.includes(id) && !failed.includes(id));
    if (unaccounted.length > 0) {
      await localDb.outbox
        .where('id')
        .anyOf(unaccounted)
        .modify({ status: 'pending' });
    }
  }
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
  // Server-side bulk delete via FK cascades + RLS
  const { error: e1 } = await supabase.from('sentences').delete().neq('id', '');
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase.from('meanings').delete().neq('id', '');
  if (e2) throw new Error(e2.message);
  const { error: e3 } = await supabase.from('decks').delete().neq('id', '');
  if (e3) throw new Error(e3.message);
}

async function pushUpdateTags(op: SyncOp): Promise<void> {
  const { id, tags } = op.payload;
  // Uses RLS-protected direct update. The bump_sync_meta trigger
  // auto-sets usn + updated_at on the server side.
  const { error } = await supabase
    .from('sentences')
    .update({ tags })
    .eq('id', id);
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
    graves: any[];
  };

  let maxUsn = lastUsn;
  let totalRows = 0;

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
      localDb.syncMeta,
    ],
    async () => {
      for (const r of changes.meanings) {
        await localDb.meanings.put(meaningFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.meanings.length;

      for (const r of changes.meaning_links) {
        await localDb.meaningLinks.put(meaningLinkFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.meaning_links.length;

      for (const r of changes.sentences) {
        await localDb.sentences.put(sentenceFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.sentences.length;

      for (const r of changes.sentence_tokens) {
        await localDb.sentenceTokens.put(tokenFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.sentence_tokens.length;

      for (const r of changes.decks) {
        await localDb.decks.put(deckFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.decks.length;

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
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.srs_cards.length;

      for (const r of changes.review_logs) {
        const existing = await localDb.reviewLogs.get(r.id);
        if (!existing) {
          await localDb.reviewLogs.put(reviewLogFromRow(r));
        }
        if (r.usn > maxUsn) maxUsn = r.usn;
      }
      totalRows += changes.review_logs.length;

      for (const g of changes.graves) {
        const { entity_type, entity_id, usn } = g;
        switch (entity_type) {
          case 'sentence':
            await localDb.sentenceTokens.where('sentenceId').equals(entity_id).delete();
            await localDb.sentences.delete(entity_id);
            break;
          case 'meaning':
            await localDb.meanings.delete(entity_id);
            break;
          case 'deck':
            await localDb.decks.delete(entity_id);
            break;
          case 'srs_card':
            await localDb.srsCards.delete(entity_id);
            break;
          case 'review_log':
            await localDb.reviewLogs.delete(entity_id);
            break;
          case 'meaning_link':
            await localDb.meaningLinks.delete(entity_id);
            break;
          case 'sentence_token':
            await localDb.sentenceTokens.delete(entity_id);
            break;
        }
        if (usn > maxUsn) maxUsn = usn;
      }
      totalRows += changes.graves.length;

      if (maxUsn > lastUsn) {
        await localDb.syncMeta.put({ key: 'lastUsn', value: maxUsn });
      }
    }
  );

  return maxUsn > lastUsn && totalRows >= PULL_PAGE_SIZE;
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
    store.setPendingCount(remaining);
    store.setLastSyncedAt(Date.now());
    store.setStatus('synced');
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

export function startSyncListeners(): void {
  window.addEventListener('online', () => {
    useSyncStore.getState().setOnline(true);
    runSync();
  });
  window.addEventListener('offline', () => {
    useSyncStore.getState().setOnline(false);
  });

  // Periodic sync every 60s when online
  periodicInterval = setInterval(() => {
    if (navigator.onLine) runSync();
  }, 60_000);
}

export function stopSyncListeners(): void {
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}
