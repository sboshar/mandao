import * as repo from '../db/repo';
import * as local from '../db/localRepo';

export interface OrphanMeaningReport {
  scanned: number;
  orphanedMeanings: number;
  orphanedLinks: number;
}

/**
 * One-off sweep for Meaning rows left behind by pre-fix sentence
 * deletes. Earlier versions deleted the sentence + tokens but kept the
 * Meaning rows forever, so old accounts accumulate disconnected rows.
 *
 * Builds the orphan closure from every Meaning currently in Dexie and
 * deletes the ones that have no sentence_token reference and no
 * surviving parent meaning_link. Enqueues the same deleteEntity ops
 * the normal sentence-delete path emits so the server catches up.
 *
 * This seeds findOrphanClosure with the full Meaning table, so the
 * closure computation touches every link + token row — O(whole
 * corpus). Intended for manual DevTools invocation only, not any hot
 * path.
 *
 * Run from DevTools after loading the app:
 *   await window.__cleanOrphanedMeanings()
 */
export async function cleanOrphanedMeanings(): Promise<OrphanMeaningReport> {
  const meanings = await repo.getAllMeanings();
  const { meanings: orphanedMeanings, links: orphanedLinks } =
    await local.findOrphanClosure(meanings.map((m) => m.id));

  if (orphanedLinks.length > 0) {
    await local.deleteMeaningLinksByIds(orphanedLinks);
  }
  if (orphanedMeanings.length > 0) {
    await local.deleteMeaningsByIds(orphanedMeanings);
  }

  await repo.enqueueOrphanDeletes(orphanedMeanings, orphanedLinks);

  return {
    scanned: meanings.length,
    orphanedMeanings: orphanedMeanings.length,
    orphanedLinks: orphanedLinks.length,
  };
}

export async function runCleanOrphanedMeaningsInConsole(): Promise<OrphanMeaningReport> {
  const report = await cleanOrphanedMeanings();
  console.log(
    `Orphan meanings sweep: scanned ${report.scanned}, removed ` +
      `${report.orphanedMeanings} meanings + ${report.orphanedLinks} links.`,
  );
  return report;
}
