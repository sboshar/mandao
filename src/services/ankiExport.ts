/**
 * Anki export service.
 * Exports all sentences as a tab-separated text file that Anki can import.
 */
import * as repo from '../db/repo';

/**
 * Export all sentences to a tab-separated text file for Anki import.
 * Format: Front (Chinese) \t Back (English + Pinyin) \t Tags \t FSRS data
 *
 * The first line is a header comment for Anki: #separator:tab
 * Subsequent lines are one card per row.
 */
export async function exportToAnkiTSV(): Promise<string> {
  const sentences = await repo.getAllSentences();
  if (sentences.length === 0) {
    throw new Error('No sentences to export.');
  }

  // Build a map of sentenceId -> best SRS card data (use zh-to-en as primary)
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
    // Prefer zh-to-en card as representative, fall back to any
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

  const lines: string[] = [];

  // Anki recognizes this directive
  lines.push('#separator:tab');
  lines.push('#columns:Front\tBack\tTags\tStability\tDifficulty\tState\tReps\tLapses\tDue\tElapsedDays\tScheduledDays\tLastReview');

  for (const s of sentences) {
    const front = s.chinese;
    // Combine English and pinyin for the back
    const backParts: string[] = [s.english];
    if (s.pinyin) backParts.push(s.pinyin);
    if (s.pinyinSandhi && s.pinyinSandhi !== s.pinyin) {
      backParts.push(`(sandhi: ${s.pinyinSandhi})`);
    }
    const back = backParts.join('<br>');

    // Anki tags use space-separated values; convert our array
    const tags = (s.tags || []).map((t) => t.replace(/\s+/g, '_')).join(' ');

    // FSRS scheduling data
    const card = cardsBySentence.get(s.id);
    const stability = card?.stability ?? '';
    const difficulty = card?.difficulty ?? '';
    const state = card?.state ?? '';
    const reps = card?.reps ?? '';
    const lapses = card?.lapses ?? '';
    const due = card?.due ?? '';
    const elapsedDays = card?.elapsedDays ?? '';
    const scheduledDays = card?.scheduledDays ?? '';
    const lastReview = card?.lastReview ?? '';

    // Escape any tabs or newlines in content
    const escape = (v: string) => v.replace(/\t/g, ' ').replace(/\n/g, '<br>');

    lines.push([
      escape(front),
      escape(back),
      escape(tags),
      stability,
      difficulty,
      state,
      reps,
      lapses,
      due,
      elapsedDays,
      scheduledDays,
      lastReview,
    ].join('\t'));
  }

  return lines.join('\n');
}

/** Trigger a browser download of the Anki TSV export. */
export async function downloadAnkiExport(): Promise<number> {
  const tsv = await exportToAnkiTSV();
  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mandao-anki-export-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  // Return sentence count for UI feedback
  const lineCount = tsv.split('\n').length - 2; // minus header lines
  return lineCount;
}
