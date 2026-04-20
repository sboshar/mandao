-- ============================================================
-- Migration: meaning_flags table
--
-- Audit trail of write-time pinyin resolutions where LLM output
-- disagreed with CEDICT or fell outside CEDICT's coverage. Populated by
-- the ingest pipeline's resolvePinyin() step.
--
-- flag_kind values:
--   'auto-corrected'      — 1 CEDICT entry for headword; LLM's value
--                           differed and was overwritten silently.
--   'polyphone-coerced'   — ≥2 CEDICT entries; LLM's value was close
--                           (edit distance ≤ 1) to a valid reading and
--                           was snapped to that reading.
--   'cedict-disagreement' — ≥2 CEDICT entries; LLM's value wasn't any
--                           of them and wasn't close. LLM's value kept;
--                           flagged for manual review.
--   'cedict-unknown'      — CEDICT has no entry for this headword.
--                           LLM's value kept; flagged so the user can
--                           verify neologism / rare-word pronunciations.
--   'user-report'         — user explicitly reported a wrong pinyin
--                           via UI (future PR).
--
-- resolution (nullable):
--   null          — unresolved, still in review queue
--   'confirmed'   — user verified the current stored value
--   'corrected'   — user fixed the pinyin (stored_pinyin at flag time
--                   differs from meanings.pinyin_numeric now)
--   'dismissed'   — user marked this not worth tracking
-- ============================================================

create table meaning_flags (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  meaning_id text references meanings(id) on delete cascade,
  headword text not null,
  stored_pinyin text not null,
  llm_value text,
  flag_kind text not null check (flag_kind in (
    'auto-corrected', 'polyphone-coerced', 'cedict-disagreement',
    'cedict-unknown', 'user-report'
  )),
  cedict_suggestions text[] not null default '{}'::text[],
  created_at bigint not null,
  resolved_at bigint,
  resolution text check (resolution in ('confirmed', 'corrected', 'dismissed')),
  usn bigint not null default nextval('sync_usn_seq')
);

create index idx_meaning_flags_user_unresolved on meaning_flags(user_id, resolved_at)
  where resolved_at is null;
create index idx_meaning_flags_meaning on meaning_flags(meaning_id);
create index idx_meaning_flags_user_usn on meaning_flags(user_id, usn);

alter table meaning_flags enable row level security;

drop policy if exists "Users manage own meaning_flags" on meaning_flags;
create policy "Users manage own meaning_flags" on meaning_flags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Touch usn on update so clients can sync edits (resolution changes).
create or replace function bump_meaning_flags_usn()
returns trigger
language plpgsql
as $func$
begin
  new.usn := nextval('sync_usn_seq');
  return new;
end;
$func$;

drop trigger if exists trg_meaning_flags_bump_usn on meaning_flags;
create trigger trg_meaning_flags_bump_usn
  before update on meaning_flags
  for each row execute function bump_meaning_flags_usn();

-- Extend pull_changes + apply_delete_ops so clients can sync flags.
-- We drop the old pull_changes and recreate it from migration 005's
-- shape, adding meaning_flags alongside audio_recordings.
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
    'srs_cards', coalesce((
      select jsonb_agg(row_to_json(c))
      from (select * from srs_cards where user_id = uid and usn > last_usn order by usn limit max_rows) c
    ), '[]'::jsonb),
    'review_logs', coalesce((
      select jsonb_agg(row_to_json(rl))
      from (select * from review_logs where user_id = uid and usn > last_usn order by usn limit max_rows) rl
    ), '[]'::jsonb),
    'audio_recordings', coalesce((
      select jsonb_agg(row_to_json(ar))
      from (select * from audio_recordings where user_id = uid and usn > last_usn order by usn limit max_rows) ar
    ), '[]'::jsonb),
    'meaning_flags', coalesce((
      select jsonb_agg(row_to_json(mf))
      from (select * from meaning_flags where user_id = uid and usn > last_usn order by usn limit max_rows) mf
    ), '[]'::jsonb),
    'graves', coalesce((
      select jsonb_agg(row_to_json(g))
      from (select * from sync_graves where user_id = uid and usn > last_usn order by usn limit max_rows) g
    ), '[]'::jsonb)
  );
end;
$func$;

-- Extend apply_ingest_bundle to accept meaning_flags alongside meanings.
-- Flags created during resolvePinyin are pushed in the same bundle so
-- the audit entry commits atomically with the sentence ingest.
create or replace function apply_ingest_bundle(bundle jsonb)
returns void
language plpgsql security invoker set search_path = public
as $func$
declare
  uid uuid := auth.uid();
  m jsonb;
  ml jsonb;
  t jsonb;
  c jsonb;
  mf jsonb;
  v_level int;
  v_created_at bigint;
  v_updated_at bigint;
  v_position int;
  v_due bigint;
  v_stability float;
  v_difficulty float;
  v_elapsed_days float;
  v_scheduled_days float;
  v_reps int;
  v_lapses int;
  v_state int;
  v_last_review bigint;
  v_flag_created_at bigint;
begin
  set local statement_timeout = '10s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for m in select * from jsonb_array_elements(bundle->'meanings')
  loop
    begin
      v_level := (m->>'level')::int;
      v_created_at := (m->>'created_at')::bigint;
      v_updated_at := (m->>'updated_at')::bigint;
    exception when others then
      raise exception 'Invalid field value in meaning';
    end;

    insert into meanings (
      id, user_id, headword, pinyin_numeric,
      part_of_speech, english_short, english_full,
      type, level, created_at, updated_at
    ) values (
      m->>'id', uid, m->>'headword', m->>'pinyin_numeric',
      m->>'part_of_speech', m->>'english_short', m->>'english_full',
      m->>'type', v_level, v_created_at, v_updated_at
    )
    on conflict (id) do nothing;
  end loop;

  for ml in select * from jsonb_array_elements(bundle->'meaning_links')
  loop
    if not exists (select 1 from meanings where id = ml->>'parent_meaning_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;
    if not exists (select 1 from meanings where id = ml->>'child_meaning_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;

    begin
      v_position := (ml->>'position')::int;
    exception when others then
      raise exception 'Invalid field value in meaning_link';
    end;

    insert into meaning_links (
      id, user_id, parent_meaning_id, child_meaning_id, position, role
    ) values (
      ml->>'id', uid, ml->>'parent_meaning_id', ml->>'child_meaning_id',
      v_position, ml->>'role'
    )
    on conflict (id) do nothing;
  end loop;

  begin
    v_created_at := (bundle->'sentence'->>'created_at')::bigint;
  exception when others then
    raise exception 'Invalid field value in sentence';
  end;

  insert into sentences (
    id, user_id, chinese, english, pinyin, pinyin_sandhi,
    audio_url, source, tags, created_at
  ) values (
    bundle->'sentence'->>'id', uid,
    bundle->'sentence'->>'chinese', bundle->'sentence'->>'english',
    bundle->'sentence'->>'pinyin', bundle->'sentence'->>'pinyin_sandhi',
    bundle->'sentence'->>'audio_url', bundle->'sentence'->>'source',
    coalesce(
      (select array_agg(t.value::text) from jsonb_array_elements_text(bundle->'sentence'->'tags') t),
      '{}'::text[]
    ),
    v_created_at
  )
  on conflict (id) do nothing;

  for t in select * from jsonb_array_elements(bundle->'tokens')
  loop
    if not exists (select 1 from sentences where id = t->>'sentence_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;
    if not exists (select 1 from meanings where id = t->>'meaning_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;

    begin
      v_position := (t->>'position')::int;
    exception when others then
      raise exception 'Invalid field value in token';
    end;

    insert into sentence_tokens (
      id, user_id, sentence_id, meaning_id, position, surface_form, pinyin_sandhi
    ) values (
      t->>'id', uid, t->>'sentence_id', t->>'meaning_id',
      v_position, t->>'surface_form', t->>'pinyin_sandhi'
    )
    on conflict (id) do nothing;
  end loop;

  for c in select * from jsonb_array_elements(bundle->'cards')
  loop
    if not exists (select 1 from sentences where id = c->>'sentence_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;
    if not exists (select 1 from decks where id = c->>'deck_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;

    begin
      v_due := (c->>'due')::bigint;
      v_stability := (c->>'stability')::float;
      v_difficulty := (c->>'difficulty')::float;
      v_elapsed_days := (c->>'elapsed_days')::float;
      v_scheduled_days := (c->>'scheduled_days')::float;
      v_reps := (c->>'reps')::int;
      v_lapses := (c->>'lapses')::int;
      v_state := (c->>'state')::int;
      v_last_review := case when c->>'last_review' = 'null' then null else (c->>'last_review')::bigint end;
      v_created_at := (c->>'created_at')::bigint;
    exception when others then
      raise exception 'Invalid field value in srs_card';
    end;

    insert into srs_cards (
      id, user_id, sentence_id, deck_id, review_mode,
      due, stability, difficulty, elapsed_days, scheduled_days,
      reps, lapses, state, last_review, created_at
    ) values (
      c->>'id', uid, c->>'sentence_id', c->>'deck_id', c->>'review_mode',
      v_due, v_stability, v_difficulty,
      v_elapsed_days, v_scheduled_days,
      v_reps, v_lapses, v_state,
      v_last_review, v_created_at
    )
    on conflict (id) do nothing;
  end loop;

  for mf in select * from jsonb_array_elements(coalesce(bundle->'meaning_flags', '[]'::jsonb))
  loop
    begin
      v_flag_created_at := (mf->>'created_at')::bigint;
    exception when others then
      raise exception 'Invalid field value in meaning_flag';
    end;

    insert into meaning_flags (
      id, user_id, meaning_id, headword, stored_pinyin, llm_value,
      flag_kind, cedict_suggestions, created_at
    ) values (
      mf->>'id', uid, mf->>'meaning_id', mf->>'headword',
      mf->>'stored_pinyin', mf->>'llm_value', mf->>'flag_kind',
      coalesce(
        (select array_agg(v.value::text) from jsonb_array_elements_text(mf->'cedict_suggestions') v),
        '{}'::text[]
      ),
      v_flag_created_at
    )
    on conflict (id) do nothing;
  end loop;
end;
$func$;

-- Add meaning_flag to apply_delete_ops + apply_delete_ops grave logging.
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
      when 'srs_card' then
        delete from srs_cards where id = eid and user_id = uid;
      when 'review_log' then
        delete from review_logs where id = eid and user_id = uid;
      when 'meaning_link' then
        delete from meaning_links where id = eid and user_id = uid;
      when 'sentence_token' then
        delete from sentence_tokens where id = eid and user_id = uid;
      when 'audio_recording' then
        delete from audio_recordings where id = eid and user_id = uid;
      when 'meaning_flag' then
        delete from meaning_flags where id = eid and user_id = uid;
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
