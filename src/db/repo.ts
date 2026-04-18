/**
 * Repo facade — the single import point for all data access.
 *
 * Reads: always from Dexie (instant, works offline).
 * Writes: Dexie first (instant), then enqueue a sync op in the outbox.
 * The sync engine pushes the outbox to Supabase when online.
 *
 * The public API is unchanged — every consumer imports from this file.
 */
import * as local from './localRepo';
import { localDb, type SyncOp } from './localDb';
import { supabase } from '../lib/supabase';
import { getDeviceId, scheduleSyncSoon } from './syncEngine';
import {
  getUserId as getRemoteUserId,
  clearCachedUserId as clearRemoteCache,
  getCachedUserIdOrThrow,
} from './remoteRepo';
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  Deck,
  ReviewLog,
} from './schema';
import { v4 as uuid } from 'uuid';
import { useSyncStore } from '../stores/syncStore';

export { clearRemoteCache as clearCachedUserId };
export { getRemoteUserId as getUserId };

async function enqueue(op: Pick<SyncOp, 'op' | 'payload'>): Promise<void> {
  await localDb.outbox.add({
    ...op,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    deviceId: getDeviceId(),
    opId: uuid(),
  });
  if (navigator.onLine) useSyncStore.getState().setStatus('syncing');
  scheduleSyncSoon();
}

// ============================================================
// Meanings — reads from local, writes local + outbox
// ============================================================

export async function getMeaning(id: string): Promise<Meaning | undefined> {
  return local.getMeaning(id);
}

export async function getMeaningsByHeadword(headword: string): Promise<Meaning[]> {
  return local.getMeaningsByHeadword(headword);
}

export async function getMeaningsByPinyinNumeric(pinyinNumeric: string): Promise<Meaning[]> {
  return local.getMeaningsByPinyinNumeric(pinyinNumeric);
}

export async function getAllMeanings(): Promise<Meaning[]> {
  return local.getAllMeanings();
}

export async function getMeaningsByIds(ids: string[]): Promise<Meaning[]> {
  return local.getMeaningsByIds(ids);
}

export async function getMeaningsCount(): Promise<number> {
  return local.getMeaningsCount();
}

export async function insertMeaning(meaning: Meaning): Promise<void> {
  await local.insertMeaning(meaning);
  // Meanings are enqueued as part of ingestBundle — no standalone outbox op needed.
}

// ============================================================
// MeaningLinks — reads from local, writes local + outbox
// ============================================================

export async function getMeaningLinksByParent(parentMeaningId: string): Promise<MeaningLink[]> {
  return local.getMeaningLinksByParent(parentMeaningId);
}

export async function getMeaningLinksByChild(childMeaningId: string): Promise<MeaningLink[]> {
  return local.getMeaningLinksByChild(childMeaningId);
}

export async function getMeaningLinkCountByParent(parentMeaningId: string): Promise<number> {
  return local.getMeaningLinkCountByParent(parentMeaningId);
}

export async function getAllMeaningLinks(): Promise<MeaningLink[]> {
  return local.getAllMeaningLinks();
}

export async function insertMeaningLink(link: MeaningLink): Promise<void> {
  await local.insertMeaningLink(link);
  // MeaningLinks are enqueued as part of ingestBundle.
}

// ============================================================
// Sentences — reads from local, writes local + outbox
// ============================================================

export async function getSentence(id: string): Promise<Sentence | undefined> {
  return local.getSentence(id);
}

export async function getSentenceByNormalizedChinese(chinese: string): Promise<Sentence | undefined> {
  return local.getSentenceByNormalizedChinese(chinese);
}

export async function getSentenceByChinese(chinese: string): Promise<Sentence | undefined> {
  return local.getSentenceByChinese(chinese);
}

export async function getSentencesBySource(source: string): Promise<Sentence[]> {
  return local.getSentencesBySource(source);
}

export async function getSentencesByTags(tags: string[]): Promise<Sentence[]> {
  return local.getSentencesByTags(tags);
}

export async function getSentencesOrderByCreatedDesc(): Promise<Sentence[]> {
  return local.getSentencesOrderByCreatedDesc();
}

export async function getAllSentences(): Promise<Sentence[]> {
  return local.getAllSentences();
}

export async function getSentencesCount(): Promise<number> {
  return local.getSentencesCount();
}

export async function getSentencesByIds(ids: string[]): Promise<Sentence[]> {
  return local.getSentencesByIds(ids);
}

export async function insertSentence(sentence: Sentence): Promise<void> {
  await local.insertSentence(sentence);
  // Enqueued as part of ingestBundle by the ingestion service.
}

export async function updateSentenceTags(id: string, tags: string[]): Promise<void> {
  await local.updateSentenceTags(id, tags);
  await enqueue({ op: 'updateTags', payload: { id, tags } });
}

export async function deleteSentenceById(id: string): Promise<void> {
  await local.deleteSentenceById(id);
  await enqueue({
    op: 'deleteEntity',
    payload: { entity_type: 'sentence', entity_id: id },
  });
}

export async function deleteSentencesBySource(source: string): Promise<void> {
  const sentences = await local.getSentencesBySource(source);
  if (sentences.length === 0) return;

  await Promise.all(sentences.map((s) => local.deleteSentenceById(s.id)));
  for (const s of sentences) {
    await enqueue({
      op: 'deleteEntity',
      payload: { entity_type: 'sentence', entity_id: s.id },
    });
  }
}

// ============================================================
// SentenceTokens — reads from local, writes local + outbox
// ============================================================

export async function getTokensBySentence(sentenceId: string): Promise<SentenceToken[]> {
  return local.getTokensBySentence(sentenceId);
}

export async function getTokensByMeaning(meaningId: string): Promise<SentenceToken[]> {
  return local.getTokensByMeaning(meaningId);
}

export async function getAllSentenceTokens(): Promise<SentenceToken[]> {
  return local.getAllSentenceTokens();
}

export async function insertSentenceTokens(tokens: SentenceToken[]): Promise<void> {
  if (tokens.length === 0) return;
  await local.insertSentenceTokens(tokens);
  // Enqueued as part of ingestBundle.
}

export async function deleteTokensBySentence(sentenceId: string): Promise<void> {
  await local.deleteTokensBySentence(sentenceId);
  // Cascaded via sentence delete outbox op.
}

// ============================================================
// SrsCards — reads from local, writes local + outbox
// ============================================================

export async function getSrsCard(id: string): Promise<SrsCard | undefined> {
  return local.getSrsCard(id);
}

export async function getSrsCardsBySentence(sentenceId: string): Promise<SrsCard[]> {
  return local.getSrsCardsBySentence(sentenceId);
}

export async function getSrsCardsByDeckAndState(deckId: string, state: number): Promise<SrsCard[]> {
  return local.getSrsCardsByDeckAndState(deckId, state);
}

export async function getSrsCardsByDeckAndStates(deckId: string, states: number[]): Promise<SrsCard[]> {
  return local.getSrsCardsByDeckAndStates(deckId, states);
}

export async function countSrsCardsByDeckAndState(deckId: string, state: number): Promise<number> {
  return local.countSrsCardsByDeckAndState(deckId, state);
}

export async function countDueSrsCardsByDeckAndStates(deckId: string, states: number[], dueBy: number): Promise<number> {
  return local.countDueSrsCardsByDeckAndStates(deckId, states, dueBy);
}

export async function getAllSrsCards(): Promise<SrsCard[]> {
  return local.getAllSrsCards();
}

export async function getSrsCardsByIds(ids: string[]): Promise<SrsCard[]> {
  return local.getSrsCardsByIds(ids);
}

export async function insertSrsCards(cards: SrsCard[]): Promise<void> {
  if (cards.length === 0) return;
  await local.insertSrsCards(cards);
  // Enqueued as part of ingestBundle.
}

export async function updateSrsCard(id: string, updates: Partial<SrsCard>): Promise<void> {
  await local.updateSrsCard(id, updates);
  // Card updates from reviews are enqueued via reviewCard op in srs.ts.
}

export async function deleteSrsCardsBySentence(sentenceId: string): Promise<void> {
  await local.deleteSrsCardsBySentence(sentenceId);
  // Cascaded via sentence delete outbox op.
}

// ============================================================
// Decks — reads from local, writes local
// ============================================================

export async function getDeck(id: string): Promise<Deck | undefined> {
  return local.getDeck(id);
}

export async function updateDeck(id: string, updates: Partial<Deck>): Promise<void> {
  await local.updateDeck(id, updates);
}

export async function getAllDecks(): Promise<Deck[]> {
  return local.getAllDecks();
}

export async function ensureDefaultDeck(): Promise<string> {
  // Prefer cached ID to avoid network call (works offline).
  // Falls through to getUser() only if cache is cold (rare at startup).
  try {
    const userId = getCachedUserIdOrThrow();
    return local.ensureDefaultDeck(userId);
  } catch {
    const userId = await getRemoteUserId();
    return local.ensureDefaultDeck(userId);
  }
}

// ============================================================
// ReviewLogs — reads from local, writes local + outbox
// ============================================================

export async function getReviewLogsByCardIds(cardIds: string[]): Promise<ReviewLog[]> {
  return local.getReviewLogsByCardIds(cardIds);
}

export async function getReviewLogsSince(timestamp: number): Promise<ReviewLog[]> {
  return local.getReviewLogsSince(timestamp);
}

export async function getAllReviewLogs(): Promise<ReviewLog[]> {
  return local.getAllReviewLogs();
}

export async function insertReviewLog(log: ReviewLog): Promise<void> {
  await local.insertReviewLog(log);
  // Review logs are enqueued via reviewCard op in srs.ts.
}

export async function deleteReviewLog(id: string): Promise<void> {
  await local.deleteReviewLog(id);
}

export async function deleteReviewLogsByCardIds(cardIds: string[]): Promise<void> {
  await local.deleteReviewLogsByCardIds(cardIds);
  // Cascaded via card/sentence delete.
}

// ============================================================
// Bulk delete — local + outbox per entity
// ============================================================

export async function deleteAllUserData(): Promise<void> {
  await local.deleteAllUserData();
  // Clear hydration + USN so the app can rehydrate from server if
  // the delete op doesn't push (e.g. user is offline or closes the tab).
  await localDb.syncMeta.delete('lastHydratedAt');
  await localDb.syncMeta.delete('lastUsn');
  await localDb.syncMeta.delete('schemaVersion');
  await enqueue({ op: 'deleteAllData', payload: {} });
}

// ============================================================
// Audio recordings — write local, sync metadata + Storage via outbox
// ============================================================

export async function getAudioRecordingsBySentence(sentenceId: string) {
  return local.getAudioRecordingsBySentence(sentenceId);
}

/**
 * Build the outbox payload for an audio recording. The Blob intentionally
 * stays in Dexie — the push handler reads it fresh at upload time so the
 * outbox row stays tiny even if the upload retries.
 */
function audioUpsertPayload(rec: import('./schema').AudioRecording) {
  return {
    id: rec.id,
    sentenceId: rec.sentenceId,
    name: rec.name,
    mimeType: rec.mimeType,
    durationMs: rec.durationMs ?? null,
    source: rec.source,
    createdAt: rec.createdAt,
  };
}

export async function insertAudioRecording(rec: import('./schema').AudioRecording) {
  await local.insertAudioRecording(rec);
  await enqueue({ op: 'upsertAudioRecording', payload: audioUpsertPayload(rec) });
}

export async function updateAudioRecordingName(id: string, name: string) {
  await local.updateAudioRecording(id, { name, updatedAt: Date.now() });
  const rec = await local.getAudioRecording(id);
  if (rec) {
    await enqueue({ op: 'upsertAudioRecording', payload: audioUpsertPayload(rec) });
  }
}

export async function deleteAudioRecording(id: string) {
  // Coalesce any still-pending upsert for this id so record-then-delete
  // offline doesn't waste an upload. Narrowed by the `op` index first.
  const pendingUpsert = await localDb.outbox
    .where('op')
    .equals('upsertAudioRecording')
    .filter((op) => op.status === 'pending' && op.payload?.id === id)
    .first();
  if (pendingUpsert?.id != null) {
    await localDb.outbox.delete(pendingUpsert.id);
  }

  await local.deleteAudioRecording(id);
  await enqueue({
    op: 'deleteEntity',
    payload: { entity_type: 'audio_recording', entity_id: id },
  });
}

/**
 * Lazy-fetch a recording's Blob via a short-lived signed URL and cache it
 * back into Dexie so future plays skip the network. Returns null on failure
 * (no row, no storagePath, or network error).
 */
export async function fetchAudioBlob(id: string): Promise<Blob | null> {
  const rec = await local.getAudioRecording(id);
  if (!rec?.storagePath) return null;
  const { data, error } = await supabase.storage
    .from('audio-recordings')
    .createSignedUrl(rec.storagePath, 3600);
  if (error || !data?.signedUrl) return null;
  try {
    const resp = await fetch(data.signedUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    await local.updateAudioRecording(id, { blob });
    return blob;
  } catch {
    return null;
  }
}

// ============================================================
// Sync op helpers (called by services, not by this facade)
// ============================================================

export { enqueue as enqueueSync };

/** Delete a pending sync op by its opId (used for undo compensation). */
export async function deletePendingSyncOp(opId: string): Promise<void> {
  const match = await localDb.outbox
    .filter((op) => op.opId === opId && op.status === 'pending')
    .first();
  if (match?.id != null) {
    await localDb.outbox.delete(match.id);
  }
}
