-- ============================================================
-- Audio recordings: user-captured audio clips attached to sentences.
--
-- Binary blobs live in Supabase Storage (bucket `audio-recordings`).
-- This table holds only metadata + a pointer to the Storage object.
--
-- Design invariants:
--   - All objects live under the path `{user_id}/{filename}`.
--     Enforced in two places (belt and braces):
--       1. Storage RLS policies on `storage.objects`.
--       2. A table check constraint on `audio_recordings.storage_path`.
--   - Deleting a row triggers deletion of the backing Storage object so
--     we never orphan bytes. Runs as security definer but can only hit
--     the exact `storage_path` value on the row, and that value is RLS-
--     and check-constraint-guarded to live inside the owner's folder.
--   - Per-file size capped at 2 MB; MIME types restricted to audio/*.
--     Typical opus voice clips land around 20–200 KB, so this is a
--     comfortable ceiling without enabling abuse.
-- ============================================================

-- ============================================================
-- 1. Storage bucket
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-recordings',
  'audio-recordings',
  false,
  2097152,  -- 2 MiB per file
  array['audio/*']  -- any audio mime; codec-qualified types (e.g. webm;codecs=opus) covered
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS
--    Path-prefix enforcement: a user can only touch objects whose
--    first path segment equals their uid. This is stricter than
--    the implicit `owner` column because `owner` is server-set and
--    doesn't prevent writing to other folders.
-- ============================================================

drop policy if exists "audio_recordings_read" on storage.objects;
drop policy if exists "audio_recordings_insert" on storage.objects;
drop policy if exists "audio_recordings_update" on storage.objects;
drop policy if exists "audio_recordings_delete" on storage.objects;

create policy "audio_recordings_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_recordings_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_recordings_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_recordings_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 3. Metadata table
-- ============================================================

create table if not exists audio_recordings (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sentence_id text not null references sentences(id) on delete cascade,
  name text not null,
  -- Path inside the `audio-recordings` bucket. Locked to a single filename
  -- under the owner's uid folder so traversal characters can't sneak in.
  -- See check constraint below + the immutable trigger.
  storage_path text not null,
  mime_type text not null,
  duration_ms int,
  source text not null check (source in ('voice-input', 'manual')),
  created_at bigint not null,
  updated_at bigint not null default 0,
  usn bigint not null default 0,
  constraint audio_recordings_path_owner_prefix
    check (storage_path ~ ('^' || user_id::text || '/[A-Za-z0-9._-]+$')),
  constraint audio_recordings_name_length
    check (length(name) between 1 and 200)
);

-- Re-apply constraints in-place for environments where the table already
-- exists from an earlier (looser) version of this migration.
alter table audio_recordings drop constraint if exists audio_recordings_path_owner_prefix;
alter table audio_recordings add constraint audio_recordings_path_owner_prefix
  check (storage_path ~ ('^' || user_id::text || '/[A-Za-z0-9._-]+$'));

alter table audio_recordings drop constraint if exists audio_recordings_name_length;
alter table audio_recordings add constraint audio_recordings_name_length
  check (length(name) between 1 and 200);

create index if not exists idx_audio_recordings_user
  on audio_recordings(user_id);
create index if not exists idx_audio_recordings_user_sentence
  on audio_recordings(user_id, sentence_id);
create index if not exists idx_audio_recordings_user_usn
  on audio_recordings(user_id, usn);

-- USN + updated_at trigger (matches 001_sync_metadata.sql convention)
drop trigger if exists trg_audio_recordings_sync on audio_recordings;
create trigger trg_audio_recordings_sync
  before insert or update on audio_recordings
  for each row execute function bump_sync_meta('with_updated_at');

-- storage_path is set at insert time and must never change. The delete
-- trigger trusts OLD.storage_path to point at the right Storage object,
-- so allowing a client to repoint it would let them target any file in
-- their own folder for deletion via a single update+delete.
create or replace function reject_audio_storage_path_change()
returns trigger language plpgsql as $func$
begin
  if NEW.storage_path is distinct from OLD.storage_path then
    raise exception 'audio_recordings.storage_path is immutable';
  end if;
  return NEW;
end;
$func$;

drop trigger if exists trg_audio_recordings_immutable_path on audio_recordings;
create trigger trg_audio_recordings_immutable_path
  before update on audio_recordings
  for each row execute function reject_audio_storage_path_change();

-- ============================================================
-- 4. Table RLS
-- ============================================================

alter table audio_recordings enable row level security;

drop policy if exists "Users manage own audio_recordings" on audio_recordings;
create policy "Users manage own audio_recordings" on audio_recordings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 5. Cascade Storage deletion when a row is removed.
--
--    Security: definer so we can bypass storage.objects RLS (which is
--    invoker-scoped) for housekeeping. Scope is limited to the exact
--    storage_path on the deleted row — and that column is constrained
--    to live under the owner's folder via check + RLS. A client cannot
--    trick this trigger into deleting another user's object.
-- ============================================================

create or replace function delete_audio_recording_object()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $func$
begin
  delete from storage.objects
  where bucket_id = 'audio-recordings'
    and name = OLD.storage_path;
  return OLD;
end;
$func$;

drop trigger if exists trg_audio_recordings_delete_object on audio_recordings;
create trigger trg_audio_recordings_delete_object
  after delete on audio_recordings
  for each row execute function delete_audio_recording_object();

-- ============================================================
-- 6. Extend pull_changes so clients receive new/changed rows.
--    Adds `audio_recordings` to the bundle. Older clients destructure
--    a fixed keyset and will silently ignore the new field, so this is
--    deploy-safe ahead of client work.
-- ============================================================

-- NOTE: Preserves the keyset established by migration 003
-- (meaning_fsrs replaces the legacy srs_cards). Adds audio_recordings.
create or replace function pull_changes(last_usn bigint, max_rows int default 1000)
returns jsonb
language plpgsql security invoker set search_path = public
as $func$
declare
  uid uuid := auth.uid();
begin
  set local statement_timeout = '10s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return jsonb_build_object(
    'meanings', coalesce((
      select jsonb_agg(row_to_json(m))
      from (select * from meanings where user_id = uid and usn > last_usn order by usn limit max_rows) m
    ), '[]'::jsonb),
    'meaning_links', coalesce((
      select jsonb_agg(row_to_json(ml))
      from (select * from meaning_links where user_id = uid and usn > last_usn order by usn limit max_rows) ml
    ), '[]'::jsonb),
    'sentences', coalesce((
      select jsonb_agg(row_to_json(s))
      from (select * from sentences where user_id = uid and usn > last_usn order by usn limit max_rows) s
    ), '[]'::jsonb),
    'sentence_tokens', coalesce((
      select jsonb_agg(row_to_json(st))
      from (select * from sentence_tokens where user_id = uid and usn > last_usn order by usn limit max_rows) st
    ), '[]'::jsonb),
    'decks', coalesce((
      select jsonb_agg(row_to_json(d))
      from (select * from decks where user_id = uid and usn > last_usn order by usn limit max_rows) d
    ), '[]'::jsonb),
    'meaning_fsrs', coalesce((
      select jsonb_agg(row_to_json(mf))
      from (select * from meaning_fsrs where user_id = uid and usn > last_usn order by usn limit max_rows) mf
    ), '[]'::jsonb),
    'review_logs', coalesce((
      select jsonb_agg(row_to_json(rl))
      from (select * from review_logs where user_id = uid and usn > last_usn order by usn limit max_rows) rl
    ), '[]'::jsonb),
    'audio_recordings', coalesce((
      select jsonb_agg(row_to_json(ar))
      from (select * from audio_recordings where user_id = uid and usn > last_usn order by usn limit max_rows) ar
    ), '[]'::jsonb),
    'graves', coalesce((
      select jsonb_agg(row_to_json(g))
      from (select * from sync_graves where user_id = uid and usn > last_usn order by usn limit max_rows) g
    ), '[]'::jsonb)
  );
end;
$func$;

-- ============================================================
-- 7. Extend apply_delete_ops with an `audio_recording` branch so
--    clients can route audio deletes through the existing graves
--    pipeline (no new SyncOpType needed).
-- ============================================================

-- NOTE: Preserves the case list established by migration 003 (meaning_fsrs
-- replaces srs_card). Adds audio_recording.
create or replace function apply_delete_ops(ops jsonb)
returns void
language plpgsql security invoker set search_path = public
as $func$
declare
  uid uuid := auth.uid();
  op jsonb;
  etype text;
  eid text;
begin
  set local statement_timeout = '10s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for op in select * from jsonb_array_elements(ops)
  loop
    etype := op->>'entity_type';
    eid := op->>'entity_id';

    case etype
      when 'sentence' then
        delete from sentences where id = eid and user_id = uid;
      when 'meaning' then
        delete from meanings where id = eid and user_id = uid;
      when 'deck' then
        delete from decks where id = eid and user_id = uid;
      when 'meaning_fsrs' then
        delete from meaning_fsrs where id = eid and user_id = uid;
      when 'review_log' then
        delete from review_logs where id = eid and user_id = uid;
      when 'meaning_link' then
        delete from meaning_links where id = eid and user_id = uid;
      when 'sentence_token' then
        delete from sentence_tokens where id = eid and user_id = uid;
      when 'audio_recording' then
        delete from audio_recordings where id = eid and user_id = uid;
      else
        raise exception 'Unsupported entity_type';
    end case;

    insert into sync_graves (user_id, entity_type, entity_id)
    values (uid, etype, eid)
    on conflict (user_id, entity_type, entity_id)
    do update set
      usn = nextval('sync_usn_seq'),
      deleted_at = extract(epoch from now()) * 1000;
  end loop;
end;
$func$;

-- ============================================================
-- 8. delete_all_user_data now also wipes audio_recordings.
--    Storage objects are cleared by the delete trigger
--    (trg_audio_recordings_delete_object) one row at a time.
-- ============================================================

-- NOTE: Preserves migration 003's behavior (FK cascades from meaning_fsrs
-- via meanings; no explicit tombstones for meaning_fsrs). Adds
-- audio_recordings tombstones + explicit delete so the AFTER DELETE
-- trigger runs per row and clears each Storage object. Ordering matters:
-- we delete audio_recordings *before* sentences so the trigger fires on
-- real rows rather than being bypassed by FK cascade (cascade deletes
-- still fire triggers, but making this explicit is cheap insurance).
create or replace function delete_all_user_data()
returns void
language plpgsql security invoker set search_path = public
as $func$
declare
  uid uuid := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  set local statement_timeout = '30s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Tombstones first so other devices learn about the deletion.
  insert into sync_graves (user_id, entity_type, entity_id, deleted_at)
  select uid, 'sentence', id, now_ms from sentences where user_id = uid
  union all
  select uid, 'meaning', id, now_ms from meanings where user_id = uid
  union all
  select uid, 'deck', id, now_ms from decks where user_id = uid
  union all
  select uid, 'audio_recording', id, now_ms from audio_recordings where user_id = uid
  on conflict (user_id, entity_type, entity_id)
  do update set usn = nextval('sync_usn_seq'), deleted_at = excluded.deleted_at;

  -- Delete rows. audio_recordings first so its delete trigger explicitly
  -- runs on each row and clears the Storage object.
  delete from audio_recordings where user_id = uid;
  delete from sentences where user_id = uid;
  delete from meaning_fsrs where user_id = uid;
  delete from meanings where user_id = uid;
  delete from decks where user_id = uid;
end;
$func$;
