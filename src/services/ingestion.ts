/**
 * Sentence ingestion service.
 * Handles adding new sentences to the closed system:
 * - Creates/finds Meaning records for each token
 * - Decomposes multi-character words into character meanings (using LLM data)
 * - Creates MeaningLinks for the recursive graph
 * - Creates SrsCards for review
 */
import { v4 as uuid } from 'uuid';
import * as repo from '../db/repo';
import { enqueueSync } from '../db/repo';
import * as local from '../db/localRepo';
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  ReviewMode,
} from '../db/schema';
import { applyToneSandhi, numericStringToDiacritic } from './toneSandhi';

/**
 * Accumulator for tracking newly created entities during ingestion,
 * so we can bundle them into one sync op.
 */
interface IngestAccumulator {
  meanings: Meaning[];
  meaningLinks: MeaningLink[];
  /** All meanings referenced by this ingestion (new + reused), for the sync bundle */
  allMeanings: Map<string, Meaning>;
}

// ============================================================
// Types for the ingestion input
// ============================================================

export interface CharacterInput {
  char: string;
  pinyinNumeric: string;
  pinyinSandhi?: string;
  english: string;
}

export interface TokenInput {
  surfaceForm: string;
  pinyinNumeric: string;
  english: string;
  partOfSpeech: string;
  /** Per-character breakdowns from the LLM */
  characters?: CharacterInput[];
}

export interface SentenceInput {
  chinese: string;
  english: string;
  tokens: TokenInput[];
  source?: string;
  tags?: string[];
}

// ============================================================
// Core ingestion function
// ============================================================

export async function ingestSentence(input: SentenceInput): Promise<string> {
  const sentenceId = uuid();

  const existing = await repo.getSentenceByChinese(input.chinese.trim());
  if (existing) {
    throw new Error(`This sentence already exists in the app.`);
  }

  const acc: IngestAccumulator = { meanings: [], meaningLinks: [], allMeanings: new Map() };
  const tokenRecords: SentenceToken[] = [];
  const allPinyinNumeric: string[] = [];

  for (let i = 0; i < input.tokens.length; i++) {
    const token = input.tokens[i];
    const meaning = await findOrCreateMeaning(token, acc);
    const syllables = token.pinyinNumeric.split(/\s+/);
    allPinyinNumeric.push(...syllables);

    if (token.surfaceForm.length > 1 && meaning.type === 'word') {
      await decomposeWord(meaning, token, acc);
    }

    tokenRecords.push({
      id: uuid(),
      sentenceId,
      meaningId: meaning.id,
      position: i,
      surfaceForm: token.surfaceForm,
      pinyinSandhi: '',
    });
  }

  const sandhiSyllables = applyToneSandhi(allPinyinNumeric);
  const basePinyin = numericStringToDiacritic(allPinyinNumeric.join(' '));
  const sandhiPinyin = numericStringToDiacritic(sandhiSyllables.join(' '));

  let syllableIdx = 0;
  for (const tokenRec of tokenRecords) {
    const token = input.tokens[tokenRecords.indexOf(tokenRec)];
    const count = token.pinyinNumeric.split(/\s+/).length;
    const tokenSandhiSyllables = sandhiSyllables.slice(
      syllableIdx,
      syllableIdx + count
    );
    tokenRec.pinyinSandhi = numericStringToDiacritic(
      tokenSandhiSyllables.join(' ')
    );
    syllableIdx += count;
  }

  const sentence: Sentence = {
    id: sentenceId,
    chinese: input.chinese,
    english: input.english,
    pinyin: basePinyin,
    pinyinSandhi: sandhiPinyin,
    audioUrl: null,
    source: input.source || 'manual',
    tags: input.tags || [],
    createdAt: Date.now(),
  };

  let sentenceInserted = false;
  try {
    await repo.insertSentence(sentence);
    sentenceInserted = true;
    await repo.insertSentenceTokens(tokenRecords);

    const deckId = await repo.ensureDefaultDeck();
    const modes: ReviewMode[] = ['en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type'];
    const cards: SrsCard[] = modes.map((mode) => ({
      id: uuid(),
      sentenceId,
      deckId,
      reviewMode: mode,
      due: Date.now(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
      createdAt: Date.now(),
    }));

    await repo.insertSrsCards(cards);

    // Enqueue a single ingestBundle sync op for atomic server-side write
    await enqueueSync({
      op: 'ingestBundle',
      payload: buildIngestPayload(acc, sentence, tokenRecords, cards),
    });

    return sentenceId;
  } catch (error) {
    // Roll back local Dexie only — no server delete op since
    // the ingestBundle was never enqueued (we failed before that).
    try {
      if (sentenceInserted) {
        await local.deleteSentenceById(sentenceId);
      }
      // Clean up newly-created meanings and meaning links from the accumulator.
      // These are only the entities created during *this* ingestion, not reused ones.
      const newMeaningIds = acc.meanings.map((m) => m.id);
      const newLinkIds = acc.meaningLinks.map((l) => l.id);
      await local.deleteMeaningLinksByIds(newLinkIds);
      await local.deleteMeaningsByIds(newMeaningIds);
    } catch (cleanupError) {
      console.error('Failed to roll back partial ingestion', cleanupError);
    }
    throw error;
  }
}

function buildIngestPayload(
  acc: IngestAccumulator,
  sentence: Sentence,
  tokens: SentenceToken[],
  cards: SrsCard[],
) {
  return {
    meanings: Array.from(acc.allMeanings.values()).map((m) => ({
      id: m.id, headword: m.headword, pinyin: m.pinyin,
      pinyin_numeric: m.pinyinNumeric, part_of_speech: m.partOfSpeech,
      english_short: m.englishShort, english_full: m.englishFull,
      type: m.type, level: m.level,
      created_at: m.createdAt, updated_at: m.updatedAt,
    })),
    meaning_links: acc.meaningLinks.map((l) => ({
      id: l.id, parent_meaning_id: l.parentMeaningId,
      child_meaning_id: l.childMeaningId, position: l.position, role: l.role,
    })),
    sentence: {
      id: sentence.id, chinese: sentence.chinese, english: sentence.english,
      pinyin: sentence.pinyin, pinyin_sandhi: sentence.pinyinSandhi,
      audio_url: sentence.audioUrl, source: sentence.source,
      tags: sentence.tags, created_at: sentence.createdAt,
    },
    tokens: tokens.map((t) => ({
      id: t.id, sentence_id: t.sentenceId, meaning_id: t.meaningId,
      position: t.position, surface_form: t.surfaceForm,
      pinyin_sandhi: t.pinyinSandhi,
    })),
    cards: cards.map((c) => ({
      id: c.id, sentence_id: c.sentenceId, deck_id: c.deckId,
      review_mode: c.reviewMode, due: c.due,
      stability: c.stability, difficulty: c.difficulty,
      elapsed_days: c.elapsedDays, scheduled_days: c.scheduledDays,
      reps: c.reps, lapses: c.lapses, state: c.state,
      last_review: c.lastReview, created_at: c.createdAt,
    })),
  };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Find an existing meaning that matches (headword + pinyinNumeric + englishShort),
 * or create a new one. This is how we deduplicate:
 * - Same char, same pronunciation, same meaning → reuse
 * - Same char, different pronunciation or meaning → new node
 */
async function findOrCreateMeaning(token: TokenInput, acc: IngestAccumulator): Promise<Meaning> {
  const candidates = await repo.getMeaningsByHeadword(token.surfaceForm);
  const existing = candidates.find(
    (m) =>
      m.pinyinNumeric === token.pinyinNumeric &&
      m.englishShort === token.english
  );

  if (existing) {
    acc.allMeanings.set(existing.id, existing);
    return existing;
  }

  const isCharacter = token.surfaceForm.length === 1;
  const meaning: Meaning = {
    id: uuid(),
    headword: token.surfaceForm,
    pinyin: numericStringToDiacritic(token.pinyinNumeric),
    pinyinNumeric: token.pinyinNumeric,
    partOfSpeech: token.partOfSpeech,
    englishShort: token.english,
    englishFull: token.english,
    type: isCharacter ? 'character' : 'word',
    level: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.insertMeaning(meaning);
  acc.meanings.push(meaning);
  acc.allMeanings.set(meaning.id, meaning);
  return meaning;
}

/**
 * Find or create a character-level meaning.
 * Same dedup logic as findOrCreateMeaning but for characters specifically.
 */
async function findOrCreateCharacterMeaning(
  char: string,
  pinyinNumeric: string,
  english: string,
  acc: IngestAccumulator,
): Promise<Meaning> {
  const candidates = await repo.getMeaningsByHeadword(char);
  const exact = candidates.find(
    (m) =>
      m.type === 'character' &&
      m.pinyinNumeric === pinyinNumeric &&
      m.englishShort === english
  );

  if (exact) {
    acc.allMeanings.set(exact.id, exact);
    return exact;
  }

  const meaning: Meaning = {
    id: uuid(),
    headword: char,
    pinyin: numericStringToDiacritic(pinyinNumeric),
    pinyinNumeric: pinyinNumeric,
    partOfSpeech: '',
    englishShort: english,
    englishFull: english,
    type: 'character',
    level: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.insertMeaning(meaning);
  acc.meanings.push(meaning);
  acc.allMeanings.set(meaning.id, meaning);
  return meaning;
}

/**
 * Decompose a multi-character word into its character meanings.
 * Uses LLM-provided character data when available.
 */
async function decomposeWord(
  wordMeaning: Meaning,
  token: TokenInput,
  acc: IngestAccumulator,
): Promise<void> {
  const existingCount = await repo.getMeaningLinkCountByParent(wordMeaning.id);
  if (existingCount > 0) return;

  const chars = Array.from(token.surfaceForm);
  const syllables = wordMeaning.pinyinNumeric.split(/\s+/);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const llmChar = token.characters?.find((c) => c.char === char)
      || token.characters?.[i];

    const charPinyinNumeric = llmChar?.pinyinNumeric || syllables[i] || '';
    const charEnglish = llmChar?.english || `(component of ${wordMeaning.headword})`;

    const charMeaning = await findOrCreateCharacterMeaning(
      char,
      charPinyinNumeric,
      charEnglish,
      acc,
    );

    const link: MeaningLink = {
      id: uuid(),
      parentMeaningId: wordMeaning.id,
      childMeaningId: charMeaning.id,
      position: i,
      role: 'character',
    };
    await repo.insertMeaningLink(link);
    acc.meaningLinks.push(link);
  }
}

// ============================================================
// Deletion
// ============================================================

/** Delete a single sentence and its tokens, SRS cards, and review logs. */
export async function deleteSentence(sentenceId: string): Promise<void> {
  // Sentence deletion cascades to tokens, SRS cards, and review logs.
  await repo.deleteSentenceById(sentenceId);
}

/** Delete ALL sentences, tokens, SRS cards, and review logs. */
export async function deleteAllData(): Promise<void> {
  await repo.deleteAllUserData();
}

// ============================================================
// Query helpers used by UI
// ============================================================

/**
 * Get all sentences that contain a given meaning.
 * Also includes sentences where this meaning appears as a character
 * inside a compound word (via MeaningLink).
 */
export async function getSentencesForMeaning(
  meaningId: string
): Promise<Sentence[]> {
  // Direct: this meaning is a token in the sentence
  const directTokens = await repo.getTokensByMeaning(meaningId);
  const sentenceIds = new Set(directTokens.map((t) => t.sentenceId));

  // Indirect: this meaning is a character inside a compound word token
  const parentLinks = await repo.getMeaningLinksByChild(meaningId);

  for (const link of parentLinks) {
    const parentTokens = await repo.getTokensByMeaning(link.parentMeaningId);
    for (const t of parentTokens) {
      sentenceIds.add(t.sentenceId);
    }
  }

  return repo.getSentencesByIds([...sentenceIds]);
}

/** Get all meanings that share the same headword (for "other meanings" section) */
export async function getOtherMeanings(meaning: Meaning): Promise<Meaning[]> {
  const all = await repo.getMeaningsByHeadword(meaning.headword);
  return all.filter((m) => m.id !== meaning.id);
}

/** Get character breakdown for a meaning */
export async function getCharacterBreakdown(
  meaningId: string
): Promise<(MeaningLink & { childMeaning: Meaning })[]> {
  const links = await repo.getMeaningLinksByParent(meaningId);
  const meanings = await repo.getMeaningsByIds(links.map((link) => link.childMeaningId));
  const meaningsById = new Map(meanings.map((meaning) => [meaning.id, meaning]));

  return links.flatMap((link) => {
    const childMeaning = meaningsById.get(link.childMeaningId);
    return childMeaning ? [{ ...link, childMeaning }] : [];
  });
}

/** Get tokens for a sentence, ordered by position */
export async function getTokensForSentence(
  sentenceId: string
): Promise<(SentenceToken & { meaning: Meaning })[]> {
  const tokens = await repo.getTokensBySentence(sentenceId);
  const meanings = await repo.getMeaningsByIds(tokens.map((token) => token.meaningId));
  const meaningsById = new Map(meanings.map((meaning) => [meaning.id, meaning]));

  return tokens.flatMap((token) => {
    const meaning = meaningsById.get(token.meaningId);
    return meaning ? [{ ...token, meaning }] : [];
  });
}

/** Get all unique tags across all sentences */
export async function getAllTags(): Promise<string[]> {
  const sentences = await repo.getAllSentences();
  const tagSet = new Set<string>();
  for (const s of sentences) {
    if (s.tags) {
      for (const t of s.tags) tagSet.add(t);
    }
  }
  return [...tagSet].sort();
}

/** Update tags on a sentence */
export { updateSentenceTags } from '../db/repo';

/** Delete all tutorial sentences and their associated tokens and SRS cards */
export async function deleteTutorialSentences(): Promise<void> {
  // Sentence deletion cascades to tokens, SRS cards, and review logs.
  await repo.deleteSentencesBySource('tutorial');
}

/** Get all meanings that share the same pinyin (for pinyin card) */
export async function getMeaningsByPinyin(
  pinyinNumeric: string
): Promise<Meaning[]> {
  return repo.getMeaningsByPinyinNumeric(pinyinNumeric);
}
