/**
 * Anki .apkg import/export service.
 * Handles reading and writing .apkg files (ZIP archives containing SQLite databases).
 */
import initSqlJs, { type Database } from 'sql.js';
import JSZip from 'jszip';
import { decompress } from 'fzstd';
import { generateCompletion } from './aiProvider';
import { generateAnalysisPrompt, parseLLMResponse, getExistingMeanings } from './llmPrompt';
import { ingestSentence } from './ingestion';
import * as repo from '../db/repo';
import type { ImportProgress, ProgressCallback } from './ankiImport';
import { v4 as uuid } from 'uuid';
import type { AudioRecording } from '../db/schema';

// Re-export types for convenience
export type { ImportProgress, ProgressCallback };

// ────────────────────────────────────────────────────────────
// SQL.js singleton
// ────────────────────────────────────────────────────────────

let sqlPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => '/sql-wasm.wasm',
    });
  }
  return sqlPromise;
}

function stripAnkiHtml(html: string): string {
  return html
    .replace(/\[sound:[^\]]+\]/g, '')
    .replace(/<img[^>]*>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function openApkgDatabase(
  file: File,
): Promise<{ db: Database; tableNames: string[]; zip: JSZip; media: Record<string, string> }> {
  const arrayBuf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuf);
  const SQL = await getSql();

  const anki21b = zip.file('collection.anki21b');
  const anki2 = zip.file('collection.anki2');

  let db: Database;
  if (anki21b) {
    db = new SQL.Database(decompress(await anki21b.async('uint8array')));
  } else if (anki2) {
    db = new SQL.Database(await anki2.async('uint8array'));
  } else {
    throw new Error('No collection database found in .apkg file.');
  }

  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = tables[0]?.values.map(r => String(r[0])) || [];

  if (!tableNames.includes('notes')) {
    db.close();
    throw new Error('Invalid .apkg database: no notes table found.');
  }

  let media: Record<string, string> = {};
  const mediaFile = zip.file('media');
  if (mediaFile) {
    try {
      media = JSON.parse(await mediaFile.async('string'));
    } catch {
      // Legacy decks may have a binary media file; skip gracefully.
    }
  }

  return { db, tableNames, zip, media };
}

/** Extract [sound:filename] tokens from an Anki field. */
function extractSoundRefs(fieldText: string): string[] {
  const out: string[] = [];
  const re = /\[sound:([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fieldText)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** Guess a MIME type from an audio filename extension. */
function mimeFromAudioFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'ogg': case 'oga': return 'audio/ogg';
    case 'wav': return 'audio/wav';
    case 'webm': return 'audio/webm';
    case 'm4a': case 'mp4': case 'aac': return 'audio/mp4';
    case 'flac': return 'audio/flac';
    default: return 'audio/mpeg';
  }
}

/**
 * Given a media map (index→filename) and a target filename, return the zip
 * entry that holds the blob, plus the resolved filename. Returns null if the
 * file isn't in the deck.
 */
function resolveMediaBlob(
  zip: JSZip,
  media: Record<string, string>,
  filename: string,
): { entry: JSZip.JSZipObject; filename: string } | null {
  for (const [index, name] of Object.entries(media)) {
    if (name === filename) {
      const entry = zip.file(index);
      if (entry) return { entry, filename: name };
    }
  }
  // Fallback: some decks store media by filename directly.
  const direct = zip.file(filename);
  if (direct) return { entry: direct, filename };
  return null;
}

function extractFieldNames(db: Database, tableNames: string[]): string[] {
  if (tableNames.includes('notetypes') && tableNames.includes('fields')) {
    const ntResult = db.exec('SELECT id FROM notetypes LIMIT 1');
    if (ntResult[0]?.values[0]?.[0]) {
      const ntId = ntResult[0].values[0][0];
      const fieldsResult = db.exec(`SELECT name FROM fields WHERE ntid = ${ntId} ORDER BY ord`);
      const names = fieldsResult[0]?.values.map(r => String(r[0])) || [];
      if (names.length > 0) return names;
    }
  }
  if (tableNames.includes('col')) {
    try {
      const modelsResult = db.exec('SELECT models FROM col LIMIT 1');
      if (modelsResult[0]?.values[0]?.[0]) {
        const models = JSON.parse(String(modelsResult[0].values[0][0]));
        const firstModel = Object.values(models)[0] as any;
        if (firstModel?.flds) return firstModel.flds.map((f: any) => f.name);
      }
    } catch { /* legacy format may not parse */ }
  }
  return ['Front', 'Back'];
}

// ────────────────────────────────────────────────────────────
// SM-2 to FSRS conversion
// ────────────────────────────────────────────────────────────

interface AnkiCard {
  id: number;
  nid: number;
  did: number;
  type: number;   // 0=New, 1=Learning, 2=Review, 3=Relearning
  ivl: number;    // interval in days (for review cards)
  factor: number; // ease factor in permille (2500 = 2.5x)
  reps: number;
  lapses: number;
  due: number;    // for review cards: day offset from col creation
  data: string;   // JSON, may contain FSRS params
}

interface ConvertedScheduling {
  stability: number;
  difficulty: number;
  state: number;
  reps: number;
  lapses: number;
  due: number; // timestamp ms
  elapsedDays: number;
  scheduledDays: number;
}

function convertSm2ToFsrs(card: AnkiCard, colCreatedMs: number): ConvertedScheduling {
  // State maps directly: 0=New, 1=Learning, 2=Review, 3=Relearning
  const state = card.type;

  // Stability approximated from interval
  const stability = card.ivl > 0 ? card.ivl : 0;

  // Difficulty: map factor (permille) to 1-10 range
  // factor 2500 -> difficulty 1.0, factor 1300 -> difficulty 5.8
  const difficulty = card.factor > 0
    ? Math.max(1, Math.min(10, 11 - (card.factor / 1000) * 4))
    : 5; // default for new cards

  // Due: for review cards, due is day offset from collection creation
  let dueMs: number;
  if (state === 2 && card.due > 0) {
    dueMs = colCreatedMs + card.due * 86400000;
  } else if (state === 0) {
    dueMs = Date.now(); // new cards are due now
  } else {
    // Learning/relearning: due is epoch seconds in Anki
    dueMs = card.due > 1e12 ? card.due : card.due * 1000;
  }

  // Check for FSRS data in the card's data field
  try {
    const data = JSON.parse(card.data || '{}');
    if (data.s !== undefined && data.d !== undefined) {
      return {
        stability: data.s,
        difficulty: data.d,
        state,
        reps: card.reps,
        lapses: card.lapses,
        due: dueMs,
        elapsedDays: card.ivl > 0 ? card.ivl : 0,
        scheduledDays: card.ivl > 0 ? card.ivl : 0,
      };
    }
  } catch {
    // Not JSON or no FSRS data, use SM-2 conversion
  }

  return {
    stability,
    difficulty,
    state,
    reps: card.reps,
    lapses: card.lapses,
    due: dueMs,
    elapsedDays: card.ivl > 0 ? card.ivl : 0,
    scheduledDays: card.ivl > 0 ? card.ivl : 0,
  };
}

// ────────────────────────────────────────────────────────────
// Analyze .apkg (step 1: extract fields for user to pick mapping)
// ────────────────────────────────────────────────────────────

export interface ApkgNote {
  id: number;
  /** Raw fields split by \x1f, HTML stripped */
  fields: string[];
}

export interface ApkgFieldInfo {
  fieldNames: string[];
  notes: ApkgNote[];
  suggestedChineseField: number;
  /** First field containing `[sound:...]` tokens, or null if the deck has no audio. */
  suggestedAudioField: number | null;
  /** Whether the deck's media manifest lists any audio files. */
  hasAudio: boolean;
}

export async function analyzeApkg(file: File): Promise<ApkgFieldInfo> {
  const { db, tableNames, media } = await openApkgDatabase(file);

  try {
    const fieldNames = extractFieldNames(db, tableNames);

    const notesResult = db.exec('SELECT id, flds FROM notes');
    const rawRows = notesResult[0]?.values || [];
    const notes: ApkgNote[] = [];
    const chineseCounts = new Array(fieldNames.length).fill(0);
    const audioCounts = new Array(fieldNames.length).fill(0);
    const chineseRe = /[\u4e00-\u9fff\u3400-\u4dbf]/;

    for (const row of rawRows) {
      const rawFields = String(row[1]).split('\x1f');
      for (let idx = 0; idx < fieldNames.length; idx++) {
        const raw = rawFields[idx] ?? '';
        if (/\[sound:[^\]]+\]/.test(raw)) audioCounts[idx]++;
      }
      const stripped = rawFields.map(f => stripAnkiHtml(f));
      for (let idx = 0; idx < fieldNames.length; idx++) {
        if (chineseRe.test(stripped[idx] ?? '')) chineseCounts[idx]++;
      }
      notes.push({ id: Number(row[0]), fields: stripped });
    }

    const suggestedChineseField = chineseCounts.indexOf(Math.max(...chineseCounts));
    const maxAudio = Math.max(...audioCounts);
    const suggestedAudioField = maxAudio > 0 ? audioCounts.indexOf(maxAudio) : null;
    const hasAudio = Object.values(media).some(name =>
      /\.(mp3|ogg|oga|wav|webm|m4a|mp4|aac|flac)$/i.test(name),
    );

    return {
      fieldNames,
      notes,
      suggestedChineseField: Math.max(0, suggestedChineseField),
      suggestedAudioField,
      hasAudio,
    };
  } finally {
    db.close();
  }
}

// ────────────────────────────────────────────────────────────
// Import .apkg (step 2: process with user-confirmed mapping)
// ────────────────────────────────────────────────────────────

export async function importFromApkg(
  file: File,
  onProgress: ProgressCallback,
  abortSignal?: AbortSignal,
  chineseFieldIndex?: number,
  selectedNoteIds?: Set<number>,
  audioFieldIndex?: number | null,
  audioSourceName?: string,
): Promise<ImportProgress> {
  const progress: ImportProgress = {
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    currentSentence: '',
    issues: [],
  };

  onProgress({ ...progress, currentSentence: 'Reading .apkg file...' });

  const { db, tableNames, zip, media } = await openApkgDatabase(file);
  const audioEnabled =
    typeof audioFieldIndex === 'number' && audioFieldIndex >= 0;
  const audioLabel = (audioSourceName?.trim() || 'anki');

  try {
    let colCreatedMs = Date.now();
    if (tableNames.includes('col')) {
      const colResult = db.exec('SELECT crt FROM col LIMIT 1');
      if (colResult[0]?.values[0]?.[0]) {
        const crt = Number(colResult[0].values[0][0]);
        colCreatedMs = crt > 1e12 ? crt : crt * 1000;
      }
    }

    const notesResult = db.exec('SELECT id, flds FROM notes');
    if (!notesResult[0] || notesResult[0].values.length === 0) {
      throw new Error('No notes found in the .apkg file.');
    }

    let notes = notesResult[0].values.map(row => ({
      id: Number(row[0]),
      fields: String(row[1]).split('\x1f'),
    }));

    if (selectedNoteIds && selectedNoteIds.size > 0) {
      notes = notes.filter(n => selectedNoteIds.has(n.id));
    }

    // 7. Get cards with scheduling data
    const cardsMap = new Map<number, AnkiCard>();
    if (tableNames.includes('cards')) {
      const cardsResult = db.exec(
        'SELECT id, nid, did, type, ivl, factor, reps, lapses, due, data FROM cards'
      );
      if (cardsResult[0]) {
        for (const row of cardsResult[0].values) {
          const card: AnkiCard = {
            id: Number(row[0]),
            nid: Number(row[1]),
            did: Number(row[2]),
            type: Number(row[3]),
            ivl: Number(row[4]),
            factor: Number(row[5]),
            reps: Number(row[6]),
            lapses: Number(row[7]),
            due: Number(row[8]),
            data: String(row[9] || '{}'),
          };
          // Keep one card per note (prefer review cards over new)
          const existing = cardsMap.get(card.nid);
          if (!existing || card.type > existing.type) {
            cardsMap.set(card.nid, card);
          }
        }
      }
    }

    // 8. Determine Chinese field index
    progress.total = notes.length;
    const chIdx = chineseFieldIndex ?? 0;

    // 9. Process each note
    for (let i = 0; i < notes.length; i++) {
      if (abortSignal?.aborted) break;

      const note = notes[i];
      const fields = note.fields;

      // Extract Chinese text
      const rawChinese = fields[chIdx] ?? '';
      const chinese = stripAnkiHtml(rawChinese).trim();

      if (!chinese || !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chinese)) {
        progress.skipped++;
        progress.issues.push({ sentence: rawChinese.slice(0, 60) || '(empty)', reason: 'No Chinese characters found', type: 'skipped' });
        progress.processed++;
        onProgress({ ...progress });
        continue;
      }

      progress.currentSentence = chinese;
      onProgress({ ...progress });

      try {
        // Check for duplicates
        const existing = await repo.getSentenceByChinese(chinese);
        if (existing) {
          throw new Error('duplicate');
        }

        // Analyze via LLM
        const existingMeanings = await getExistingMeanings(chinese);
        const prompt = generateAnalysisPrompt(chinese, existingMeanings);
        const raw = await generateCompletion(prompt);
        const parsed = parseLLMResponse(raw);

        const sentenceId = await ingestSentence({
          chinese,
          english: parsed.english,
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
          source: 'anki-apkg-import',
          tags: ['anki-import'],
        });

        // Import attached audio if the user picked an audio field.
        if (audioEnabled) {
          const rawAudioField = fields[audioFieldIndex!] ?? '';
          const soundRefs = extractSoundRefs(rawAudioField);
          for (const refName of soundRefs) {
            const resolved = resolveMediaBlob(zip, media, refName);
            if (!resolved) {
              progress.issues.push({
                sentence: chinese,
                reason: `Audio file not found in deck: ${refName}`,
                type: 'skipped',
              });
              continue;
            }
            const mimeType = mimeFromAudioFilename(resolved.filename);
            const blob = await resolved.entry.async('blob');
            const rec: AudioRecording = {
              id: uuid(),
              sentenceId,
              name: audioLabel,
              blob: blob.type ? blob : new Blob([blob], { type: mimeType }),
              mimeType,
              source: 'manual',
              createdAt: Date.now(),
            };
            await repo.insertAudioRecording(rec);
          }
        }

        // Apply scheduling data from Anki card if available
        const ankiCard = cardsMap.get(note.id);
        if (ankiCard && ankiCard.reps > 0) {
          const scheduling = convertSm2ToFsrs(ankiCard, colCreatedMs);
          // Update the SRS cards that were created during ingestion
          const srsCards = await repo.getSrsCardsBySentence(sentenceId);
          for (const srsCard of srsCards) {
            await repo.updateSrsCard(srsCard.id, {
              stability: scheduling.stability,
              difficulty: scheduling.difficulty,
              state: scheduling.state,
              reps: scheduling.reps,
              lapses: scheduling.lapses,
              due: scheduling.due,
              elapsedDays: scheduling.elapsedDays,
              scheduledDays: scheduling.scheduledDays,
              lastReview: scheduling.due - scheduling.scheduledDays * 86400000 || null,
            });
          }
        }

        progress.imported++;
      } catch (e: any) {
        if (e.message === 'duplicate' || e.message?.includes('already exists')) {
          progress.skipped++;
          progress.issues.push({ sentence: chinese, reason: 'Duplicate — already in app', type: 'skipped' });
        } else {
          progress.failed++;
          progress.issues.push({ sentence: chinese, reason: e.message?.slice(0, 150) || 'Unknown error', type: 'failed' });
        }
      }

      progress.processed++;
      onProgress({ ...progress });
    }
  } finally {
    db.close();
  }

  progress.currentSentence = '';
  onProgress({ ...progress });
  return progress;
}

// ────────────────────────────────────────────────────────────
// Export .apkg
// ────────────────────────────────────────────────────────────

export async function exportToApkg(): Promise<Blob> {
  const sentences = await repo.getAllSentences();
  if (sentences.length === 0) {
    throw new Error('No sentences to export.');
  }

  const allCards = await repo.getAllSrsCards();
  const cardsBySentence = new Map<string, {
    stability: number;
    difficulty: number;
    state: number;
    reps: number;
    lapses: number;
    due: number;
    elapsedDays: number;
    scheduledDays: number;
    lastReview: number | null;
  }>();

  for (const card of allCards) {
    const existing = cardsBySentence.get(card.sentenceId);
    if (!existing || card.reviewMode === 'zh-to-en') {
      cardsBySentence.set(card.sentenceId, {
        stability: card.stability,
        difficulty: card.difficulty,
        state: card.state,
        reps: card.reps,
        lapses: card.lapses,
        due: card.due,
        elapsedDays: card.elapsedDays,
        scheduledDays: card.scheduledDays,
        lastReview: card.lastReview,
      });
    }
  }

  const SQL = await getSql();
  const db = new SQL.Database();

  try {
    const now = Math.floor(Date.now() / 1000);
    const modelId = 1700000000000;
    const deckId = 1700000000001;

    // Create Anki schema tables
    db.run(`CREATE TABLE col (
      id INTEGER PRIMARY KEY,
      crt INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      scm INTEGER NOT NULL,
      ver INTEGER NOT NULL,
      dty INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      ls INTEGER NOT NULL,
      conf TEXT NOT NULL,
      models TEXT NOT NULL,
      decks TEXT NOT NULL,
      dconf TEXT NOT NULL,
      tags TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      guid TEXT NOT NULL,
      mid INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      tags TEXT NOT NULL,
      flds TEXT NOT NULL,
      sfld TEXT NOT NULL,
      csum INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER NOT NULL,
      did INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      type INTEGER NOT NULL,
      queue INTEGER NOT NULL,
      due INTEGER NOT NULL,
      ivl INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      left INTEGER NOT NULL,
      odue INTEGER NOT NULL,
      odid INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE revlog (
      id INTEGER PRIMARY KEY,
      cid INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      ease INTEGER NOT NULL,
      ivl INTEGER NOT NULL,
      lastIvl INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      time INTEGER NOT NULL,
      type INTEGER NOT NULL
    )`);

    db.run('CREATE TABLE graves (usn INTEGER NOT NULL, oid INTEGER NOT NULL, type INTEGER NOT NULL)');

    // Model definition (Basic: Front/Back)
    const model = {
      [modelId]: {
        id: modelId,
        name: 'Mandao Chinese',
        type: 0,
        mod: now,
        usn: -1,
        sortf: 0,
        did: deckId,
        tmpls: [{
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        }],
        flds: [
          { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
          { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        ],
        css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
        latexPre: '',
        latexPost: '',
        latexsvg: false,
        req: [[0, 'any', [0]]],
      },
    };

    // Deck definition
    const decks = {
      '1': { id: 1, name: 'Default', mod: now, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 },
      [deckId]: { id: deckId, name: 'Mandao Chinese', mod: now, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: 'Exported from Mandao', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 },
    };

    const dconf = {
      '1': { id: 1, name: 'Default', mod: now, usn: -1, maxTaken: 60, autoplay: true, timer: 0, replayq: true, new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 }, rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 }, lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 } },
    };

    // Insert collection metadata
    db.run(
      `INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, ?, '{}')`,
      [now, now, now * 1000, JSON.stringify(model), JSON.stringify(decks), JSON.stringify(dconf)]
    );

    // Insert notes and cards
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const noteId = now * 1000 + i;
      const cardId = noteId + sentences.length;

      // Front: Chinese, Back: English + Pinyin
      const backParts = [s.english];
      if (s.pinyin) backParts.push(s.pinyin);
      const front = s.chinese;
      const back = backParts.join('<br>');
      const flds = `${front}\x1f${back}`;
      const tags = (s.tags || []).map(t => t.replace(/\s+/g, '_')).join(' ');

      // Simple checksum (Anki uses first 8 digits of sha1 of sort field as integer)
      const csum = simpleChecksum(front);

      // Generate a short guid
      const guid = base91Encode(noteId);

      db.run(
        'INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)',
        [noteId, guid, modelId, now, tags ? ` ${tags} ` : '', flds, front, csum, '']
      );

      // Card scheduling
      const sched = cardsBySentence.get(s.id);
      const cardType = sched?.state ?? 0;
      const queue = cardType === 0 ? 0 : (cardType === 2 ? 2 : 1);
      const ivl = sched ? Math.round(sched.scheduledDays) : 0;
      const factor = sched && sched.difficulty > 0
        ? Math.round((11 - sched.difficulty) / 4 * 1000)
        : 2500;
      const reps = sched?.reps ?? 0;
      const lapses = sched?.lapses ?? 0;

      // Due: for review cards, convert to day offset from col creation
      let due: number;
      if (cardType === 2 && sched) {
        due = Math.round((sched.due - now * 1000) / 86400000);
      } else if (cardType === 0) {
        due = i; // position in new card queue
      } else {
        due = sched ? Math.floor(sched.due / 1000) : 0;
      }

      // Store FSRS data in the data field
      const cardData = sched
        ? JSON.stringify({ s: sched.stability, d: sched.difficulty })
        : '{}';

      db.run(
        'INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)',
        [cardId, noteId, deckId, now, cardType, queue, due, ivl, factor, reps, lapses, cardData]
      );
    }

    // Export database to binary
    const dbData = db.export();
    const dbArray = new Uint8Array(dbData);

    // Create ZIP
    const apkgZip = new JSZip();
    apkgZip.file('collection.anki2', dbArray);
    apkgZip.file('media', '{}');

    return await apkgZip.generateAsync({ type: 'blob' });
  } finally {
    db.close();
  }
}

/** Download the .apkg export as a file. Returns sentence count. */
export async function downloadApkgExport(): Promise<number> {
  const sentences = await repo.getAllSentences();
  const count = sentences.length;

  const blob = await exportToApkg();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mandao-anki-export-${new Date().toISOString().slice(0, 10)}.apkg`;
  a.click();
  URL.revokeObjectURL(url);

  return count;
}

// ────────────────────────────────────────────────────────────
// Utility helpers
// ────────────────────────────────────────────────────────────

/** Simple numeric checksum (Anki uses field_checksum which is first 8 hex digits of sha1 as int) */
function simpleChecksum(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/** Base91 encode a number into a short string (Anki guid format) */
function base91Encode(num: number): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
  if (num === 0) return table[0];
  let result = '';
  let n = Math.abs(num);
  while (n > 0) {
    result = table[n % 91] + result;
    n = Math.floor(n / 91);
  }
  return result;
}
