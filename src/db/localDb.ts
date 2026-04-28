import Dexie, { type Table } from 'dexie';
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  Deck,
  ReviewLog,
  AudioRecording,
  AudioBlob,
  MeaningFlag,
} from './schema';

export interface SyncMeta {
  key: string;
  value: string | number;
}

export type SyncOpType =
  | 'reviewCard'
  | 'ingestBundle'
  | 'deleteEntity'
  | 'deleteAllData'
  | 'updateTags'
  | 'upsertAudioRecording';

export interface SyncOp {
  id?: number;
  op: SyncOpType;
  payload: any;
  status: 'pending' | 'inflight' | 'failed';
  attempts: number;
  createdAt: number;
  deviceId: string;
  opId: string;
  /** Server-reported error message from the most recent attempt.
   *  Populated when status transitions to 'failed' — either after
   *  MAX_ATTEMPTS or immediately on a permanent Postgres error. */
  lastError?: string;
  /** Postgres error code from the last attempt (if any). Permanent
   *  families 23xxx/42xxx/58xxx mark the op 'failed' on the first hit
   *  instead of burning retries. */
  lastErrorCode?: string;
}

class MandaoDb extends Dexie {
  meanings!: Table<Meaning, string>;
  meaningLinks!: Table<MeaningLink, string>;
  sentences!: Table<Sentence, string>;
  sentenceTokens!: Table<SentenceToken, string>;
  srsCards!: Table<SrsCard, string>;
  decks!: Table<Deck, string>;
  reviewLogs!: Table<ReviewLog, string>;
  outbox!: Table<SyncOp, number>;
  syncMeta!: Table<SyncMeta, string>;
  audioRecordings!: Table<AudioRecording, string>;
  audioBlobs!: Table<AudioBlob, string>;
  meaningFlags!: Table<MeaningFlag, string>;

  constructor() {
    super('MandaoApp');

    this.version(1).stores({
      meanings: 'id, headword, pinyinNumeric, type',
      meaningLinks: 'id, parentMeaningId, childMeaningId',
      sentences: 'id, chinese, source, *tags, createdAt',
      sentenceTokens: 'id, sentenceId, meaningId, [sentenceId+position]',
      srsCards: 'id, sentenceId, deckId, due, state, [deckId+state], [deckId+due]',
      decks: 'id',
      reviewLogs: 'id, cardId, reviewedAt',
      outbox: '++id, op, status, createdAt',
      syncMeta: 'key',
    });

    this.version(2).stores({
      audioRecordings: 'id, sentenceId, createdAt',
    });

    // v3: add a normalizedChinese index for instant dedup lookups and
    // backfill existing rows so the guard works for sentences added before
    // the column existed.
    this.version(3)
      .stores({
        sentences: 'id, chinese, normalizedChinese, source, *tags, createdAt',
      })
      .upgrade(async (tx) => {
        const table = tx.table('sentences');
        const rows = await table.toArray();
        for (const row of rows) {
          if (typeof row.chinese === 'string') {
            row.normalizedChinese = normalizeChineseForIndex(row.chinese);
          }
        }
        if (rows.length > 0) await table.bulkPut(rows);
      });

    // v4: meaning_flags — audit trail of CEDICT/LLM disagreements at ingest.
    this.version(4).stores({
      meaningFlags: 'id, meaningId, headword, flagKind, resolvedAt, createdAt',
    });

    // v5: split audio bytes off audio_recordings into a client-only
    // audioBlobs table. Keeps cache state (lastPlayedAt, sizeBytes) out of
    // the synced row and lets us enumerate / sum / evict cleanly.
    this.version(5)
      .stores({
        audioBlobs: 'recordingId, lastPlayedAt, fetchedAt',
      })
      .upgrade(async (tx) => {
        const recs = await tx.table('audioRecordings').toArray();
        const moves: AudioBlob[] = [];
        const cleared: AudioRecording[] = [];
        for (const rec of recs) {
          const oldBlob = (rec as AudioRecording & { blob?: Blob }).blob;
          if (oldBlob instanceof Blob) {
            try {
              const data = await oldBlob.arrayBuffer();
              if (data.byteLength > 0) {
                const ts = rec.createdAt ?? Date.now();
                moves.push({
                  recordingId: rec.id,
                  data,
                  mimeType: rec.mimeType ?? oldBlob.type ?? 'audio/webm',
                  sizeBytes: data.byteLength,
                  fetchedAt: ts,
                  lastPlayedAt: ts,
                });
              }
            } catch {
              // Blob body already evicted by WebKit — drop, the row will
              // re-download from Storage on next play.
            }
            // bulkPut replaces the whole row, so dropping `blob` from the
            // copy is enough to remove it from IDB.
            const next = { ...rec } as AudioRecording & { blob?: Blob };
            delete next.blob;
            cleared.push(next);
          }
        }
        if (moves.length > 0) {
          await tx.table('audioBlobs').bulkPut(moves);
        }
        if (cleared.length > 0) {
          await tx.table('audioRecordings').bulkPut(cleared);
        }
      });

    // v6: rewrite audioBlobs entries that still carry a Blob in `blob` to
    // store an ArrayBuffer in `data`. iOS WebKit evicts Blob bodies
    // (sidecar files) separately from their IDB records — surfacing as
    // `audio.play()` rejecting with NotSupportedError on previously-good
    // entries — while ArrayBuffers live inside the record itself and
    // can't be evicted independently. Bumping the schema version forces
    // every existing client to re-shape its cache. See the AudioBlob
    // type comment in src/db/schema.ts for details.
    this.version(6)
      .stores({
        // No index changes; bumping version + this upgrade is the point.
        audioBlobs: 'recordingId, lastPlayedAt, fetchedAt',
      })
      .upgrade(async (tx) => {
        const table = tx.table('audioBlobs');
        const rows = await table.toArray();
        const updates: AudioBlob[] = [];
        const drops: string[] = [];
        for (const row of rows) {
          // Already in new shape — nothing to do.
          if (row.data instanceof ArrayBuffer) continue;
          const oldBlob = (row as AudioBlob & { blob?: Blob }).blob;
          if (!(oldBlob instanceof Blob)) {
            // Neither shape — corrupt row, drop it.
            drops.push(row.recordingId);
            continue;
          }
          try {
            const data = await oldBlob.arrayBuffer();
            if (data.byteLength === 0) {
              drops.push(row.recordingId);
              continue;
            }
            updates.push({
              recordingId: row.recordingId,
              data,
              mimeType: row.mimeType ?? oldBlob.type ?? 'audio/webm',
              sizeBytes: data.byteLength,
              fetchedAt: row.fetchedAt,
              lastPlayedAt: row.lastPlayedAt,
            });
          } catch {
            // Blob body has been evicted — there's nothing to migrate.
            // Drop the metadata row so the next play re-fetches fresh.
            drops.push(row.recordingId);
          }
        }
        if (drops.length > 0) await table.bulkDelete(drops);
        if (updates.length > 0) await table.bulkPut(updates);
      });
  }
}

/** Duplicated here to avoid circular import from localRepo. Keep in sync. */
function normalizeChineseForIndex(s: string): string {
  let out = '';
  for (const c of s) {
    const code = c.codePointAt(0)!;
    if (code >= 0x4e00 && code <= 0x9fff) { out += c; continue; }
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      out += c.toLowerCase();
    }
  }
  return out;
}

export const localDb = new MandaoDb();

export async function clearLocalDb(): Promise<void> {
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
      localDb.outbox,
      localDb.syncMeta,
      localDb.audioRecordings,
      localDb.audioBlobs,
      localDb.meaningFlags,
    ],
    async () => {
      await Promise.all([
        localDb.meanings.clear(),
        localDb.meaningLinks.clear(),
        localDb.sentences.clear(),
        localDb.sentenceTokens.clear(),
        localDb.srsCards.clear(),
        localDb.decks.clear(),
        localDb.reviewLogs.clear(),
        localDb.outbox.clear(),
        localDb.syncMeta.clear(),
        localDb.audioRecordings.clear(),
        localDb.audioBlobs.clear(),
        localDb.meaningFlags.clear(),
      ]);
    }
  );
}
