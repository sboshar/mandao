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
      ]);
    }
  );
}
