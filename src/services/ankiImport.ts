/**
 * Anki import service.
 *
 * Parses tab/comma-separated text exported from Anki, uses an LLM to identify
 * field mappings, then ingests each sentence through the main pipeline.
 *
 * The import runs as a 4-stage pipeline so the slow step (LLM analysis) can
 * fan out in parallel while everything stateful stays serialized:
 *
 *   A. Extract fields from every row           (pure, instant)
 *   B. Dedup against local Dexie               (parallel reads, cheap)
 *   C. Analyze via LLM with bounded concurrency (slow, parallel)
 *   D. Ingest results sequentially             (serialized so findOrCreateMeaning
 *                                               dedup stays correct)
 *
 * On top of the pipeline:
 *   - Error classifier distinguishes rate-limit / network / parse / other.
 *   - Transient errors (rate-limit, network) get retried with exp backoff.
 *   - A circuit breaker stops firing new LLM calls after sustained rate
 *     limiting so we don't burn through a whole file of hopeless attempts.
 *   - The sentence-level dedup means rerunning the same file is safe — it
 *     skips everything already imported and retries only the failures.
 */
import { generateCompletion } from './aiProvider';
import { generateAnalysisPrompt, parseLLMResponse, getExistingMeanings, type LLMResponse } from './llmPrompt';
import { ingestSentence } from './ingestion';
import { stripAnkiHtml } from './ankiApkg';
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

export type ErrorKind =
  | 'rate-limit'
  | 'network'
  | 'llm-parse'
  | 'duplicate'
  | 'no-fields'
  | 'aborted'
  | 'other';

export interface ImportIssue {
  sentence: string;
  reason: string;
  type: 'skipped' | 'failed';
  errorKind?: ErrorKind;
}

export interface ImportProgress {
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  currentSentence: string;
  issues: ImportIssue[];
  /** Set when the circuit breaker tripped; communicates "you can re-run to retry these". */
  rateLimited?: boolean;
}

export type ProgressCallback = (progress: ImportProgress) => void;

export interface ImportOptions {
  /** How many LLM calls to fan out at once during analysis. 1 = strictly sequential. */
  concurrency?: number;
  /** Max attempts per row when the LLM call hits a transient error. */
  maxRetries?: number;
}

export const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_MAX_RETRIES = 3;
/** Trip the circuit breaker after this many in-flight rate-limit errors in a row. */
export const RATE_LIMIT_TRIP_THRESHOLD = 5;

// ────────────────────────────────────────────────────────────
// File parsing
// ────────────────────────────────────────────────────────────

export async function readFileAsText(file: File): Promise<string> {
  return file.text();
}

export function parseRows(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });
}

// ────────────────────────────────────────────────────────────
// LLM field mapping
// ────────────────────────────────────────────────────────────

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

  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    const mapping = JSON.parse(cleaned) as FieldMapping;

    if (typeof mapping.chineseField !== 'number' || mapping.chineseField < 0) {
      throw new Error('Invalid chineseField');
    }
    if (typeof mapping.englishField !== 'number' || mapping.englishField < 0) {
      throw new Error('Invalid englishField');
    }
    if (mapping.pinyinField !== null && (typeof mapping.pinyinField !== 'number' || mapping.pinyinField < 0)) {
      mapping.pinyinField = null;
    }

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

interface ExtractedFields {
  /** Always trimmed — downstream code should not re-normalize. */
  chinese: string;
  english: string;
  pinyin: string | null;
}

function extractFields(row: string, mapping: FieldMapping): ExtractedFields | null {
  const fields = row.split(mapping.separator);

  const chinese = stripAnkiHtml(fields[mapping.chineseField] ?? '');
  if (!chinese) return null;
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chinese)) return null;

  const pinyin = mapping.pinyinField !== null
    ? stripAnkiHtml(fields[mapping.pinyinField] ?? '') || null
    : null;

  if (mapping.englishField === mapping.chineseField) {
    const parts = chinese.split(/\s*[-=:：]\s*/);
    if (parts.length >= 2) {
      const chinesePart = parts.find((p) => /[\u4e00-\u9fff]/.test(p));
      const englishPart = parts.find((p) => /[a-zA-Z]/.test(p) && !/[\u4e00-\u9fff]/.test(p));
      return {
        chinese: chinesePart?.trim() || chinese,
        english: englishPart?.trim() || '',
        pinyin,
      };
    }
  }

  const english = mapping.englishField === mapping.chineseField
    ? ''
    : stripAnkiHtml(fields[mapping.englishField] ?? '');

  return { chinese, english, pinyin };
}

// ────────────────────────────────────────────────────────────
// Error classification + retry
// ────────────────────────────────────────────────────────────

/**
 * Map a thrown error to a coarse category the UI can report on and the retry
 * logic can branch on. We stay defensive about the error shape because
 * different AI providers surface rate-limits differently (OpenAI sets
 * `status: 429`, Anthropic sometimes wraps the status in a generic Error).
 */
export function classifyError(e: unknown): ErrorKind {
  const err = e as { status?: number; message?: string; response?: { status?: number } };
  const msg = (err?.message || String(e)).toLowerCase();
  const status = err?.status ?? err?.response?.status;

  if (status === 429 || /rate.?limit|quota|too many requests/.test(msg)) return 'rate-limit';
  if (status !== undefined && status >= 500) return 'network';
  if (/network|fetch|timeout|econnreset|socket/.test(msg)) return 'network';
  if (/parse|json|invalid json|could not parse/.test(msg)) return 'llm-parse';
  return 'other';
}

function isTransient(kind: ErrorKind): boolean {
  return kind === 'rate-limit' || kind === 'network';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry only transient errors; return the final error's kind on exhaustion. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const kind = classifyError(e);
      if (!isTransient(kind) || attempt === maxAttempts - 1) throw e;
      // 1s, 3s, 9s — wide enough to survive typical 429 cooldowns
      await sleep(Math.pow(3, attempt) * 1000);
    }
  }
  throw lastErr;
}

// ────────────────────────────────────────────────────────────
// Bounded concurrency + circuit breaker
// ────────────────────────────────────────────────────────────

/** Run `tasks` with at most `concurrency` in flight at once. */
export async function parallelMap<T, U>(
  tasks: T[],
  concurrency: number,
  run: (task: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(tasks.length);
  const width = Math.max(1, Math.min(concurrency, tasks.length || 1));
  let nextIndex = 0;

  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      results[i] = await run(tasks[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

// ────────────────────────────────────────────────────────────
// Pipeline stages — split out so each can be tested in isolation.
// ────────────────────────────────────────────────────────────

interface RowPlan {
  /** 0-based row index for deterministic ordering in the final report. */
  index: number;
  rawRow: string;
  fields: ExtractedFields | null;
}

interface AnalysisInput {
  index: number;
  fields: ExtractedFields;
}

interface AnalysisSuccess {
  kind: 'ok';
  index: number;
  fields: ExtractedFields;
  parsed: LLMResponse;
}

interface AnalysisFailure {
  kind: 'err';
  index: number;
  fields: ExtractedFields;
  errorKind: ErrorKind;
  message: string;
}

type AnalysisResult = AnalysisSuccess | AnalysisFailure;

async function analyzeOne(input: AnalysisInput, maxRetries: number): Promise<AnalysisResult> {
  try {
    const existingMeanings = await getExistingMeanings(input.fields.chinese);
    const prompt = generateAnalysisPrompt(input.fields.chinese, existingMeanings);
    const raw = await withRetry(() => generateCompletion(prompt), maxRetries);
    const parsed = parseLLMResponse(raw);
    return { kind: 'ok', index: input.index, fields: input.fields, parsed };
  } catch (e: any) {
    return {
      kind: 'err',
      index: input.index,
      fields: input.fields,
      errorKind: classifyError(e),
      message: e?.message || 'Unknown error',
    };
  }
}

async function ingestOne(
  success: AnalysisSuccess,
  tags: string[],
): Promise<void> {
  const { fields, parsed } = success;
  const finalEnglish = fields.english || parsed.english;
  await ingestSentence({
    chinese: fields.chinese,
    english: finalEnglish,
    tokens: parsed.tokens.map((t) => ({
      surfaceForm: t.surfaceForm,
      pinyinNumeric: t.pinyinNumeric,
      english: t.english,
      partOfSpeech: t.partOfSpeech || 'other',
      isTransliteration: t.isTransliteration,
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

export async function importFromAnki(
  file: File,
  onProgress: ProgressCallback,
  abortSignal?: AbortSignal,
  maxItems?: number,
  options: ImportOptions = {},
): Promise<ImportProgress> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  const content = await readFileAsText(file);
  let rows = parseRows(content);

  if (rows.length === 0) {
    throw new Error('No data rows found in the file. Make sure the file contains Anki card data.');
  }

  if (maxItems && maxItems > 0) {
    rows = rows.slice(0, maxItems);
  }

  const progress: ImportProgress = {
    total: rows.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    currentSentence: '',
    issues: [],
  };

  const recordIssue = (issue: ImportIssue) => {
    progress.issues.push(issue);
    if (issue.type === 'skipped') progress.skipped++;
    else progress.failed++;
    progress.processed++;
    onProgress({ ...progress });
  };

  onProgress({ ...progress, currentSentence: 'Detecting field mapping…' });

  const mapping = await detectFieldMapping(rows);

  const plans: RowPlan[] = rows.map((rawRow, index) => ({
    index,
    rawRow,
    fields: extractFields(rawRow, mapping),
  }));

  for (const plan of plans) {
    if (!plan.fields) {
      recordIssue({
        sentence: plan.rawRow.slice(0, 60),
        reason: 'Could not extract fields',
        type: 'skipped',
        errorKind: 'no-fields',
      });
    }
  }

  // Dedup reads are cheap and independent; running them all in parallel lets
  // us report the final skipped count before we start spending LLM tokens.
  onProgress({ ...progress, currentSentence: 'Checking for duplicates…' });
  const dedupChecks = await Promise.all(
    plans
      .filter((p): p is RowPlan & { fields: ExtractedFields } => !!p.fields)
      .map(async (p) => ({
        plan: p,
        isDuplicate: !!(await repo.getSentenceByChinese(p.fields.chinese)),
      })),
  );

  const toAnalyze: AnalysisInput[] = [];
  for (const { plan, isDuplicate } of dedupChecks) {
    if (isDuplicate) {
      recordIssue({
        sentence: plan.fields.chinese,
        reason: 'Duplicate — already in app',
        type: 'skipped',
        errorKind: 'duplicate',
      });
    } else {
      toAnalyze.push({ index: plan.index, fields: plan.fields });
    }
  }

  // `tripped` flips true once we hit RATE_LIMIT_TRIP_THRESHOLD consecutive
  // rate-limit errors across completions — after that, new tasks short-circuit
  // so the user doesn't wait for dozens more hopeless requests.
  let rateLimitStreak = 0;
  let tripped = false;

  const analysisResults = await parallelMap(toAnalyze, concurrency, async (task) => {
    if (abortSignal?.aborted) {
      return { kind: 'err' as const, index: task.index, fields: task.fields, errorKind: 'aborted' as ErrorKind, message: 'Aborted' };
    }
    if (tripped) {
      return { kind: 'err' as const, index: task.index, fields: task.fields, errorKind: 'rate-limit' as ErrorKind, message: 'Skipped after sustained rate limiting' };
    }
    const result = await analyzeOne(task, maxRetries);
    if (result.kind === 'err' && result.errorKind === 'rate-limit') {
      rateLimitStreak++;
      if (rateLimitStreak >= RATE_LIMIT_TRIP_THRESHOLD) tripped = true;
    } else {
      rateLimitStreak = 0;
    }
    progress.currentSentence = task.fields.chinese;
    onProgress({ ...progress });
    return result;
  });

  // Ingest runs serially: `findOrCreateMeaning` dedups via read-then-write,
  // which races if run in parallel, so we keep this stage single-threaded.
  for (const result of analysisResults) {
    if (abortSignal?.aborted) break;

    if (result.kind === 'err') {
      recordIssue({
        sentence: result.fields.chinese,
        reason: result.message.slice(0, 150),
        type: 'failed',
        errorKind: result.errorKind,
      });
      continue;
    }

    progress.currentSentence = result.fields.chinese;
    onProgress({ ...progress });

    try {
      await ingestOne(result, ['anki-import']);
      progress.imported++;
      progress.processed++;
      onProgress({ ...progress });
    } catch (e: any) {
      const msg: string = e?.message || 'Unknown error';
      const isDuplicate = msg === 'duplicate' || msg.includes('already exists');
      recordIssue({
        sentence: result.fields.chinese,
        reason: isDuplicate ? 'Duplicate — already in app' : msg.slice(0, 150),
        type: isDuplicate ? 'skipped' : 'failed',
        errorKind: isDuplicate ? 'duplicate' : 'other',
      });
    }
  }

  progress.currentSentence = '';
  if (tripped) progress.rateLimited = true;
  onProgress({ ...progress });
  return progress;
}
