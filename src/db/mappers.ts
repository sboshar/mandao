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
} from './schema';

export function meaningFromRow(r: any): Meaning {
  return {
    id: r.id, headword: r.headword, pinyin: r.pinyin,
    pinyinNumeric: r.pinyin_numeric, partOfSpeech: r.part_of_speech,
    englishShort: r.english_short, englishFull: r.english_full,
    type: r.type, level: r.level,
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
    normalizedChinese: normalizeForIndex(chinese),
  };
}

function normalizeForIndex(s: string): string {
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

/** Extract the highest USN from an array of raw Supabase rows. */
export function maxUsnFromRows(rows: any[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.usn > max) max = r.usn;
  }
  return max;
}
