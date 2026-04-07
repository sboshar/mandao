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
import { DEFAULT_DECK_ID } from './schema';

export class MandarinDB extends Dexie {
  meanings!: Table<Meaning>;
  meaningLinks!: Table<MeaningLink>;
  sentences!: Table<Sentence>;
  sentenceTokens!: Table<SentenceToken>;
  srsCards!: Table<SrsCard>;
  decks!: Table<Deck>;
  reviewLogs!: Table<ReviewLog>;

  constructor() {
    super('MandarinApp');

    this.version(2).stores({
      meanings: 'id, headword, type, level, pinyinNumeric',
      meaningLinks:
        'id, parentMeaningId, childMeaningId, [parentMeaningId+position]',
      sentences: 'id, chinese, createdAt, source',
      sentenceTokens: 'id, sentenceId, meaningId, [sentenceId+position]',
      srsCards:
        'id, sentenceId, deckId, due, state, [deckId+due], [deckId+state], [sentenceId+reviewMode]',
      decks: 'id, name',
      reviewLogs: 'id, cardId, reviewedAt',
    });

    this.version(3).stores({
      sentences: 'id, chinese, createdAt, source, *tags',
    }).upgrade((tx) => {
      return tx.table('sentences').toCollection().modify((sentence) => {
        if (!sentence.tags) sentence.tags = [];
      });
    });
  }
}

export const db = new MandarinDB();

/** Ensure default deck exists on first load */
export async function ensureDefaults() {
  const existing = await db.decks.get(DEFAULT_DECK_ID);
  if (!existing) {
    await db.decks.add({
      id: DEFAULT_DECK_ID,
      name: 'Default',
      description: 'Default deck',
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      createdAt: Date.now(),
    });
  }
}
