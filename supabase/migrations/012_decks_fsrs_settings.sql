-- ============================================================
-- Migration: decks.fsrs_settings
--
-- Persist FSRS scheduling parameters (requestRetention, learning steps,
-- enableFuzz, enableShortTerm, maximumInterval, and — once the optimizer
-- ships — the 19 weights) on the deck row so they sync across devices.
--
-- Stored as jsonb so adding new keys (e.g. the optimizer's weight vector)
-- doesn't require another migration. Defaults to '{}'; the client falls
-- back to its hardcoded defaults whenever the column is empty.
--
-- The existing trg_decks_sync trigger (migration 001) automatically bumps
-- usn + updated_at on update, so pull picks up the change without RPC
-- changes (pull_changes uses row_to_json so new columns flow through).
-- ============================================================

alter table decks
  add column if not exists fsrs_settings jsonb not null default '{}'::jsonb;
