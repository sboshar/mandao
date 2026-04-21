import * as repo from '../db/repo';
import { localDb } from '../db/localDb';
import { enqueueSync } from '../db/repo';
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

  for (const linkId of orphanedLinks) {
    await enqueueSync({
      op: 'deleteEntity',
      payload: { entity_type: 'meaning_link', entity_id: linkId },
    });
  }
  for (const mId of orphanedMeanings) {
    await enqueueSync({
      op: 'deleteEntity',
      payload: { entity_type: 'meaning', entity_id: mId },
    });
  }

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
  // Mark-as-used so unused-var lint won't gripe at localDb being pulled
  // in via tree-shaking hygiene from repo.ts.
  void localDb;
  return report;
}
