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
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb := '{}'::jsonb;
begin
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
-- Inserts review_logs (skipping duplicates by op_id),
-- updates srs_cards only if last_answered_at is newer.
-- ============================================================

create or replace function apply_review_ops(ops jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  op jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for op in select * from jsonb_array_elements(ops)
  loop
    -- Insert review log (idempotent via op_id)
    insert into review_logs (
      id, user_id, card_id, rating, state, due,
      stability, difficulty, elapsed_days, scheduled_days,
      reviewed_at, op_id, device_id
    ) values (
      op->>'id', uid, op->>'card_id',
      (op->>'rating')::int, (op->>'state')::int, (op->>'due')::bigint,
      (op->>'stability')::float, (op->>'difficulty')::float,
      (op->>'elapsed_days')::float, (op->>'scheduled_days')::float,
      (op->>'reviewed_at')::bigint, op->>'op_id', op->>'device_id'
    )
    on conflict (id) do nothing;

    -- Update card state only if this review is more recent
    update srs_cards set
      due = (op->>'new_due')::bigint,
      stability = (op->>'new_stability')::float,
      difficulty = (op->>'new_difficulty')::float,
      elapsed_days = (op->>'new_elapsed_days')::float,
      scheduled_days = (op->>'new_scheduled_days')::float,
      reps = (op->>'new_reps')::int,
      lapses = (op->>'new_lapses')::int,
      state = (op->>'new_state')::int,
      last_review = (op->>'reviewed_at')::bigint,
      last_answered_at = (op->>'reviewed_at')::bigint
    where id = op->>'card_id'
      and user_id = uid
      and (last_answered_at is null or last_answered_at < (op->>'reviewed_at')::bigint);
  end loop;
end;
$$;

-- ============================================================
-- apply_ingest_bundle: atomic sentence + tokens + cards insert
-- ============================================================

create or replace function apply_ingest_bundle(bundle jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m jsonb;
  ml jsonb;
  t jsonb;
  c jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Insert meanings (skip if already exists)
  for m in select * from jsonb_array_elements(bundle->'meanings')
  loop
    insert into meanings (
      id, user_id, headword, pinyin, pinyin_numeric,
      part_of_speech, english_short, english_full,
      type, level, created_at, updated_at
    ) values (
      m->>'id', uid, m->>'headword', m->>'pinyin', m->>'pinyin_numeric',
      m->>'part_of_speech', m->>'english_short', m->>'english_full',
      m->>'type', (m->>'level')::int, (m->>'created_at')::bigint, (m->>'updated_at')::bigint
    )
    on conflict (id) do nothing;
  end loop;

  -- Insert meaning links (skip if already exists)
  for ml in select * from jsonb_array_elements(bundle->'meaning_links')
  loop
    insert into meaning_links (
      id, user_id, parent_meaning_id, child_meaning_id, position, role
    ) values (
      ml->>'id', uid, ml->>'parent_meaning_id', ml->>'child_meaning_id',
      (ml->>'position')::int, ml->>'role'
    )
    on conflict (id) do nothing;
  end loop;

  -- Insert sentence (skip if already exists)
  insert into sentences (
    id, user_id, chinese, english, pinyin, pinyin_sandhi,
    audio_url, source, tags, created_at
  ) values (
    bundle->'sentence'->>'id', uid,
    bundle->'sentence'->>'chinese', bundle->'sentence'->>'english',
    bundle->'sentence'->>'pinyin', bundle->'sentence'->>'pinyin_sandhi',
    bundle->'sentence'->>'audio_url', bundle->'sentence'->>'source',
    (select array_agg(t.value::text) from jsonb_array_elements_text(bundle->'sentence'->'tags') t),
    (bundle->'sentence'->>'created_at')::bigint
  )
  on conflict (id) do nothing;

  -- Insert tokens
  for t in select * from jsonb_array_elements(bundle->'tokens')
  loop
    insert into sentence_tokens (
      id, user_id, sentence_id, meaning_id, position, surface_form, pinyin_sandhi
    ) values (
      t->>'id', uid, t->>'sentence_id', t->>'meaning_id',
      (t->>'position')::int, t->>'surface_form', t->>'pinyin_sandhi'
    )
    on conflict (id) do nothing;
  end loop;

  -- Insert SRS cards
  for c in select * from jsonb_array_elements(bundle->'cards')
  loop
    insert into srs_cards (
      id, user_id, sentence_id, deck_id, review_mode,
      due, stability, difficulty, elapsed_days, scheduled_days,
      reps, lapses, state, last_review, created_at
    ) values (
      c->>'id', uid, c->>'sentence_id', c->>'deck_id', c->>'review_mode',
      (c->>'due')::bigint, (c->>'stability')::float, (c->>'difficulty')::float,
      (c->>'elapsed_days')::float, (c->>'scheduled_days')::float,
      (c->>'reps')::int, (c->>'lapses')::int, (c->>'state')::int,
      case when c->>'last_review' = 'null' then null else (c->>'last_review')::bigint end,
      (c->>'created_at')::bigint
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
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  op jsonb;
  etype text;
  eid text;
begin
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
        raise exception 'Unknown entity_type: %', etype;
    end case;

    -- Insert tombstone
    insert into sync_graves (user_id, entity_type, entity_id)
    values (uid, etype, eid)
    on conflict (id) do nothing;
  end loop;
end;
$$;
