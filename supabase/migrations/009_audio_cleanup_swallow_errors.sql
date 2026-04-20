-- ============================================================
-- Migration: don't let storage.objects protection block row deletes
--
-- Migration 004 added an AFTER DELETE trigger on audio_recordings that
-- ran `delete from storage.objects ...` to clean up the audio blob.
-- A Supabase platform update now rejects ANY direct DELETE on
-- storage.objects with:
--   "Direct deletion from storage tables is not allowed. Use the
--    Storage API instead."
-- regardless of RLS or SECURITY DEFINER.
--
-- Result: any cascade that touches audio_recordings (deleting a
-- sentence, clearing data) fails in the sync RPC, and the whole
-- transaction rolls back.
--
-- Hotfix: wrap the storage delete in a savepoint so the exception is
-- swallowed. The audio_recording row still gets removed; only the
-- backing Storage object is orphaned. Proper cleanup (via the Storage
-- HTTP API from a client or edge function) is tracked separately.
-- ============================================================

create or replace function delete_audio_recording_object()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $func$
begin
  begin
    delete from storage.objects
    where bucket_id = 'audio-recordings'
      and name = OLD.storage_path;
  exception when others then
    -- Platform protection or any other failure — log and continue so
    -- the outer DELETE on audio_recordings still commits.
    raise warning 'audio cleanup failed for %: %', OLD.storage_path, SQLERRM;
  end;
  return OLD;
end;
$func$;
