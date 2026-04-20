import { supabase } from './supabase';

export const AUDIO_BUCKET = 'audio-recordings';

/** Supabase Storage caps each remove() request at 1000 keys. */
const REMOVE_BATCH_SIZE = 1000;

/**
 * Delete storage objects best-effort. Called after a successful local +
 * server row delete, to clean up the backing Storage blob. Failures
 * are logged but never thrown — the row is already gone; orphaned
 * blobs can be reaped by the backfill helper.
 *
 * Filters out null/undefined/empty paths (a recording may not have
 * uploaded yet, in which case there's no blob to delete).
 */
export async function removeStorageObjects(
  paths: (string | null | undefined)[],
): Promise<void> {
  const real = paths.filter((p): p is string => !!p);
  if (real.length === 0) return;
  for (let i = 0; i < real.length; i += REMOVE_BATCH_SIZE) {
    const chunk = real.slice(i, i + REMOVE_BATCH_SIZE);
    try {
      const { error } = await supabase.storage.from(AUDIO_BUCKET).remove(chunk);
      if (error) console.warn('removeStorageObjects failed', error);
    } catch (e) {
      console.warn('removeStorageObjects threw', e);
    }
  }
}
