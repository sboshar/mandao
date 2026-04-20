import { describe, it, expect } from 'vitest';
import {
  meaningFromRow,
  meaningLinkFromRow,
  sentenceFromRow,
  tokenFromRow,
  srsCardFromRow,
  deckFromRow,
  reviewLogFromRow,
  maxUsnFromRows,
} from './mappers';

describe('meaningFromRow', () => {
  it('maps snake_case to camelCase', () => {
    const row = {
      id: 'm1', headword: '好', pinyin_numeric: 'hao3',
      part_of_speech: 'adj', english_short: 'good', english_full: 'good; well',
      type: 'word', level: 1, created_at: 1000, updated_at: 2000, usn: 5,
    };
    const result = meaningFromRow(row);
    expect(result.pinyinNumeric).toBe('hao3');
    // Diacritic field was dropped — never mapped even when legacy rows include it.
    expect(result).not.toHaveProperty('pinyin');
    expect(result.partOfSpeech).toBe('adj');
    expect(result.englishShort).toBe('good');
    expect(result.englishFull).toBe('good; well');
    expect(result.updatedAt).toBe(2000);
    expect(result.usn).toBe(5);
  });

  it('falls back updatedAt to created_at when updated_at is null', () => {
    const row = {
      id: 'm1', headword: '好', pinyin_numeric: 'hao3',
      part_of_speech: 'adj', english_short: 'good', english_full: 'good; well',
      type: 'word', level: 1, created_at: 1000, updated_at: null, usn: 0,
    };
    expect(meaningFromRow(row).updatedAt).toBe(1000);
  });

  it('picks up is_transliteration and defaults missing column to false', () => {
    const base = {
      id: 'm1', headword: '汉堡', pinyin_numeric: 'han4 bao3',
      part_of_speech: 'noun', english_short: 'hamburger', english_full: 'hamburger',
      type: 'word', level: 0, created_at: 1000, updated_at: 1000, usn: 1,
    };
    expect(meaningFromRow({ ...base, is_transliteration: true }).isTransliteration).toBe(true);
    // Old rows from before the migration had no column; mapper must default to false
    // so the UI never shows a false-positive "Phonetic loanword" badge.
    expect(meaningFromRow(base).isTransliteration).toBe(false);
  });
});

describe('meaningLinkFromRow', () => {
  it('maps FK fields correctly', () => {
    const row = {
      id: 'ml1', parent_meaning_id: 'p1', child_meaning_id: 'c1',
      position: 0, role: 'character', usn: 3,
    };
    const result = meaningLinkFromRow(row);
    expect(result.parentMeaningId).toBe('p1');
    expect(result.childMeaningId).toBe('c1');
    expect(result.usn).toBe(3);
  });
});

describe('sentenceFromRow', () => {
  it('maps snake_case and defaults tags to empty array', () => {
    const row = {
      id: 's1', chinese: '你好', english: 'Hello', pinyin: 'nǐ hǎo',
      pinyin_sandhi: 'ní hǎo', audio_url: null, source: 'manual',
      tags: null, created_at: 1000, usn: 7,
    };
    const result = sentenceFromRow(row);
    expect(result.pinyinSandhi).toBe('ní hǎo');
    expect(result.audioUrl).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.usn).toBe(7);
  });

  it('preserves existing tags array', () => {
    const row = {
      id: 's1', chinese: '你好', english: 'Hello', pinyin: 'nǐ hǎo',
      pinyin_sandhi: 'ní hǎo', audio_url: null, source: 'manual',
      tags: ['travel', 'greetings'], created_at: 1000, usn: 0,
    };
    expect(sentenceFromRow(row).tags).toEqual(['travel', 'greetings']);
  });
});

describe('tokenFromRow', () => {
  it('maps junction table fields', () => {
    const row = {
      id: 't1', sentence_id: 's1', meaning_id: 'm1',
      position: 0, surface_form: '你', pinyin_sandhi: 'ní', usn: 2,
    };
    const result = tokenFromRow(row);
    expect(result.sentenceId).toBe('s1');
    expect(result.meaningId).toBe('m1');
    expect(result.surfaceForm).toBe('你');
    expect(result.pinyinSandhi).toBe('ní');
  });
});

describe('srsCardFromRow', () => {
  it('maps all SRS fields', () => {
    const row = {
      id: 'c1', sentence_id: 's1', deck_id: 'd1', review_mode: 'en-to-zh',
      due: 5000, stability: 1.5, difficulty: 5.0,
      elapsed_days: 0, scheduled_days: 1,
      reps: 0, lapses: 0, state: 0,
      last_review: null, created_at: 1000, usn: 10,
    };
    const result = srsCardFromRow(row);
    expect(result.sentenceId).toBe('s1');
    expect(result.deckId).toBe('d1');
    expect(result.reviewMode).toBe('en-to-zh');
    expect(result.lastReview).toBeNull();
    expect(result.usn).toBe(10);
  });
});

describe('deckFromRow', () => {
  it('maps deck fields', () => {
    const row = {
      id: 'd1', name: 'Default', description: 'Main deck',
      new_cards_per_day: 20, reviews_per_day: 200, created_at: 1000, usn: 1,
    };
    const result = deckFromRow(row);
    expect(result.newCardsPerDay).toBe(20);
    expect(result.reviewsPerDay).toBe(200);
    expect(result.usn).toBe(1);
  });
});

describe('reviewLogFromRow', () => {
  it('maps review log fields', () => {
    const row = {
      id: 'rl1', card_id: 'c1', rating: 3, state: 2, due: 5000,
      stability: 10.0, difficulty: 4.5, elapsed_days: 5, scheduled_days: 10,
      reviewed_at: 3000, usn: 15,
    };
    const result = reviewLogFromRow(row);
    expect(result.cardId).toBe('c1');
    expect(result.rating).toBe(3);
    expect(result.reviewedAt).toBe(3000);
    expect(result.usn).toBe(15);
  });
});

describe('maxUsnFromRows', () => {
  it('returns 0 for empty array', () => {
    expect(maxUsnFromRows([])).toBe(0);
  });

  it('extracts max USN from rows', () => {
    const rows = [{ usn: 5 }, { usn: 12 }, { usn: 3 }];
    expect(maxUsnFromRows(rows)).toBe(12);
  });

  it('handles rows with undefined usn', () => {
    const rows = [{ usn: 5 }, { name: 'no usn' }, { usn: 3 }];
    expect(maxUsnFromRows(rows)).toBe(5);
  });

  it('handles single row', () => {
    expect(maxUsnFromRows([{ usn: 42 }])).toBe(42);
  });
});
