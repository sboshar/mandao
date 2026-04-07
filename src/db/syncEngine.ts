/**
 * Sync engine: push local outbox to Supabase RPCs, pull remote changes.
 *
 * Push: drains the outbox by grouping ops by type and calling the
 * corresponding server-side RPC in batch.
 *
 * Pull: calls pull_changes(lastUsn) and upserts results into Dexie,
 * applying merge rules for conflicts.
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

async function pushOutbox(): Promise<void> {
  const pending = await localDb.outbox
    .where('status')
    .equals('pending')
    .sortBy('createdAt');

  if (pending.length === 0) return;

  // Mark as inflight
  const ids = pending.map((o) => o.id!);
  await localDb.outbox.where('id').anyOf(ids).modify({ status: 'inflight' });

  // Group by op type
  const groups = new Map<string, SyncOp[]>();
  for (const op of pending) {
    const arr = groups.get(op.op) || [];
    arr.push(op);
    groups.set(op.op, arr);
  }

  const succeeded: number[] = [];
  const failed: number[] = [];

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

async function pushUpdateTags(op: SyncOp): Promise<void> {
  const { id, tags } = op.payload;
  const { error } = await supabase
    .from('sentences')
    .update({ tags })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// Pull: fetch changes from server since lastUsn
// ============================================================

async function pullChanges(): Promise<void> {
  const meta = await localDb.syncMeta.get('lastUsn');
  const lastUsn = (meta?.value as number) ?? 0;

  const { data, error } = await supabase.rpc('pull_changes', {
    last_usn: lastUsn,
    max_rows: 1000,
  });
  if (error) throw new Error(error.message);
  if (!data) return;

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
      // Upsert meanings
      for (const r of changes.meanings) {
        await localDb.meanings.put(meaningFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Upsert meaning links
      for (const r of changes.meaning_links) {
        await localDb.meaningLinks.put(meaningLinkFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Upsert sentences
      for (const r of changes.sentences) {
        await localDb.sentences.put(sentenceFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Upsert sentence tokens
      for (const r of changes.sentence_tokens) {
        await localDb.sentenceTokens.put(tokenFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Upsert decks
      for (const r of changes.decks) {
        await localDb.decks.put(deckFromRow(r));
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Upsert SRS cards (last-answered-wins conflict resolution)
      for (const r of changes.srs_cards) {
        const remote = srsCardFromRow(r);
        const local = await localDb.srsCards.get(remote.id);

        if (!local) {
          await localDb.srsCards.put(remote);
        } else {
          // Last-answered-wins: take whichever has the more recent lastReview
          const remoteLastReview = remote.lastReview ?? 0;
          const localLastReview = local.lastReview ?? 0;
          if (remoteLastReview >= localLastReview) {
            await localDb.srsCards.put(remote);
          }
        }
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Upsert review logs (append-only, skip duplicates)
      for (const r of changes.review_logs) {
        const existing = await localDb.reviewLogs.get(r.id);
        if (!existing) {
          await localDb.reviewLogs.put(reviewLogFromRow(r));
        }
        if (r.usn > maxUsn) maxUsn = r.usn;
      }

      // Apply graves (tombstones)
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

      if (maxUsn > lastUsn) {
        await localDb.syncMeta.put({ key: 'lastUsn', value: maxUsn });
      }
    }
  );
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
