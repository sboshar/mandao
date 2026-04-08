-- ============================================================
-- Sync RPCs for offline-first architecture.
-- These run as atomic Postgres transactions, replacing
-- multi-call client-side writes.
-- ============================================================

-- ============================================================
-- pull_changes: returns all rows modified since a given USN
-- ============================================================

create or replace function pull_changes(last_usn bigint, max_rows int default 1000)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb := '{}'::jsonb;
begin
  set local statement_timeout = '10s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select jsonb_build_object(
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
    'graves', coalesce((
      select jsonb_agg(row_to_json(g))
      from (select * from sync_graves where user_id = uid and usn > last_usn order by usn limit max_rows) g
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ============================================================
-- apply_review_ops: idempotent batch review application
-- Inserts review_logs (skipping duplicates by PK; the unique
-- index on op_id provides a second dedup layer).
-- Updates srs_cards only if last_answered_at is newer.
-- ============================================================

create or replace function apply_review_ops(ops jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := auth.uid();
  op jsonb;
  v_rating int;
  v_state int;
  v_due bigint;
  v_stability float;
  v_difficulty float;
  v_elapsed_days float;
  v_scheduled_days float;
  v_reviewed_at bigint;
  v_new_due bigint;
  v_new_stability float;
  v_new_difficulty float;
  v_new_elapsed_days float;
  v_new_scheduled_days float;
  v_new_reps int;
  v_new_lapses int;
  v_new_state int;
begin
  set local statement_timeout = '10s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for op in select * from jsonb_array_elements(ops)
  loop
    -- Verify the card belongs to this user
    if not exists (select 1 from srs_cards where id = op->>'card_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;

    -- Validate numeric casts upfront
    begin
      v_rating := (op->>'rating')::int;
      v_state := (op->>'state')::int;
      v_due := (op->>'due')::bigint;
      v_stability := (op->>'stability')::float;
      v_difficulty := (op->>'difficulty')::float;
      v_elapsed_days := (op->>'elapsed_days')::float;
      v_scheduled_days := (op->>'scheduled_days')::float;
      v_reviewed_at := (op->>'reviewed_at')::bigint;
      v_new_due := (op->>'new_due')::bigint;
      v_new_stability := (op->>'new_stability')::float;
      v_new_difficulty := (op->>'new_difficulty')::float;
      v_new_elapsed_days := (op->>'new_elapsed_days')::float;
      v_new_scheduled_days := (op->>'new_scheduled_days')::float;
      v_new_reps := (op->>'new_reps')::int;
      v_new_lapses := (op->>'new_lapses')::int;
      v_new_state := (op->>'new_state')::int;
    exception when others then
      raise exception 'Invalid field value in review op';
    end;

    -- Insert review log (idempotent via id PK)
    insert into review_logs (
      id, user_id, card_id, rating, state, due,
      stability, difficulty, elapsed_days, scheduled_days,
      reviewed_at, op_id, device_id
    ) values (
      op->>'id', uid, op->>'card_id',
      v_rating, v_state, v_due,
      v_stability, v_difficulty,
      v_elapsed_days, v_scheduled_days,
      v_reviewed_at, op->>'op_id', op->>'device_id'
    )
    on conflict (id) do nothing;

    -- Update card state only if this review is more recent
    update srs_cards set
      due = v_new_due,
      stability = v_new_stability,
      difficulty = v_new_difficulty,
      elapsed_days = v_new_elapsed_days,
      scheduled_days = v_new_scheduled_days,
      reps = v_new_reps,
      lapses = v_new_lapses,
      state = v_new_state,
      last_review = v_reviewed_at,
      last_answered_at = v_reviewed_at
    where id = op->>'card_id'
      and user_id = uid
      and (last_answered_at is null or last_answered_at < v_reviewed_at);
  end loop;
end;
$$;

-- ============================================================
-- apply_ingest_bundle: atomic sentence + tokens + cards insert
-- ============================================================

create or replace function apply_ingest_bundle(bundle jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m jsonb;
  ml jsonb;
  t jsonb;
  c jsonb;
  v_level int;
  v_created_at bigint;
  v_updated_at bigint;
  v_position int;
begin
  set local statement_timeout = '10s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Insert meanings (skip if already exists)
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
      id, user_id, headword, pinyin, pinyin_numeric,
      part_of_speech, english_short, english_full,
      type, level, created_at, updated_at
    ) values (
      m->>'id', uid, m->>'headword', m->>'pinyin', m->>'pinyin_numeric',
      m->>'part_of_speech', m->>'english_short', m->>'english_full',
      m->>'type', v_level, v_created_at, v_updated_at
    )
    on conflict (id) do nothing;
  end loop;

  -- Insert meaning links (verify referenced meanings belong to this user)
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

  -- Insert sentence (skip if already exists)
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

  -- Insert tokens (verify referenced sentence and meaning belong to this user)
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

  -- Insert SRS cards (verify referenced sentence and deck belong to this user)
  for c in select * from jsonb_array_elements(bundle->'cards')
  loop
    if not exists (select 1 from sentences where id = c->>'sentence_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;
    if not exists (select 1 from decks where id = c->>'deck_id' and user_id = uid) then
      raise exception 'Unauthorized operation';
    end if;

    declare
      v_due bigint;
      v_stability float;
      v_difficulty float;
      v_elapsed_days float;
      v_scheduled_days float;
      v_reps int;
      v_lapses int;
      v_state int;
      v_last_review bigint;
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
end;
$$;

-- ============================================================
-- apply_delete_ops: atomic deletes with tombstone insertion
-- ============================================================

create or replace function apply_delete_ops(ops jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
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

    -- Delete from the appropriate table (cascades handle children)
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
      else
        raise exception 'Unsupported entity_type';
    end case;

    -- Insert or update tombstone (dedup by user + entity_type + entity_id)
    insert into sync_graves (user_id, entity_type, entity_id)
    values (uid, etype, eid)
    on conflict (user_id, entity_type, entity_id)
    do update set
      usn = nextval('sync_usn_seq'),
      deleted_at = extract(epoch from now()) * 1000;
  end loop;
end;
$$;

-- ============================================================
-- delete_all_user_data: bulk wipe with tombstones so other
-- devices learn about the deletion via pull_changes.
-- ============================================================

create or replace function delete_all_user_data()
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  set local statement_timeout = '30s';

  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Batch-insert tombstones for all entity types at once
  insert into sync_graves (user_id, entity_type, entity_id, deleted_at)
  select uid, 'sentence', id, now_ms from sentences where user_id = uid
  union all
  select uid, 'meaning', id, now_ms from meanings where user_id = uid
  union all
  select uid, 'deck', id, now_ms from decks where user_id = uid
  on conflict (user_id, entity_type, entity_id)
  do update set usn = nextval('sync_usn_seq'), deleted_at = excluded.deleted_at;

  -- Delete actual data (FK cascades handle children)
  delete from sentences where user_id = uid;
  delete from meanings where user_id = uid;
  delete from decks where user_id = uid;
end;
$$;
