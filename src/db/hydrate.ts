/**
 * Hydration: pulls all user data from Supabase into local Dexie.
 * Called once after login / on app startup when Dexie is empty.
 */
import * as remote from './remoteRepo';
import { localDb } from './localDb';

export async function hydrateLocalDb(): Promise<void> {
  // Ensure at least a default deck exists before pulling
  await remote.ensureDefaultDeck();

  const [
    meanings,
    meaningLinks,
    sentences,
    sentenceTokens,
    decks,
    srsCards,
    reviewLogs,
  ] = await Promise.all([
    remote.getAllMeanings(),
    remote.getAllMeaningLinks(),
    remote.getAllSentences(),
    remote.getAllSentenceTokens(),
    remote.getAllDecks(),
    remote.getAllSrsCards(),
    remote.getAllReviewLogs(),
  ]);

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
      await Promise.all([
        localDb.meanings.clear(),
        localDb.meaningLinks.clear(),
        localDb.sentences.clear(),
        localDb.sentenceTokens.clear(),
        localDb.srsCards.clear(),
        localDb.decks.clear(),
        localDb.reviewLogs.clear(),
      ]);

      await Promise.all([
        meanings.length > 0 ? localDb.meanings.bulkPut(meanings) : undefined,
        meaningLinks.length > 0 ? localDb.meaningLinks.bulkPut(meaningLinks) : undefined,
        sentences.length > 0 ? localDb.sentences.bulkPut(sentences) : undefined,
        sentenceTokens.length > 0 ? localDb.sentenceTokens.bulkPut(sentenceTokens) : undefined,
        decks.length > 0 ? localDb.decks.bulkPut(decks) : undefined,
        srsCards.length > 0 ? localDb.srsCards.bulkPut(srsCards) : undefined,
        reviewLogs.length > 0 ? localDb.reviewLogs.bulkPut(reviewLogs) : undefined,
      ]);

      await localDb.syncMeta.put({
        key: 'lastHydratedAt',
        value: Date.now(),
      });
    }
  );
}

export async function isHydrated(): Promise<boolean> {
  const meta = await localDb.syncMeta.get('lastHydratedAt');
  return meta !== undefined;
}
