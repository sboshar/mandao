// ============================================================
// Core types for the meaning-centered graph
// ============================================================

/** The atomic unit of the app. NOT a word — a specific meaning. */
export interface Meaning {
  id: string;
  /** The Chinese characters: e.g. "好" or "好吃" */
  headword: string;
  /** Pinyin with tone diacritics (base tones): e.g. "hǎo chī" */
  pinyin: string;
  /** Pinyin with tone numbers: e.g. "hao3 chi1" */
  pinyinNumeric: string;
  partOfSpeech: string;
  /** Core English meaning: e.g. "delicious" */
  englishShort: string;
  /** Extended English meaning: e.g. "delicious; tasty; good to eat" */
  englishFull: string;
  type: 'word' | 'character' | 'component';
  /** HSK level or custom difficulty 1-6, 0 = unassigned */
  level: number;
  createdAt: number;
  updatedAt: number;
  usn?: number;
}

/** Recursive link: connects a meaning to its constituent meanings. */
export interface MeaningLink {
  id: string;
  /** e.g. meaning of "好吃" */
  parentMeaningId: string;
  /** e.g. meaning of "好" (as "good") */
  childMeaningId: string;
  /** 0-indexed position in parent */
  position: number;
  role: 'character' | 'component' | 'radical';
  updatedAt?: number;
  usn?: number;
}

export interface Sentence {
  id: string;
  /** Full Chinese sentence */
  chinese: string;
  /** English translation */
  english: string;
  /** Full pinyin with base tones */
  pinyin: string;
  /** Full pinyin with tone sandhi applied */
  pinyinSandhi: string;
  audioUrl: string | null;
  /** e.g. "manual", "textbook-ch3" */
  source: string;
  /** User-defined tags, e.g. "restaurant", "travel" */
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  usn?: number;
}

/** Junction table: links sentences to meanings, preserving token order. */
export interface SentenceToken {
  id: string;
  sentenceId: string;
  meaningId: string;
  /** 0-indexed token position in sentence */
  position: number;
  /** Exact characters as they appear in the sentence */
  surfaceForm: string;
  /** Tone-sandhi pinyin for this token in context */
  pinyinSandhi: string;
  updatedAt?: number;
  usn?: number;
}

// ============================================================
// Card face configuration
// ============================================================

export interface CardFace {
  showEnglish: boolean;
  showCharacters: boolean;
  showPinyin: boolean;
  showPinyinSandhi: boolean;
  showAudio: boolean;
}

export type ReviewMode = 'en-to-zh' | 'zh-to-en' | 'py-to-en-zh';

// ============================================================
// SRS types
// ============================================================

/** SRS card — always sentence-level */
export interface SrsCard {
  id: string;
  sentenceId: string;
  deckId: string;
  reviewMode: ReviewMode;
  /** Next review timestamp (ms) */
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  /** 0=new, 1=learning, 2=review, 3=relearning */
  state: number;
  lastReview: number | null;
  lastAnsweredAt?: number | null;
  createdAt: number;
  updatedAt?: number;
  usn?: number;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  newCardsPerDay: number;
  reviewsPerDay: number;
  createdAt: number;
  updatedAt?: number;
  usn?: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  /** 1=again, 2=hard, 3=good, 4=easy */
  rating: 1 | 2 | 3 | 4;
  /** Card state at time of review */
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewedAt: number;
  opId?: string;
  deviceId?: string;
  updatedAt?: number;
  usn?: number;
}

// ============================================================
// Default card face configs for the two review modes
// ============================================================

export const DEFAULT_EN_TO_ZH_FRONT: CardFace = {
  showEnglish: true,
  showCharacters: false,
  showPinyin: false,
  showPinyinSandhi: false,
  showAudio: false,
};

export const DEFAULT_EN_TO_ZH_BACK: CardFace = {
  showEnglish: true,
  showCharacters: true,
  showPinyin: true,
  showPinyinSandhi: true,
  showAudio: true,
};

export const DEFAULT_ZH_TO_EN_FRONT: CardFace = {
  showEnglish: false,
  showCharacters: true,
  showPinyin: false,
  showPinyinSandhi: false,
  showAudio: false,
};

export const DEFAULT_ZH_TO_EN_BACK: CardFace = {
  showEnglish: true,
  showCharacters: true,
  showPinyin: true,
  showPinyinSandhi: true,
  showAudio: true,
};
