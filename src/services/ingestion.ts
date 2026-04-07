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
import type {
  Meaning,
  MeaningLink,
  Sentence,
  SentenceToken,
  SrsCard,
  ReviewMode,
} from '../db/schema';
import { applyToneSandhi, numericStringToDiacritic } from './toneSandhi';

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

  // Check for duplicate sentence
  const existing = await repo.getSentenceByChinese(input.chinese.trim());
  if (existing) {
    throw new Error(`This sentence already exists in the app.`);
  }

  const tokenRecords: SentenceToken[] = [];
  const allPinyinNumeric: string[] = [];

  for (let i = 0; i < input.tokens.length; i++) {
    const token = input.tokens[i];

    // Find or create the meaning for this token
    const meaning = await findOrCreateMeaning(token);

    // Collect pinyin syllables for tone sandhi
    const syllables = token.pinyinNumeric.split(/\s+/);
    allPinyinNumeric.push(...syllables);

    // If multi-character word, decompose into character meanings
    if (token.surfaceForm.length > 1 && meaning.type === 'word') {
      await decomposeWord(meaning, token);
    }

    tokenRecords.push({
      id: uuid(),
      sentenceId,
      meaningId: meaning.id,
      position: i,
      surfaceForm: token.surfaceForm,
      pinyinSandhi: '', // filled in below
    });
  }

  // Compute tone sandhi for the full sentence
  const sandhiSyllables = applyToneSandhi(allPinyinNumeric);
  const basePinyin = numericStringToDiacritic(allPinyinNumeric.join(' '));
  const sandhiPinyin = numericStringToDiacritic(sandhiSyllables.join(' '));

  // Assign sandhi pinyin per token
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

  // Create the sentence
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

  await repo.insertSentence(sentence);
  await repo.insertSentenceTokens(tokenRecords);

  // Create SRS cards (one per review mode)
  const deckId = await repo.ensureDefaultDeck();
  const modes: ReviewMode[] = ['en-to-zh', 'zh-to-en', 'py-to-en-zh'];
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
    state: 0, // new
    lastReview: null,
    createdAt: Date.now(),
  }));

  await repo.insertSrsCards(cards);

  return sentenceId;
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
async function findOrCreateMeaning(token: TokenInput): Promise<Meaning> {
  const candidates = await repo.getMeaningsByHeadword(token.surfaceForm);
  const existing = candidates.find(
    (m) =>
      m.pinyinNumeric === token.pinyinNumeric &&
      m.englishShort === token.english
  );

  if (existing) return existing;

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
  return meaning;
}

/**
 * Find or create a character-level meaning.
 * Same dedup logic as findOrCreateMeaning but for characters specifically.
 */
async function findOrCreateCharacterMeaning(
  char: string,
  pinyinNumeric: string,
  english: string
): Promise<Meaning> {
  const candidates = await repo.getMeaningsByHeadword(char);
  const exact = candidates.find(
    (m) =>
      m.type === 'character' &&
      m.pinyinNumeric === pinyinNumeric &&
      m.englishShort === english
  );

  if (exact) return exact;

  // No match — create new character meaning
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
  return meaning;
}

/**
 * Decompose a multi-character word into its character meanings.
 * Uses LLM-provided character data when available.
 */
async function decomposeWord(
  wordMeaning: Meaning,
  token: TokenInput
): Promise<void> {
  // Check if already decomposed
  const existingCount = await repo.getMeaningLinkCountByParent(wordMeaning.id);
  if (existingCount > 0) return;

  const chars = Array.from(token.surfaceForm);
  const syllables = wordMeaning.pinyinNumeric.split(/\s+/);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    // Use LLM character data if available
    const llmChar = token.characters?.find((c) => c.char === char)
      || token.characters?.[i]; // fallback to positional match

    const charPinyinNumeric = llmChar?.pinyinNumeric || syllables[i] || '';
    const charEnglish = llmChar?.english || `(component of ${wordMeaning.headword})`;

    const charMeaning = await findOrCreateCharacterMeaning(
      char,
      charPinyinNumeric,
      charEnglish
    );

    const link: MeaningLink = {
      id: uuid(),
      parentMeaningId: wordMeaning.id,
      childMeaningId: charMeaning.id,
      position: i,
      role: 'character',
    };
    await repo.insertMeaningLink(link);
  }
}

// ============================================================
// Deletion
// ============================================================

/** Delete a single sentence and its tokens, SRS cards, and review logs. */
export async function deleteSentence(sentenceId: string): Promise<void> {
  const cards = await repo.getSrsCardsBySentence(sentenceId);
  const cardIds = cards.map((c) => c.id);

  await repo.deleteReviewLogsByCardIds(cardIds);
  await repo.deleteSrsCardsBySentence(sentenceId);
  await repo.deleteTokensBySentence(sentenceId);
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

  const results = [];
  for (const link of links) {
    const childMeaning = await repo.getMeaning(link.childMeaningId);
    if (childMeaning) {
      results.push({ ...link, childMeaning });
    }
  }
  return results;
}

/** Get tokens for a sentence, ordered by position */
export async function getTokensForSentence(
  sentenceId: string
): Promise<(SentenceToken & { meaning: Meaning })[]> {
  const tokens = await repo.getTokensBySentence(sentenceId);

  const results = [];
  for (const token of tokens) {
    const meaning = await repo.getMeaning(token.meaningId);
    if (meaning) {
      results.push({ ...token, meaning });
    }
  }
  return results;
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
  const tutorialSentences = await repo.getSentencesBySource('tutorial');
  if (tutorialSentences.length === 0) return;

  for (const s of tutorialSentences) {
    await repo.deleteTokensBySentence(s.id);
    await repo.deleteSrsCardsBySentence(s.id);
  }
  await repo.deleteSentencesBySource('tutorial');
}

/** Get all meanings that share the same pinyin (for pinyin card) */
export async function getMeaningsByPinyin(
  pinyinNumeric: string
): Promise<Meaning[]> {
  return repo.getMeaningsByPinyinNumeric(pinyinNumeric);
}
