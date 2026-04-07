/**
 * Supabase data access layer.
 * Replaces all Dexie (IndexedDB) calls with Supabase Postgres queries.
 * Every function adds user_id from the current auth session.
 *
 * camelCase ↔ snake_case conversion happens at this boundary so consumers
 * continue using the same TypeScript types from schema.ts.
 */
import { supabase } from '../lib/supabase';
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
// Helpers
// ============================================================

let cachedUserId: string | null = null;

export function clearCachedUserId() {
  cachedUserId = null;
}

export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  cachedUserId = user.id;
  return user.id;
}

function throwOnError<T>(result: { data: T | null; error: any }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// --- snake_case → camelCase mappers ---

function meaningFromRow(r: any): Meaning {
  return {
    id: r.id,
    headword: r.headword,
    pinyin: r.pinyin,
    pinyinNumeric: r.pinyin_numeric,
    partOfSpeech: r.part_of_speech,
    englishShort: r.english_short,
    englishFull: r.english_full,
    type: r.type,
    level: r.level,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function meaningToRow(m: Meaning, userId: string) {
  return {
    id: m.id,
    user_id: userId,
    headword: m.headword,
    pinyin: m.pinyin,
    pinyin_numeric: m.pinyinNumeric,
    part_of_speech: m.partOfSpeech,
    english_short: m.englishShort,
    english_full: m.englishFull,
    type: m.type,
    level: m.level,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

function meaningLinkFromRow(r: any): MeaningLink {
  return {
    id: r.id,
    parentMeaningId: r.parent_meaning_id,
    childMeaningId: r.child_meaning_id,
    position: r.position,
    role: r.role,
  };
}

function meaningLinkToRow(l: MeaningLink, userId: string) {
  return {
    id: l.id,
    user_id: userId,
    parent_meaning_id: l.parentMeaningId,
    child_meaning_id: l.childMeaningId,
    position: l.position,
    role: l.role,
  };
}

function sentenceFromRow(r: any): Sentence {
  return {
    id: r.id,
    chinese: r.chinese,
    english: r.english,
    pinyin: r.pinyin,
    pinyinSandhi: r.pinyin_sandhi,
    audioUrl: r.audio_url,
    source: r.source,
    tags: r.tags || [],
    createdAt: r.created_at,
  };
}

function sentenceToRow(s: Sentence, userId: string) {
  return {
    id: s.id,
    user_id: userId,
    chinese: s.chinese,
    english: s.english,
    pinyin: s.pinyin,
    pinyin_sandhi: s.pinyinSandhi,
    audio_url: s.audioUrl,
    source: s.source,
    tags: s.tags,
    created_at: s.createdAt,
  };
}

function tokenFromRow(r: any): SentenceToken {
  return {
    id: r.id,
    sentenceId: r.sentence_id,
    meaningId: r.meaning_id,
    position: r.position,
    surfaceForm: r.surface_form,
    pinyinSandhi: r.pinyin_sandhi,
  };
}

function tokenToRow(t: SentenceToken, userId: string) {
  return {
    id: t.id,
    user_id: userId,
    sentence_id: t.sentenceId,
    meaning_id: t.meaningId,
    position: t.position,
    surface_form: t.surfaceForm,
    pinyin_sandhi: t.pinyinSandhi,
  };
}

function srsCardFromRow(r: any): SrsCard {
  return {
    id: r.id,
    sentenceId: r.sentence_id,
    deckId: r.deck_id,
    reviewMode: r.review_mode,
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsed_days,
    scheduledDays: r.scheduled_days,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    lastReview: r.last_review,
    createdAt: r.created_at,
  };
}

function srsCardToRow(c: SrsCard, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    sentence_id: c.sentenceId,
    deck_id: c.deckId,
    review_mode: c.reviewMode,
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.lastReview,
    created_at: c.createdAt,
  };
}

function deckFromRow(r: any): Deck {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    newCardsPerDay: r.new_cards_per_day,
    reviewsPerDay: r.reviews_per_day,
    createdAt: r.created_at,
  };
}

function reviewLogFromRow(r: any): ReviewLog {
  return {
    id: r.id,
    cardId: r.card_id,
    rating: r.rating,
    state: r.state,
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsed_days,
    scheduledDays: r.scheduled_days,
    reviewedAt: r.reviewed_at,
  };
}

function reviewLogToRow(l: ReviewLog, userId: string) {
  return {
    id: l.id,
    user_id: userId,
    card_id: l.cardId,
    rating: l.rating,
    state: l.state,
    due: l.due,
    stability: l.stability,
    difficulty: l.difficulty,
    elapsed_days: l.elapsedDays,
    scheduled_days: l.scheduledDays,
    reviewed_at: l.reviewedAt,
  };
}

// ============================================================
// Meanings
// ============================================================

export async function getMeaning(id: string): Promise<Meaning | undefined> {
  const { data, error } = await supabase.from('meanings').select().eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? meaningFromRow(data) : undefined;
}

export async function getMeaningsByHeadword(headword: string): Promise<Meaning[]> {
  const data = throwOnError(
    await supabase.from('meanings').select().eq('headword', headword)
  );
  return data.map(meaningFromRow);
}

export async function getMeaningsByPinyinNumeric(pinyinNumeric: string): Promise<Meaning[]> {
  const data = throwOnError(
    await supabase.from('meanings').select().eq('pinyin_numeric', pinyinNumeric)
  );
  return data.map(meaningFromRow);
}

export async function getAllMeanings(): Promise<Meaning[]> {
  const data = throwOnError(await supabase.from('meanings').select().range(0, 9999));
  return data.map(meaningFromRow);
}

export async function getMeaningsCount(): Promise<number> {
  const { count } = await supabase.from('meanings').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

export async function insertMeaning(meaning: Meaning): Promise<void> {
  const userId = await getUserId();
  throwOnError(await supabase.from('meanings').insert(meaningToRow(meaning, userId)));
}

// ============================================================
// MeaningLinks
// ============================================================

export async function getMeaningLinksByParent(parentMeaningId: string): Promise<MeaningLink[]> {
  const data = throwOnError(
    await supabase.from('meaning_links').select().eq('parent_meaning_id', parentMeaningId).order('position')
  );
  return data.map(meaningLinkFromRow);
}

export async function getMeaningLinksByChild(childMeaningId: string): Promise<MeaningLink[]> {
  const data = throwOnError(
    await supabase.from('meaning_links').select().eq('child_meaning_id', childMeaningId)
  );
  return data.map(meaningLinkFromRow);
}

export async function getMeaningLinkCountByParent(parentMeaningId: string): Promise<number> {
  const { count } = await supabase
    .from('meaning_links')
    .select('*', { count: 'exact', head: true })
    .eq('parent_meaning_id', parentMeaningId);
  return count ?? 0;
}

export async function getAllMeaningLinks(): Promise<MeaningLink[]> {
  const data = throwOnError(await supabase.from('meaning_links').select().range(0, 9999));
  return data.map(meaningLinkFromRow);
}

export async function insertMeaningLink(link: MeaningLink): Promise<void> {
  const userId = await getUserId();
  throwOnError(await supabase.from('meaning_links').insert(meaningLinkToRow(link, userId)));
}

// ============================================================
// Sentences
// ============================================================

export async function getSentence(id: string): Promise<Sentence | undefined> {
  const { data, error } = await supabase.from('sentences').select().eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? sentenceFromRow(data) : undefined;
}

export async function getSentenceByChinese(chinese: string): Promise<Sentence | undefined> {
  const { data, error } = await supabase.from('sentences').select().eq('chinese', chinese).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? sentenceFromRow(data) : undefined;
}

export async function getSentencesBySource(source: string): Promise<Sentence[]> {
  const data = throwOnError(
    await supabase.from('sentences').select().eq('source', source)
  );
  return data.map(sentenceFromRow);
}

export async function getSentencesByTags(tags: string[]): Promise<Sentence[]> {
  const data = throwOnError(
    await supabase.from('sentences').select().overlaps('tags', tags)
  );
  return data.map(sentenceFromRow);
}

export async function getSentencesOrderByCreatedDesc(): Promise<Sentence[]> {
  const data = throwOnError(
    await supabase.from('sentences').select().order('created_at', { ascending: false })
  );
  return data.map(sentenceFromRow);
}

export async function getAllSentences(): Promise<Sentence[]> {
  const data = throwOnError(await supabase.from('sentences').select().range(0, 9999));
  return data.map(sentenceFromRow);
}

export async function getSentencesCount(): Promise<number> {
  const { count } = await supabase.from('sentences').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

export async function getSentencesByIds(ids: string[]): Promise<Sentence[]> {
  if (ids.length === 0) return [];
  const data = throwOnError(
    await supabase.from('sentences').select().in('id', ids)
  );
  return data.map(sentenceFromRow);
}

export async function insertSentence(sentence: Sentence): Promise<void> {
  const userId = await getUserId();
  throwOnError(await supabase.from('sentences').insert(sentenceToRow(sentence, userId)));
}

export async function updateSentenceTags(id: string, tags: string[]): Promise<void> {
  throwOnError(await supabase.from('sentences').update({ tags }).eq('id', id));
}

export async function deleteSentenceById(id: string): Promise<void> {
  throwOnError(await supabase.from('sentences').delete().eq('id', id));
}

export async function deleteSentencesBySource(source: string): Promise<void> {
  throwOnError(await supabase.from('sentences').delete().eq('source', source));
}

// ============================================================
// SentenceTokens
// ============================================================

export async function getTokensBySentence(sentenceId: string): Promise<SentenceToken[]> {
  const data = throwOnError(
    await supabase.from('sentence_tokens').select().eq('sentence_id', sentenceId).order('position')
  );
  return data.map(tokenFromRow);
}

export async function getTokensByMeaning(meaningId: string): Promise<SentenceToken[]> {
  const data = throwOnError(
    await supabase.from('sentence_tokens').select().eq('meaning_id', meaningId)
  );
  return data.map(tokenFromRow);
}

export async function getAllSentenceTokens(): Promise<SentenceToken[]> {
  const data = throwOnError(await supabase.from('sentence_tokens').select().range(0, 9999));
  return data.map(tokenFromRow);
}

export async function insertSentenceTokens(tokens: SentenceToken[]): Promise<void> {
  if (tokens.length === 0) return;
  const userId = await getUserId();
  throwOnError(
    await supabase.from('sentence_tokens').insert(tokens.map((t) => tokenToRow(t, userId)))
  );
}

export async function deleteTokensBySentence(sentenceId: string): Promise<void> {
  throwOnError(await supabase.from('sentence_tokens').delete().eq('sentence_id', sentenceId));
}

// ============================================================
// SrsCards
// ============================================================

export async function getSrsCard(id: string): Promise<SrsCard | undefined> {
  const { data, error } = await supabase.from('srs_cards').select().eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? srsCardFromRow(data) : undefined;
}

export async function getSrsCardsBySentence(sentenceId: string): Promise<SrsCard[]> {
  const data = throwOnError(
    await supabase.from('srs_cards').select().eq('sentence_id', sentenceId)
  );
  return data.map(srsCardFromRow);
}

export async function getSrsCardsByDeckAndState(deckId: string, state: number): Promise<SrsCard[]> {
  const data = throwOnError(
    await supabase.from('srs_cards').select().eq('deck_id', deckId).eq('state', state)
  );
  return data.map(srsCardFromRow);
}

export async function getSrsCardsByDeckAndStates(deckId: string, states: number[]): Promise<SrsCard[]> {
  const data = throwOnError(
    await supabase.from('srs_cards').select().eq('deck_id', deckId).in('state', states)
  );
  return data.map(srsCardFromRow);
}

export async function getAllSrsCards(): Promise<SrsCard[]> {
  const data = throwOnError(await supabase.from('srs_cards').select().range(0, 9999));
  return data.map(srsCardFromRow);
}

export async function insertSrsCards(cards: SrsCard[]): Promise<void> {
  if (cards.length === 0) return;
  const userId = await getUserId();
  throwOnError(
    await supabase.from('srs_cards').insert(cards.map((c) => srsCardToRow(c, userId)))
  );
}

export async function updateSrsCard(id: string, updates: Partial<SrsCard>): Promise<void> {
  const row: Record<string, any> = {};
  if (updates.due !== undefined) row.due = updates.due;
  if (updates.stability !== undefined) row.stability = updates.stability;
  if (updates.difficulty !== undefined) row.difficulty = updates.difficulty;
  if (updates.elapsedDays !== undefined) row.elapsed_days = updates.elapsedDays;
  if (updates.scheduledDays !== undefined) row.scheduled_days = updates.scheduledDays;
  if (updates.reps !== undefined) row.reps = updates.reps;
  if (updates.lapses !== undefined) row.lapses = updates.lapses;
  if (updates.state !== undefined) row.state = updates.state;
  if (updates.lastReview !== undefined) row.last_review = updates.lastReview;
  throwOnError(await supabase.from('srs_cards').update(row).eq('id', id));
}

export async function deleteSrsCardsBySentence(sentenceId: string): Promise<void> {
  throwOnError(await supabase.from('srs_cards').delete().eq('sentence_id', sentenceId));
}

// ============================================================
// Decks
// ============================================================

export async function getDeck(id: string): Promise<Deck | undefined> {
  const { data, error } = await supabase.from('decks').select().eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? deckFromRow(data) : undefined;
}

// ============================================================
// ReviewLogs
// ============================================================

export async function getReviewLogsByCardIds(cardIds: string[]): Promise<ReviewLog[]> {
  if (cardIds.length === 0) return [];
  const data = throwOnError(
    await supabase.from('review_logs').select().in('card_id', cardIds)
  );
  return data.map(reviewLogFromRow);
}

export async function getReviewLogsSince(timestamp: number): Promise<ReviewLog[]> {
  const data = throwOnError(
    await supabase.from('review_logs').select().gte('reviewed_at', timestamp)
  );
  return data.map(reviewLogFromRow);
}

export async function getAllReviewLogs(): Promise<ReviewLog[]> {
  const data = throwOnError(await supabase.from('review_logs').select().range(0, 9999));
  return data.map(reviewLogFromRow);
}

export async function insertReviewLog(log: ReviewLog): Promise<void> {
  const userId = await getUserId();
  throwOnError(await supabase.from('review_logs').insert(reviewLogToRow(log, userId)));
}

export async function deleteReviewLogsByCardIds(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  throwOnError(await supabase.from('review_logs').delete().in('card_id', cardIds));
}

// ============================================================
// Bulk delete
// ============================================================

export async function deleteAllUserData(): Promise<void> {
  // Order matters due to foreign keys: logs → cards → tokens → sentences, links → meanings
  // RLS ensures this only deletes the current user's data
  throwOnError(await supabase.from('review_logs').delete().neq('id', ''));
  throwOnError(await supabase.from('srs_cards').delete().neq('id', ''));
  throwOnError(await supabase.from('sentence_tokens').delete().neq('id', ''));
  throwOnError(await supabase.from('sentences').delete().neq('id', ''));
  throwOnError(await supabase.from('meaning_links').delete().neq('id', ''));
  throwOnError(await supabase.from('meanings').delete().neq('id', ''));
}
