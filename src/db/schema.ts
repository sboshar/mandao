// ============================================================
// Core types for the meaning-centered graph
// ============================================================

/** The atomic unit of the app. NOT a word — a specific meaning. */
export interface Meaning {
  id: string;
  /** The Chinese characters: e.g. "好" or "好吃" */
  headword: string;
  /**
   * Pinyin with tone numbers — the canonical form.
   * Example: "hao3 chi1". Derive the diacritic display via
   * getMeaningPinyin() / numericStringToDiacritic().
   */
  pinyinNumeric: string;
  partOfSpeech: string;
  /** Core English meaning: e.g. "delicious" */
  englishShort: string;
  /** Extended English meaning: e.g. "delicious; tasty; good to eat" */
  englishFull: string;
  type: 'word' | 'character' | 'component';
  /** HSK level or custom difficulty 1-6, 0 = unassigned */
  level: number;
  /**
   * True when the headword is a phonetic loanword (e.g. 汉堡 = hamburger).
   * The characters approximate a foreign word's sound; their literal meanings
   * do not compose into the headword's meaning. Only meaningful on type='word'.
   */
  isTransliteration?: boolean;
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

// ============================================================
// Usage context — what kind of sentence this is (#212)
// ============================================================

/**
 * How formal the sentence is.
 *
 * Register in Chinese is largely a fact about the RELATIONSHIP between speakers,
 * not about vocabulary difficulty, which is why it is worth stating separately
 * from anything on the word cards.
 */
export type SentenceRegister = 'formal' | 'neutral' | 'casual' | 'slang' | 'literary';

/** Whether you would say this, read it, or both. */
export type SentenceMedium = 'spoken' | 'written' | 'both';

/** Runtime lists for validating a model's answer and for rendering labels. */
export const SENTENCE_REGISTERS: readonly SentenceRegister[] = [
  'formal', 'neutral', 'casual', 'slang', 'literary',
] as const;

export const SENTENCE_MEDIUMS: readonly SentenceMedium[] = [
  'spoken', 'written', 'both',
] as const;

/**
 * One situation the sentence belongs to, with a Mandarin line from it.
 *
 * The English says WHEN; the Mandarin is what that moment actually sounds like,
 * and is a sentence in its own right — either the line that prompts the one
 * being studied (周末怎么样？ before 还行) or a fuller reply that carries it. It is
 * offered for adding to the deck, so it has to stand alone as a card: a
 * situation described only in English can be read, but it cannot be studied.
 *
 * `chinese` and `english` are optional because notes written before they
 * existed have only the English situation, and because one missing pair should
 * not cost the learner the other three situations.
 */
export interface UsageSituation {
  /** The situation, in English: "A friend asks how your weekend was." */
  situation: string;
  /** A natural Mandarin line from that situation, characters only. */
  chinese?: string;
  /** Natural English translation of `chinese` — not a restatement of the situation. */
  english?: string;
}

/**
 * When and where you would use or meet a sentence — English prose about USAGE,
 * never a second translation (#212).
 *
 * A sentence card teaches what the sentence means and how to say it, and says
 * nothing about whether you could say it to your boss, whether anyone says it
 * at all, or what situation it belongs to. That is the part a learner cannot
 * recover from the characters, and the part a textbook example most often gets
 * wrong.
 *
 * Structured rather than one prose blob so the parts that are categorical stay
 * categorical: `register` and `medium` render as labels and could later be
 * filtered or sorted on, while `description` and `situations` carry the things
 * only prose can say. A free-text answer would have buried "you would not say
 * this to a stranger" in paragraph three.
 *
 * A note is a SNAPSHOT of one model's answer at one time, so `generatedAt` and
 * `model` are stored with it — a description written by a cheap model months ago
 * should be identifiable as such, not silently trusted as fact about Mandarin.
 */
export interface SentenceUsage {
  register: SentenceRegister;
  medium: SentenceMedium;
  /** What the sentence DOES: "declining an invitation", "asking a price". */
  speechAct: string;
  /** Two to four sentences on how and when you would use or see this. */
  description: string;
  /**
   * Concrete situations where it fits — a conversation, not a category. Read
   * these through readSituations(), which also copes with the legacy
   * English-only string form.
   */
  situations: UsageSituation[];
  /** Where it would land wrong: who not to say it to, what it implies. */
  caution?: string;
  generatedAt: number;
  /** Model id that produced it, when known. */
  model?: string;
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
  /**
   * Lowercase Hanzi + alphanumerics of `chinese`, with punctuation/whitespace
   * stripped. Indexed locally for instant dedup lookup pre-LLM. Local-only —
   * not sent to Supabase; backfilled on Dexie upgrade and when pulling rows.
   */
  normalizedChinese?: string;
  /** User-defined tags, e.g. "restaurant", "travel" */
  tags: string[];
  /**
   * LLM-written notes on when this sentence is used (#212). Absent until
   * generated — every sentence added before the feature existed, and every one
   * added on a device with no API key, has none.
   */
  usage?: SentenceUsage;
  createdAt: number;
  updatedAt?: number;
  usn?: number;
}

/**
 * User- or voice-captured audio clip attached to a sentence.
 * Multiple recordings per sentence are supported; each has a user-given name.
 *
 * The metadata row syncs with the server; the actual bytes live in the
 * `audioBlobs` table (client-only cache, see AudioBlob below).
 * Invariant: at least one of an audioBlobs entry or `storagePath` exists.
 *   - Locally-created (pre-upload): audioBlobs entry, no storagePath.
 *   - Pulled from server (pre-play): storagePath, no audioBlobs entry.
 *   - After first play / prefetch on a pulled row: both.
 */
export interface AudioRecording {
  id: string;
  sentenceId: string;
  /** User-facing label, e.g. "My voice", "Native speaker". */
  name: string;
  /** Path inside the `audio-recordings` Storage bucket, e.g. `{user_id}/{id}.webm`. */
  storagePath?: string;
  mimeType: string;
  durationMs?: number;
  /** Where this recording came from. */
  source: 'voice-input' | 'manual';
  createdAt: number;
  updatedAt?: number;
  usn?: number;
}

/**
 * Client-only cache entry for an AudioRecording's bytes. Keyed by
 * recordingId. Never synced. Bytes are stored as ArrayBuffer (not Blob)
 * because iOS WebKit evicts Blob bodies independently from their IDB
 * record under storage pressure; ArrayBuffers live inside the record
 * itself. Reconstruct the Blob from `data` + `mimeType` at playback time.
 */
export interface AudioBlob {
  recordingId: string;
  data: ArrayBuffer;
  mimeType: string;
  sizeBytes: number;
  /** When the blob first landed in the cache (createdAt for local clips, fetch time for pulled ones). */
  fetchedAt: number;
  /** Updated on each play; tiebreaks LRU eviction. Initialized to fetchedAt. */
  lastPlayedAt: number;
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

export type ReviewMode = 'en-to-zh' | 'zh-to-en' | 'py-to-en-zh' | 'listen-type' | 'speak';

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

/** FSRS scheduling parameters. Stored as a partial so missing keys fall
 *  back to client-side defaults — that's how the column starts (`{}`) for
 *  new users, and how unknown future keys land on older clients. */
export interface FSRSSettings {
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningSteps: string[];
  relearningSteps: string[];
  /**
   * If true, new cards are limited only by newCardsPerDay (independent of
   * reviewsPerDay). If false (Anki default), new cards also count against
   * reviewsPerDay — once the review bucket fills, no new cards are shown
   * even if newCardsPerDay still has room.
   */
  newCardsIgnoreReviewLimit: boolean;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  newCardsPerDay: number;
  reviewsPerDay: number;
  fsrsSettings?: Partial<FSRSSettings>;
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

export type MeaningFlagKind =
  | 'cedict-disagreement'
  | 'cedict-unknown'
  | 'segmentation-disagreement'
  | 'user-report';

export type MeaningFlagResolution = 'confirmed' | 'corrected' | 'dismissed';

export interface MeaningFlag {
  id: string;
  /** Optional: may be null if the flag was created before the meaning was persisted. */
  meaningId: string | null;
  headword: string;
  /** Pinyin that ended up stored on the Meaning at flag creation time. */
  storedPinyin: string;
  /** Pinyin the LLM originally emitted (before any override). */
  llmValue?: string;
  flagKind: MeaningFlagKind;
  /** CEDICT readings at the time of flag creation — snapshot for audit. */
  cedictSuggestions: string[];
  createdAt: number;
  resolvedAt?: number | null;
  resolution?: MeaningFlagResolution | null;
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
