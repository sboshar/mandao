-- ============================================================
-- Sync metadata for offline-first architecture
-- Run this after the base schema is in place.
-- ============================================================

-- Global monotonic sequence for sync ordering (Anki-style USN)
create sequence if not exists sync_usn_seq;

-- ============================================================
-- Add usn + updated_at to all mutable tables
-- ============================================================

-- meanings already has updated_at; add usn
alter table meanings add column if not exists usn bigint not null default 0;

-- sentences: add updated_at + usn
alter table sentences add column if not exists updated_at bigint not null default 0;
alter table sentences add column if not exists usn bigint not null default 0;

-- decks: add updated_at + usn
alter table decks add column if not exists updated_at bigint not null default 0;
alter table decks add column if not exists usn bigint not null default 0;

-- srs_cards: add updated_at + usn + last_answered_at
alter table srs_cards add column if not exists updated_at bigint not null default 0;
alter table srs_cards add column if not exists usn bigint not null default 0;
alter table srs_cards add column if not exists last_answered_at bigint;

-- meaning_links: add usn
alter table meaning_links add column if not exists usn bigint not null default 0;

-- sentence_tokens: add usn
alter table sentence_tokens add column if not exists usn bigint not null default 0;

-- review_logs: add usn + idempotency fields
alter table review_logs add column if not exists usn bigint not null default 0;
alter table review_logs add column if not exists op_id text;
alter table review_logs add column if not exists device_id text;

-- Unique index on op_id for idempotent review inserts (nulls ignored)
create unique index if not exists idx_review_logs_op_id
  on review_logs(op_id) where op_id is not null;

-- ============================================================
-- Trigger: auto-bump usn + updated_at on every insert/update
-- ============================================================

create or replace function bump_sync_meta()
returns trigger as $$
begin
  NEW.usn = nextval('sync_usn_seq');
  -- Only bump updated_at if the column exists on this table
  if TG_ARGV[0] = 'with_updated_at' then
    NEW.updated_at = extract(epoch from now()) * 1000;
  end if;
  return NEW;
end;
$$ language plpgsql;

-- Tables with updated_at
create trigger trg_meanings_sync before insert or update on meanings
  for each row execute function bump_sync_meta('with_updated_at');

create trigger trg_sentences_sync before insert or update on sentences
  for each row execute function bump_sync_meta('with_updated_at');

create trigger trg_decks_sync before insert or update on decks
  for each row execute function bump_sync_meta('with_updated_at');

create trigger trg_srs_cards_sync before insert or update on srs_cards
  for each row execute function bump_sync_meta('with_updated_at');

-- Tables without updated_at (append-only or link tables)
create trigger trg_meaning_links_sync before insert or update on meaning_links
  for each row execute function bump_sync_meta('no_updated_at');

create trigger trg_sentence_tokens_sync before insert or update on sentence_tokens
  for each row execute function bump_sync_meta('no_updated_at');

create trigger trg_review_logs_sync before insert or update on review_logs
  for each row execute function bump_sync_meta('no_updated_at');

-- ============================================================
-- Sync graves: tombstones for deleted records
-- ============================================================

create table if not exists sync_graves (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  usn bigint not null default nextval('sync_usn_seq'),
  deleted_at bigint not null default (extract(epoch from now()) * 1000)
);

create index if not exists idx_sync_graves_user_usn on sync_graves(user_id, usn);

alter table sync_graves enable row level security;

create policy "Users manage own sync_graves" on sync_graves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Schema version tracking (for forced full-sync detection)
-- ============================================================

create table if not exists sync_schema (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version int not null default 1,
  updated_at bigint not null default (extract(epoch from now()) * 1000)
);

alter table sync_schema enable row level security;

create policy "Users manage own sync_schema" on sync_schema
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Indexes for sync pull queries (WHERE usn > last_usn)
-- ============================================================

create index if not exists idx_meanings_usn on meanings(user_id, usn);
create index if not exists idx_sentences_usn on sentences(user_id, usn);
create index if not exists idx_decks_usn on decks(user_id, usn);
create index if not exists idx_srs_cards_usn on srs_cards(user_id, usn);
create index if not exists idx_meaning_links_usn on meaning_links(user_id, usn);
create index if not exists idx_sentence_tokens_usn on sentence_tokens(user_id, usn);
create index if not exists idx_review_logs_usn on review_logs(user_id, usn);
