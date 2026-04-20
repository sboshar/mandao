import * as repo from '../db/repo';
import { numericStringToDiacritic } from '../services/toneSandhi';
import { loadCedict, lookup } from './cedict';
import type { Meaning } from '../db/schema';

export interface AuditRow {
  id: string;
  headword: string;
  pinyin: string;
  pinyinNumeric: string;
  derivedDiacritic: string;
  diacriticMismatch: boolean;
  cedictMismatch: boolean;
  cedictEntries: string[];
}

export interface AuditReport {
  totalMeanings: number;
  diacriticMismatches: AuditRow[];
  cedictMismatches: AuditRow[];
}

function stripSpaces(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/**
 * Scan every Meaning and flag:
 *   (a) stored diacritic != derived-from-numeric
 *   (b) numeric pinyin does not match any CC-CEDICT entry for the headword
 *
 * CEDICT pinyin is space-separated numeric ("ni3 hao3"), matching our pinyinNumeric.
 * Case-insensitive; whitespace normalized.
 */
export async function auditPinyin(): Promise<AuditReport> {
  await loadCedict();
  const meanings: Meaning[] = await repo.getAllMeanings();

  const diacriticMismatches: AuditRow[] = [];
  const cedictMismatches: AuditRow[] = [];

  for (const m of meanings) {
    const derived = numericStringToDiacritic(m.pinyinNumeric);
    // `pinyin` only exists on rows loaded before migration 008. After
    // the migration drops the column it's undefined; the diacritic
    // mismatch check simply reports no drift.
    const storedPinyin = (m as unknown as { pinyin?: string }).pinyin ?? '';
    const entries = lookup(m.headword);
    const cedictPinyins = entries.map((e) => e.pinyin);

    const diacriticMismatch =
      storedPinyin !== '' && storedPinyin.trim() !== derived.trim();
    const cedictMismatch =
      entries.length > 0 &&
      !cedictPinyins.some(
        (p) => stripSpaces(p) === stripSpaces(m.pinyinNumeric),
      );

    const row: AuditRow = {
      id: m.id,
      headword: m.headword,
      pinyin: storedPinyin,
      pinyinNumeric: m.pinyinNumeric,
      derivedDiacritic: derived,
      diacriticMismatch,
      cedictMismatch,
      cedictEntries: cedictPinyins,
    };

    if (diacriticMismatch) diacriticMismatches.push(row);
    if (cedictMismatch) cedictMismatches.push(row);
  }

  return {
    totalMeanings: meanings.length,
    diacriticMismatches,
    cedictMismatches,
  };
}

/**
 * Pretty-print an audit report to the console. Call from DevTools:
 *   await window.__auditPinyin()
 */
export async function runAuditInConsole(): Promise<AuditReport> {
  const report = await auditPinyin();
  console.log(
    `Audited ${report.totalMeanings} meanings — ` +
      `${report.diacriticMismatches.length} diacritic drift, ` +
      `${report.cedictMismatches.length} CEDICT mismatch`,
  );
  if (report.diacriticMismatches.length > 0) {
    console.group('Diacritic drift (stored pinyin != derived from numeric)');
    console.table(
      report.diacriticMismatches.map((r) => ({
        headword: r.headword,
        stored: r.pinyin,
        numeric: r.pinyinNumeric,
        derived: r.derivedDiacritic,
      })),
    );
    console.groupEnd();
  }
  if (report.cedictMismatches.length > 0) {
    console.group('CEDICT mismatch (numeric not in CC-CEDICT for this headword)');
    console.table(
      report.cedictMismatches.map((r) => ({
        headword: r.headword,
        stored: r.pinyinNumeric,
        cedict: r.cedictEntries.join(' | '),
      })),
    );
    console.groupEnd();
  }
  return report;
}
