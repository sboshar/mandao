-- ============================================================
-- Meanings: flag phonetic loanwords so the UI can label them and
-- skip misleading character-by-character glosses.
--
-- Example: 汉堡 (hànbǎo) = hamburger. The characters 汉 and 堡
-- approximate the English sound; they do NOT compose semantically
-- into "hamburger". We still store character MeaningLinks (the
-- characters exist in the word), but their english is a phonetic
-- gloss rather than a fabricated literal meaning.
-- ============================================================

alter table meanings
  add column if not exists is_transliteration boolean not null default false;

-- Extend apply_ingest_bundle to persist the flag on insert.
-- Other columns and semantics are unchanged.
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
      type, level, is_transliteration, created_at, updated_at
    ) values (
      m->>'id', uid, m->>'headword', m->>'pinyin', m->>'pinyin_numeric',
      m->>'part_of_speech', m->>'english_short', m->>'english_full',
      m->>'type', v_level,
      coalesce((m->>'is_transliteration')::boolean, false),
      v_created_at, v_updated_at
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
