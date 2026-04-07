-- ============================================================
-- Mandao database schema for Supabase
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- Tables
-- ============================================================

create table meanings (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  headword text not null,
  pinyin text not null,
  pinyin_numeric text not null,
  part_of_speech text not null default '',
  english_short text not null,
  english_full text not null,
  type text not null check (type in ('word', 'character', 'component')),
  level int not null default 0,
  created_at bigint not null,
  updated_at bigint not null
);

create table meaning_links (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_meaning_id text not null references meanings(id) on delete cascade,
  child_meaning_id text not null references meanings(id) on delete cascade,
  position int not null,
  role text not null check (role in ('character', 'component', 'radical'))
);

create table sentences (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chinese text not null,
  english text not null,
  pinyin text not null,
  pinyin_sandhi text not null,
  audio_url text,
  source text not null default 'manual',
  tags text[] not null default '{}',
  created_at bigint not null
);

create table sentence_tokens (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sentence_id text not null references sentences(id) on delete cascade,
  meaning_id text not null references meanings(id) on delete cascade,
  position int not null,
  surface_form text not null,
  pinyin_sandhi text not null default ''
);

create table decks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  new_cards_per_day int not null default 20,
  reviews_per_day int not null default 200,
  created_at bigint not null
);

create table srs_cards (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sentence_id text not null references sentences(id) on delete cascade,
  deck_id text not null references decks(id) on delete cascade,
  review_mode text not null check (review_mode in ('en-to-zh', 'zh-to-en', 'py-to-en-zh')),
  due bigint not null,
  stability float not null default 0,
  difficulty float not null default 0,
  elapsed_days float not null default 0,
  scheduled_days float not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  state int not null default 0,
  last_review bigint,
  created_at bigint not null
);

create table review_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references srs_cards(id) on delete cascade,
  rating int not null check (rating between 1 and 4),
  state int not null,
  due bigint not null,
  stability float not null,
  difficulty float not null,
  elapsed_days float not null,
  scheduled_days float not null,
  reviewed_at bigint not null
);

-- ============================================================
-- Indexes
-- ============================================================

create index idx_meanings_user on meanings(user_id);
create index idx_meanings_headword on meanings(user_id, headword);
create index idx_meanings_pinyin on meanings(user_id, pinyin_numeric);
create index idx_meanings_type on meanings(user_id, type);

create index idx_meaning_links_user on meaning_links(user_id);
create index idx_meaning_links_parent on meaning_links(parent_meaning_id);
create index idx_meaning_links_child on meaning_links(child_meaning_id);

create index idx_sentences_user on sentences(user_id);
create index idx_sentences_created on sentences(user_id, created_at desc);
create index idx_sentences_chinese on sentences(user_id, chinese);

create index idx_sentence_tokens_user on sentence_tokens(user_id);
create index idx_sentence_tokens_sentence on sentence_tokens(sentence_id, position);
create index idx_sentence_tokens_meaning on sentence_tokens(meaning_id);

create index idx_decks_user on decks(user_id);

create index idx_srs_cards_user on srs_cards(user_id);
create index idx_srs_cards_deck_state on srs_cards(deck_id, state);
create index idx_srs_cards_deck_due on srs_cards(deck_id, due);
create index idx_srs_cards_sentence on srs_cards(sentence_id);

create index idx_review_logs_user on review_logs(user_id);
create index idx_review_logs_card on review_logs(card_id);
create index idx_review_logs_reviewed on review_logs(user_id, reviewed_at);

-- ============================================================
-- Row Level Security — users only see their own data
-- ============================================================

alter table meanings enable row level security;
alter table meaning_links enable row level security;
alter table sentences enable row level security;
alter table sentence_tokens enable row level security;
alter table decks enable row level security;
alter table srs_cards enable row level security;
alter table review_logs enable row level security;

-- Policy: users can CRUD their own rows
create policy "Users manage own meanings" on meanings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own meaning_links" on meaning_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own sentences" on sentences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own sentence_tokens" on sentence_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own decks" on decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own srs_cards" on srs_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own review_logs" on review_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Function: create default deck on user signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.decks (id, user_id, name, description, new_cards_per_day, reviews_per_day, created_at)
  values ('default-' || new.id, new.id, 'Default', 'Default deck', 20, 200, extract(epoch from now()) * 1000);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
