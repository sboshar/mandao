-- ============================================================
-- Patch: delete_all_user_data must leave a usable default deck.
--
-- The RPC previously wiped every row in `decks` for the user,
-- including the auto-created `default-<uid>` deck created by the
-- `handle_new_user` signup trigger. That left the account with no
-- deck on the server. The next call to `ensureDefaultDeck` recreated
-- a deck with the same deterministic id locally only, and the next
-- `apply_ingest_bundle` (e.g. adding a sentence) rejected with
-- `Unauthorized operation` because the referenced `deck_id` no
-- longer existed server-side for this user.
--
-- Fix: skip the default deck in the delete pass instead of trying
-- to re-create it. The deck row stays in place across the wipe,
-- preserving the user's deck-level settings (newCardsPerDay,
-- reviewsPerDay) — which Anki also preserves across a data wipe —
-- and avoids re-emitting the same row shape that `handle_new_user`
-- already encodes. No tombstone is emitted for it either, since
-- the row didn't actually go away.
-- ============================================================

create or replace function delete_all_user_data()
returns void
language plpgsql security invoker set search_path = public
as $func$
declare
  uid uuid := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  default_deck_id text := 'default-' || uid::text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  set local statement_timeout = '30s';

  insert into sync_graves (user_id, entity_type, entity_id, deleted_at)
  select uid, 'sentence', id, now_ms from sentences where user_id = uid
  union all
  select uid, 'meaning', id, now_ms from meanings where user_id = uid
  union all
  select uid, 'deck', id, now_ms from decks where user_id = uid and id <> default_deck_id
  union all
  select uid, 'audio_recording', id, now_ms from audio_recordings where user_id = uid
  on conflict (user_id, entity_type, entity_id)
  do update set usn = nextval('sync_usn_seq'), deleted_at = excluded.deleted_at;

  delete from audio_recordings where user_id = uid;
  delete from sentences where user_id = uid;
  delete from meanings where user_id = uid;
  delete from decks where user_id = uid and id <> default_deck_id;
end;
$func$;
