/**
 * Shared snake_case → camelCase row mappers for Supabase/Postgres rows.
 * Used by both remoteRepo and syncEngine to avoid duplication.
 */
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
import { normalizeChinese } from './localRepo';

export function meaningFromRow(r: any): Meaning {
  return {
    id: r.id, headword: r.headword,
    pinyinNumeric: r.pinyin_numeric, partOfSpeech: r.part_of_speech,
    englishShort: r.english_short, englishFull: r.english_full,
    type: r.type, level: r.level,
    isTransliteration: r.is_transliteration ?? false,
    createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
    usn: r.usn,
  };
}

export function meaningLinkFromRow(r: any): MeaningLink {
  return {
    id: r.id, parentMeaningId: r.parent_meaning_id,
    childMeaningId: r.child_meaning_id, position: r.position, role: r.role,
    usn: r.usn,
  };
}

export function sentenceFromRow(r: any): Sentence {
  const chinese: string = r.chinese ?? '';
  return {
    id: r.id, chinese, english: r.english,
    pinyin: r.pinyin, pinyinSandhi: r.pinyin_sandhi,
    audioUrl: r.audio_url, source: r.source,
    tags: r.tags || [], createdAt: r.created_at,
    usn: r.usn,
    normalizedChinese: normalizeChinese(chinese),
  };
}

export function tokenFromRow(r: any): SentenceToken {
  return {
    id: r.id, sentenceId: r.sentence_id, meaningId: r.meaning_id,
    position: r.position, surfaceForm: r.surface_form,
    pinyinSandhi: r.pinyin_sandhi,
    usn: r.usn,
  };
}

export function srsCardFromRow(r: any): SrsCard {
  return {
    id: r.id, sentenceId: r.sentence_id, deckId: r.deck_id,
    reviewMode: r.review_mode, due: r.due,
    stability: r.stability, difficulty: r.difficulty,
    elapsedDays: r.elapsed_days, scheduledDays: r.scheduled_days,
    reps: r.reps, lapses: r.lapses, state: r.state,
    lastReview: r.last_review, createdAt: r.created_at,
    usn: r.usn,
  };
}

export function deckFromRow(r: any): Deck {
  return {
    id: r.id, name: r.name, description: r.description,
    newCardsPerDay: r.new_cards_per_day, reviewsPerDay: r.reviews_per_day,
    createdAt: r.created_at,
    usn: r.usn,
  };
}

export function reviewLogFromRow(r: any): ReviewLog {
  return {
    id: r.id, cardId: r.card_id, rating: r.rating,
    state: r.state, due: r.due,
    stability: r.stability, difficulty: r.difficulty,
    elapsedDays: r.elapsed_days, scheduledDays: r.scheduled_days,
    reviewedAt: r.reviewed_at,
    usn: r.usn,
  };
}

/**
 * Blob intentionally omitted — the wire-format row has no blob, only a path.
 * Consumers lazy-fetch the blob via Storage signed URLs on first play.
 */
export function audioRecordingFromRow(r: any): AudioRecording {
  return {
    id: r.id,
    sentenceId: r.sentence_id,
    name: r.name,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    durationMs: r.duration_ms ?? undefined,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    usn: r.usn,
  };
}

export function audioRecordingToRow(
  rec: {
    id: string;
    sentenceId: string;
    name: string;
    mimeType: string;
    durationMs?: number | null;
    source: 'voice-input' | 'manual';
    createdAt: number;
  },
  userId: string,
  storagePath: string,
) {
  return {
    id: rec.id,
    user_id: userId,
    sentence_id: rec.sentenceId,
    name: rec.name,
    storage_path: storagePath,
    mime_type: rec.mimeType,
    duration_ms: rec.durationMs ?? null,
    source: rec.source,
    created_at: rec.createdAt,
  };
}

/** Extract the highest USN from an array of raw Supabase rows. */
export function maxUsnFromRows(rows: any[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.usn > max) max = r.usn;
  }
  return max;
}
