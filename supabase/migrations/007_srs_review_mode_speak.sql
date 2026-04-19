-- ============================================================
-- Widen the srs_cards.review_mode CHECK constraint to include
-- the new 'speak' review mode. Mirrors migration 006.
--
-- New sentences now create a 5th card per sentence with
-- review_mode='speak'. Existing sentences are NOT backfilled —
-- only sentences added after this migration will have speak cards.
--
-- apply_ingest_bundle runs as one txn, so a missing value in the
-- CHECK list would roll back the entire sentence. Ship this
-- before (or with) the client change that emits 'speak' cards.
-- ============================================================

alter table srs_cards
  drop constraint if exists srs_cards_review_mode_check;

alter table srs_cards
  add constraint srs_cards_review_mode_check
  check (review_mode in ('en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type', 'speak'));
