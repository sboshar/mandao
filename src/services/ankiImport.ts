/**
 * Anki import service.
 * Parses tab-separated or comma-separated text files exported from Anki,
 * uses LLM to identify field mappings, then ingests sentences via the
 * existing ingestion pipeline.
 */
import { generateCompletion } from './aiProvider';
import { generateAnalysisPrompt, parseLLMResponse, getExistingMeanings } from './llmPrompt';
import { ingestSentence } from './ingestion';
import * as repo from '../db/repo';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface FieldMapping {
  chineseField: number;
  englishField: number;
  pinyinField: number | null;
  separator: string;
}

export interface ImportProgress {
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  currentSentence: string;
  errors: string[];
}

export type ProgressCallback = (progress: ImportProgress) => void;

// ────────────────────────────────────────────────────────────
// File parsing
// ────────────────────────────────────────────────────────────

/** Read a file as text, handling common encodings. */
export async function readFileAsText(file: File): Promise<string> {
  return file.text();
}

/** Split file content into rows, filtering out blanks and Anki directives. */
export function parseRows(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      // Skip empty lines, Anki directives, and HTML-only lines
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });
}

// ────────────────────────────────────────────────────────────
// LLM field mapping
// ────────────────────────────────────────────────────────────

/**
 * Send a sample of rows to the LLM to determine field mapping.
 * Returns which column indices contain Chinese, English, and optionally pinyin.
 */
export async function detectFieldMapping(rows: string[]): Promise<FieldMapping> {
  const sample = rows.slice(0, Math.min(8, rows.length));
  const sampleText = sample.map((r, i) => `Row ${i + 1}: ${r}`).join('\n');

  const prompt = `You are analyzing a text file exported from Anki (a flashcard app) for Chinese language study.

Here are sample rows from the file:
${sampleText}

Determine:
1. What separator is used between fields? Common options: tab (\\t), comma, semicolon, pipe (|)
2. Which field (0-indexed column number) contains Chinese text?
3. Which field contains English text?
4. Which field contains pinyin (if any)?

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "chineseField": <number>,
  "englishField": <number>,
  "pinyinField": <number or null>,
  "separator": "<the separator character, use \\t for tab>"
}

Rules:
- Chinese text contains Chinese characters (hanzi)
- English text contains English words/phrases
- Pinyin contains romanized Chinese with tone marks or tone numbers
- If a field contains BOTH Chinese and English (like "好 - good"), mark it as the Chinese field and set englishField to the same number — the import logic will handle splitting
- Fields may contain HTML tags like <br> or <div> — ignore those when identifying content
- Return ONLY valid JSON`;

  const raw = await generateCompletion(prompt);

  // Parse the LLM response
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    const mapping = JSON.parse(cleaned) as FieldMapping;

    // Validate
    if (typeof mapping.chineseField !== 'number' || mapping.chineseField < 0) {
      throw new Error('Invalid chineseField');
    }
    if (typeof mapping.englishField !== 'number' || mapping.englishField < 0) {
      throw new Error('Invalid englishField');
    }
    if (mapping.pinyinField !== null && (typeof mapping.pinyinField !== 'number' || mapping.pinyinField < 0)) {
      mapping.pinyinField = null;
    }

    // Normalize separator
    if (mapping.separator === '\\t' || mapping.separator === 'tab') {
      mapping.separator = '\t';
    }

    return mapping;
  } catch (e: any) {
    throw new Error(`Failed to parse LLM field mapping: ${e.message}\n\nRaw response: ${raw.slice(0, 200)}`);
  }
}

// ────────────────────────────────────────────────────────────
// Row extraction
// ────────────────────────────────────────────────────────────

/** Strip HTML tags from a string. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract fields from a row using the detected mapping. */
function extractFields(
  row: string,
  mapping: FieldMapping
): { chinese: string; english: string; pinyin: string | null } | null {
  const fields = row.split(mapping.separator);

  const chinese = stripHtml(fields[mapping.chineseField] ?? '').trim();
  if (!chinese) return null;

  // Check if there's actually Chinese text
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chinese)) return null;

  let english = '';
  if (mapping.englishField === mapping.chineseField) {
    // Mixed field — try to split on common patterns like " - ", " = ", "："
    const parts = chinese.split(/\s*[-=:：]\s*/);
    if (parts.length >= 2) {
      // Return the part that has Chinese as chinese, other as english
      const chinesePart = parts.find((p) => /[\u4e00-\u9fff]/.test(p));
      const englishPart = parts.find((p) => /[a-zA-Z]/.test(p) && !/[\u4e00-\u9fff]/.test(p));
      return {
        chinese: chinesePart?.trim() || chinese,
        english: englishPart?.trim() || '',
        pinyin: mapping.pinyinField !== null ? stripHtml(fields[mapping.pinyinField] ?? '').trim() || null : null,
      };
    }
  } else {
    english = stripHtml(fields[mapping.englishField] ?? '').trim();
  }

  const pinyin = mapping.pinyinField !== null
    ? stripHtml(fields[mapping.pinyinField] ?? '').trim() || null
    : null;

  return { chinese, english, pinyin };
}

// ────────────────────────────────────────────────────────────
// Sentence analysis via LLM (batch-friendly)
// ────────────────────────────────────────────────────────────

/**
 * Analyze a Chinese sentence using the LLM to get tokenization data,
 * then ingest it through the standard pipeline.
 */
async function analyzeAndIngest(
  chinese: string,
  english: string,
  _pinyin: string | null,
  tags: string[],
): Promise<void> {
  // Check for duplicates
  const existing = await repo.getSentenceByChinese(chinese.trim());
  if (existing) {
    throw new Error('duplicate');
  }

  // Get existing meanings for better LLM context
  const existingMeanings = await getExistingMeanings(chinese.trim());
  const prompt = generateAnalysisPrompt(chinese.trim(), existingMeanings);
  const raw = await generateCompletion(prompt);
  const parsed = parseLLMResponse(raw);

  // Use LLM's English if we don't have one from the file
  const finalEnglish = english || parsed.english;

  await ingestSentence({
    chinese: chinese.trim(),
    english: finalEnglish,
    tokens: parsed.tokens.map((t) => ({
      surfaceForm: t.surfaceForm,
      pinyinNumeric: t.pinyinNumeric,
      english: t.english,
      partOfSpeech: t.partOfSpeech || 'other',
      characters: t.characters?.map((c) => ({
        char: c.char,
        pinyinNumeric: c.pinyinNumeric,
        pinyinSandhi: c.pinyinSandhi,
        english: c.english,
      })),
    })),
    source: 'anki-import',
    tags,
  });
}

// ────────────────────────────────────────────────────────────
// Main import function
// ────────────────────────────────────────────────────────────

/**
 * Import sentences from an Anki export file.
 *
 * Flow:
 * 1. Parse file into rows
 * 2. Send sample to LLM to detect field mapping
 * 3. Extract Chinese/English/Pinyin from each row
 * 4. For each sentence, run LLM analysis + ingestion pipeline
 * 5. Report progress via callback
 */
export async function importFromAnki(
  file: File,
  onProgress: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<ImportProgress> {
  const content = await readFileAsText(file);
  const rows = parseRows(content);

  if (rows.length === 0) {
    throw new Error('No data rows found in the file. Make sure the file contains Anki card data.');
  }

  const progress: ImportProgress = {
    total: rows.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    currentSentence: '',
    errors: [],
  };

  onProgress({ ...progress, currentSentence: 'Detecting field mapping...' });

  // Step 1: Detect field mapping via LLM
  const mapping = await detectFieldMapping(rows);

  // Step 2: Process each row
  for (let i = 0; i < rows.length; i++) {
    if (abortSignal?.aborted) break;

    const fields = extractFields(rows[i], mapping);

    if (!fields) {
      progress.skipped++;
      progress.processed++;
      onProgress({ ...progress });
      continue;
    }

    progress.currentSentence = fields.chinese;
    onProgress({ ...progress });

    try {
      await analyzeAndIngest(
        fields.chinese,
        fields.english,
        fields.pinyin,
        ['anki-import'],
      );
      progress.imported++;
    } catch (e: any) {
      if (e.message === 'duplicate' || e.message?.includes('already exists')) {
        progress.skipped++;
      } else {
        progress.failed++;
        if (progress.errors.length < 10) {
          progress.errors.push(`"${fields.chinese}": ${e.message?.slice(0, 100) || 'Unknown error'}`);
        }
      }
    }

    progress.processed++;
    onProgress({ ...progress });
  }

  progress.currentSentence = '';
  onProgress({ ...progress });
  return progress;
}
