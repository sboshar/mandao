import Dexie, { type Table } from 'dexie';
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  Deck,
  ReviewLog,
} from './schema';

export interface SyncMeta {
  key: string;
  value: string | number;
}

export type SyncOpType =
  | 'reviewCard'
  | 'ingestBundle'
  | 'deleteEntity'
  | 'updateTags';

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
  }
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
      ]);
    }
  );
}
