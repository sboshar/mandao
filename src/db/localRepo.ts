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
  AudioRecording,
  MeaningFlag,
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

/**
 * Pure orphan-closure computation — split out of findOrphanClosure so
 * it's exercisable without Dexie. Given the candidate set and the
 * current meaning_links + sentence_tokens, returns the meaning IDs
 * that should be deleted and the meaning_link IDs that should go with
 * them (any link incident to an orphan, on either end).
 *
 * An orphan is a meaning with:
 *   - no surviving sentence_token pointing at it, AND
 *   - no surviving meaning_link from a *non-orphan* parent.
 *
 * The fixed-point loop handles the transitive case: a character
 * reachable only from a compound word becomes an orphan once the
 * compound word is itself determined to be orphan.
 */
export function computeOrphanClosure(
  candidateMeaningIds: string[],
  allLinks: MeaningLink[],
  allTokens: SentenceToken[],
): { meanings: string[]; links: string[] } {
  if (candidateMeaningIds.length === 0) return { meanings: [], links: [] };

  // Precompute three indexes so the fixed-point loop is O(1) per
  // lookup, and so the final "which links touch the orphan set" step
  // doesn't need another full scan:
  //   referenced:      any remaining sentence_token still points at m
  //   parentsOf:       m → parent meaning IDs
  //   childrenOf:      m → child meaning IDs
  //   linksTouching:   m → meaning_link IDs incident to m
  const referenced = new Set(allTokens.map((t) => t.meaningId));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const linksTouching = new Map<string, string[]>();
  const pushTo = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const l of allLinks) {
    pushTo(parentsOf, l.childMeaningId, l.parentMeaningId);
    pushTo(childrenOf, l.parentMeaningId, l.childMeaningId);
    pushTo(linksTouching, l.parentMeaningId, l.id);
    pushTo(linksTouching, l.childMeaningId, l.id);
  }

  const orphans = new Set<string>();
  let candidates = [...candidateMeaningIds];
  let changed = true;

  while (changed) {
    changed = false;
    const nextCandidates: string[] = [];
    for (const mId of candidates) {
      if (orphans.has(mId)) continue;
      if (referenced.has(mId)) continue;
      const parents = parentsOf.get(mId) ?? [];
      const hasLivingParent = parents.some((p) => !orphans.has(p));
      if (hasLivingParent) continue;
      orphans.add(mId);
      changed = true;
      for (const cId of childrenOf.get(mId) ?? []) {
        if (!orphans.has(cId)) nextCandidates.push(cId);
      }
    }
    candidates = nextCandidates;
  }

  const linkIds = new Set<string>();
  for (const m of orphans) {
    for (const lid of linksTouching.get(m) ?? []) linkIds.add(lid);
  }
  return { meanings: [...orphans], links: [...linkIds] };
}

/**
 * Thin Dexie wrapper around computeOrphanClosure — reads the current
 * meaning_links + sentence_tokens tables and defers to the pure
 * computation. See computeOrphanClosure for semantics.
 */
export async function findOrphanClosure(
  candidateMeaningIds: string[],
): Promise<{ meanings: string[]; links: string[] }> {
  if (candidateMeaningIds.length === 0) return { meanings: [], links: [] };
  const [allLinks, allTokens] = await Promise.all([
    localDb.meaningLinks.toArray(),
    localDb.sentenceTokens.toArray(),
  ]);
  return computeOrphanClosure(candidateMeaningIds, allLinks, allTokens);
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

/** Strip everything except Hanzi and alphanumerics; lowercase. */
export function normalizeChinese(s: string): string {
  let out = '';
  for (const c of s) {
    const code = c.codePointAt(0)!;
    // CJK Unified Ideographs
    if (code >= 0x4e00 && code <= 0x9fff) { out += c; continue; }
    // ASCII alphanumerics
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      out += c.toLowerCase();
    }
  }
  return out;
}

/** Indexed instant lookup used as a pre-LLM dedup guard. */
export async function getSentenceByNormalizedChinese(chinese: string): Promise<Sentence | undefined> {
  const key = normalizeChinese(chinese);
  if (!key) return undefined;
  return localDb.sentences.where('normalizedChinese').equals(key).first();
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
    [
      localDb.sentences,
      localDb.sentenceTokens,
      localDb.srsCards,
      localDb.reviewLogs,
      localDb.audioRecordings,
    ],
    async () => {
      const cards = await localDb.srsCards.where('sentenceId').equals(id).toArray();
      const cardIds = cards.map((c) => c.id);
      if (cardIds.length > 0) {
        await localDb.reviewLogs.where('cardId').anyOf(cardIds).delete();
      }
      await localDb.srsCards.where('sentenceId').equals(id).delete();
      await localDb.sentenceTokens.where('sentenceId').equals(id).delete();
      await localDb.audioRecordings.where('sentenceId').equals(id).delete();
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

export async function updateDeck(id: string, updates: Partial<Deck>): Promise<void> {
  await localDb.decks.update(id, updates);
}

export async function getAllDecks(): Promise<Deck[]> {
  return localDb.decks.toArray();
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

export async function deleteReviewLog(id: string): Promise<void> {
  await localDb.reviewLogs.delete(id);
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
      localDb.audioRecordings,
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
        localDb.audioRecordings.clear(),
      ]);
    }
  );
}

// ============================================================
// Audio recordings
// ============================================================

export async function getAudioRecordingsBySentence(
  sentenceId: string
): Promise<AudioRecording[]> {
  return localDb.audioRecordings
    .where('sentenceId')
    .equals(sentenceId)
    .sortBy('createdAt');
}

export async function getAudioRecording(id: string): Promise<AudioRecording | undefined> {
  return localDb.audioRecordings.get(id);
}

export async function insertAudioRecording(rec: AudioRecording): Promise<void> {
  await localDb.audioRecordings.put(rec);
}

export async function updateAudioRecording(
  id: string,
  patch: Partial<AudioRecording>,
): Promise<void> {
  await localDb.audioRecordings.update(id, patch);
}

export async function deleteAudioRecording(id: string): Promise<void> {
  await localDb.audioRecordings.delete(id);
}

export async function getAllAudioStoragePaths(): Promise<string[]> {
  const rows = await localDb.audioRecordings.toArray();
  return rows.map((r) => r.storagePath).filter((p): p is string => !!p);
}

// ============================================================
// Meaning flags
// ============================================================

export async function insertMeaningFlags(flags: MeaningFlag[]): Promise<void> {
  if (flags.length === 0) return;
  await localDb.meaningFlags.bulkPut(flags);
}

export async function getMeaningFlags(meaningId: string): Promise<MeaningFlag[]> {
  return localDb.meaningFlags.where('meaningId').equals(meaningId).toArray();
}

export async function getUnresolvedMeaningFlags(): Promise<MeaningFlag[]> {
  return localDb.meaningFlags
    .filter((f) => f.resolvedAt === null || f.resolvedAt === undefined)
    .toArray();
}
