/**
 * Local data access layer backed by Dexie (IndexedDB).
 * Same public API surface as the remote repo so the facade in repo.ts
 * can delegate here for reads and local writes.
 */
import { localDb } from './localDb';
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  Deck,
  ReviewLog,
} from './schema';

// ============================================================
// Meanings
// ============================================================

export async function getMeaning(id: string): Promise<Meaning | undefined> {
  return localDb.meanings.get(id);
}

export async function getMeaningsByHeadword(headword: string): Promise<Meaning[]> {
  return localDb.meanings.where('headword').equals(headword).toArray();
}

export async function getMeaningsByPinyinNumeric(pinyinNumeric: string): Promise<Meaning[]> {
  return localDb.meanings.where('pinyinNumeric').equals(pinyinNumeric).toArray();
}

export async function getAllMeanings(): Promise<Meaning[]> {
  return localDb.meanings.toArray();
}

export async function getMeaningsByIds(ids: string[]): Promise<Meaning[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  return localDb.meanings.where('id').anyOf(unique).toArray();
}

export async function getMeaningsCount(): Promise<number> {
  return localDb.meanings.count();
}

export async function insertMeaning(meaning: Meaning): Promise<void> {
  await localDb.meanings.put(meaning);
}

export async function deleteMeaningsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await localDb.meanings.bulkDelete(ids);
}

// ============================================================
// MeaningLinks
// ============================================================

export async function getMeaningLinksByParent(parentMeaningId: string): Promise<MeaningLink[]> {
  return localDb.meaningLinks
    .where('parentMeaningId')
    .equals(parentMeaningId)
    .sortBy('position');
}

export async function getMeaningLinksByChild(childMeaningId: string): Promise<MeaningLink[]> {
  return localDb.meaningLinks
    .where('childMeaningId')
    .equals(childMeaningId)
    .toArray();
}

export async function getMeaningLinkCountByParent(parentMeaningId: string): Promise<number> {
  return localDb.meaningLinks
    .where('parentMeaningId')
    .equals(parentMeaningId)
    .count();
}

export async function getAllMeaningLinks(): Promise<MeaningLink[]> {
  return localDb.meaningLinks.toArray();
}

export async function insertMeaningLink(link: MeaningLink): Promise<void> {
  await localDb.meaningLinks.put(link);
}

export async function deleteMeaningLinksByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await localDb.meaningLinks.bulkDelete(ids);
}

// ============================================================
// Sentences
// ============================================================

export async function getSentence(id: string): Promise<Sentence | undefined> {
  return localDb.sentences.get(id);
}

export async function getSentenceByChinese(chinese: string): Promise<Sentence | undefined> {
  return localDb.sentences.where('chinese').equals(chinese).first();
}

export async function getSentencesBySource(source: string): Promise<Sentence[]> {
  const rows = await localDb.sentences.where('source').equals(source).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSentencesByTags(tags: string[]): Promise<Sentence[]> {
  const results = await localDb.sentences
    .where('tags')
    .anyOf(tags)
    .toArray();
  const deduped = new Map(results.map((s) => [s.id, s]));
  return [...deduped.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSentencesOrderByCreatedDesc(): Promise<Sentence[]> {
  const rows = await localDb.sentences.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getAllSentences(): Promise<Sentence[]> {
  const rows = await localDb.sentences.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSentencesCount(): Promise<number> {
  return localDb.sentences.count();
}

export async function getSentencesByIds(ids: string[]): Promise<Sentence[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  return localDb.sentences.where('id').anyOf(unique).toArray();
}

export async function insertSentence(sentence: Sentence): Promise<void> {
  await localDb.sentences.put(sentence);
}

export async function updateSentenceTags(id: string, tags: string[]): Promise<void> {
  await localDb.sentences.update(id, { tags });
}

export async function deleteSentenceById(id: string): Promise<void> {
  await localDb.transaction(
    'rw',
    [localDb.sentences, localDb.sentenceTokens, localDb.srsCards, localDb.reviewLogs],
    async () => {
      const cards = await localDb.srsCards.where('sentenceId').equals(id).toArray();
      const cardIds = cards.map((c) => c.id);
      if (cardIds.length > 0) {
        await localDb.reviewLogs.where('cardId').anyOf(cardIds).delete();
      }
      await localDb.srsCards.where('sentenceId').equals(id).delete();
      await localDb.sentenceTokens.where('sentenceId').equals(id).delete();
      await localDb.sentences.delete(id);
    }
  );
}

export async function deleteSentencesBySource(source: string): Promise<void> {
  const sentences = await localDb.sentences.where('source').equals(source).toArray();
  for (const s of sentences) {
    await deleteSentenceById(s.id);
  }
}

// ============================================================
// SentenceTokens
// ============================================================

export async function getTokensBySentence(sentenceId: string): Promise<SentenceToken[]> {
  return localDb.sentenceTokens
    .where('sentenceId')
    .equals(sentenceId)
    .sortBy('position');
}

export async function getTokensByMeaning(meaningId: string): Promise<SentenceToken[]> {
  return localDb.sentenceTokens.where('meaningId').equals(meaningId).toArray();
}

export async function getAllSentenceTokens(): Promise<SentenceToken[]> {
  return localDb.sentenceTokens.toArray();
}

export async function insertSentenceTokens(tokens: SentenceToken[]): Promise<void> {
  if (tokens.length === 0) return;
  await localDb.sentenceTokens.bulkPut(tokens);
}

export async function deleteTokensBySentence(sentenceId: string): Promise<void> {
  await localDb.sentenceTokens.where('sentenceId').equals(sentenceId).delete();
}

// ============================================================
// SrsCards
// ============================================================

export async function getSrsCard(id: string): Promise<SrsCard | undefined> {
  return localDb.srsCards.get(id);
}

export async function getSrsCardsBySentence(sentenceId: string): Promise<SrsCard[]> {
  return localDb.srsCards.where('sentenceId').equals(sentenceId).toArray();
}

export async function getSrsCardsByDeckAndState(deckId: string, state: number): Promise<SrsCard[]> {
  return localDb.srsCards
    .where('[deckId+state]')
    .equals([deckId, state])
    .sortBy('due');
}

export async function countSrsCardsByDeckAndState(deckId: string, state: number): Promise<number> {
  return localDb.srsCards
    .where('[deckId+state]')
    .equals([deckId, state])
    .count();
}

export async function countDueSrsCardsByDeckAndStates(
  deckId: string,
  states: number[],
  dueBy: number,
): Promise<number> {
  const counts = await Promise.all(
    states.map((state) =>
      localDb.srsCards
        .where('[deckId+state]')
        .equals([deckId, state])
        .and((c) => c.due <= dueBy)
        .count()
    ),
  );
  return counts.reduce((sum, c) => sum + c, 0);
}

export async function getSrsCardsByDeckAndStates(deckId: string, states: number[]): Promise<SrsCard[]> {
  const results: SrsCard[] = [];
  for (const state of states) {
    const batch = await getSrsCardsByDeckAndState(deckId, state);
    results.push(...batch);
  }
  return results.sort((a, b) => a.due - b.due);
}

export async function getAllSrsCards(): Promise<SrsCard[]> {
  return localDb.srsCards.orderBy('due').toArray();
}

export async function getSrsCardsByIds(ids: string[]): Promise<SrsCard[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  return localDb.srsCards.where('id').anyOf(unique).toArray();
}

export async function insertSrsCards(cards: SrsCard[]): Promise<void> {
  if (cards.length === 0) return;
  await localDb.srsCards.bulkPut(cards);
}

export async function updateSrsCard(id: string, updates: Partial<SrsCard>): Promise<void> {
  await localDb.srsCards.update(id, updates);
}

export async function deleteSrsCardsBySentence(sentenceId: string): Promise<void> {
  await localDb.srsCards.where('sentenceId').equals(sentenceId).delete();
}

// ============================================================
// Decks
// ============================================================

export async function getDeck(id: string): Promise<Deck | undefined> {
  return localDb.decks.get(id);
}

export async function ensureDefaultDeck(userId: string): Promise<string> {
  const deckId = 'default-' + userId;
  const existing = await localDb.decks.get(deckId);
  if (!existing) {
    await localDb.decks.put({
      id: deckId,
      name: 'Default',
      description: 'Default deck',
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      createdAt: Date.now(),
    });
  }
  return deckId;
}

// ============================================================
// ReviewLogs
// ============================================================

export async function getReviewLogsByCardIds(cardIds: string[]): Promise<ReviewLog[]> {
  if (cardIds.length === 0) return [];
  const unique = [...new Set(cardIds)];
  return localDb.reviewLogs.where('cardId').anyOf(unique).toArray();
}

export async function getReviewLogsSince(timestamp: number): Promise<ReviewLog[]> {
  return localDb.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(timestamp)
    .sortBy('reviewedAt');
}

export async function getAllReviewLogs(): Promise<ReviewLog[]> {
  return localDb.reviewLogs.orderBy('reviewedAt').toArray();
}

export async function insertReviewLog(log: ReviewLog): Promise<void> {
  await localDb.reviewLogs.put(log);
}

export async function deleteReviewLogsByCardIds(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  await localDb.reviewLogs.where('cardId').anyOf(cardIds).delete();
}

// ============================================================
// Bulk delete
// ============================================================

export async function deleteAllUserData(): Promise<void> {
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
    ],
    async () => {
      await Promise.all([
        localDb.sentences.clear(),
        localDb.sentenceTokens.clear(),
        localDb.srsCards.clear(),
        localDb.reviewLogs.clear(),
        localDb.meanings.clear(),
        localDb.meaningLinks.clear(),
        localDb.decks.clear(),
      ]);
    }
  );
}
