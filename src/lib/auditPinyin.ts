import * as repo from '../db/repo';
import { numericStringToDiacritic } from '../services/toneSandhi';
import { loadCedict, lookup } from './cedict';
import { collapsePinyin } from './checkPinyin';
import { localDb } from '../db/localDb';
import { supabase } from './supabase';
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
        (p) => collapsePinyin(p) === collapsePinyin(m.pinyinNumeric),
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

export interface RepairSummary {
  scanned: number;
  repaired: Array<{ headword: string; before: string; after: string }>;
  skipped: Array<{ headword: string; stored: string; reason: string }>;
}

/**
 * Overwrite pinyinNumeric on every CEDICT-mismatched Meaning with the
 * first CEDICT entry for that headword. Updates Dexie + Supabase
 * directly (no outbox op — this is a test-data cleanup helper, not a
 * normal edit path). Rows whose headword isn't in CEDICT are skipped.
 *
 * Call from DevTools:
 *   await window.__repairPinyin()
 */
export async function repairFlaggedPinyin(): Promise<RepairSummary> {
  const report = await auditPinyin();
  const repaired: RepairSummary['repaired'] = [];
  const skipped: RepairSummary['skipped'] = [];

  for (const row of report.cedictMismatches) {
    if (row.cedictEntries.length === 0) {
      skipped.push({
        headword: row.headword,
        stored: row.pinyinNumeric,
        reason: 'headword not in CEDICT',
      });
      continue;
    }
    const canonical = row.cedictEntries[0].toLowerCase();
    if (canonical === row.pinyinNumeric.toLowerCase()) continue;

    await localDb.meanings.update(row.id, {
      pinyinNumeric: canonical,
      updatedAt: Date.now(),
    });
    const { error } = await supabase
      .from('meanings')
      .update({ pinyin_numeric: canonical, updated_at: Date.now() })
      .eq('id', row.id);
    if (error) {
      skipped.push({
        headword: row.headword,
        stored: row.pinyinNumeric,
        reason: `supabase update failed: ${error.message}`,
      });
      continue;
    }

    repaired.push({
      headword: row.headword,
      before: row.pinyinNumeric,
      after: canonical,
    });
  }

  return { scanned: report.cedictMismatches.length, repaired, skipped };
}

/**
 * Console wrapper for repairFlaggedPinyin. Call from DevTools:
 *   await window.__repairPinyin()
 */
export async function runRepairInConsole(): Promise<RepairSummary> {
  const summary = await repairFlaggedPinyin();
  console.log(
    `Scanned ${summary.scanned} flagged rows — ` +
      `${summary.repaired.length} repaired, ${summary.skipped.length} skipped`,
  );
  if (summary.repaired.length > 0) {
    console.group('Repaired');
    console.table(summary.repaired);
    console.groupEnd();
  }
  if (summary.skipped.length > 0) {
    console.group('Skipped');
    console.table(summary.skipped);
    console.groupEnd();
  }
  return summary;
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
