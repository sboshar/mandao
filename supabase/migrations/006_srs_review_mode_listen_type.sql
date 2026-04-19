-- ============================================================
-- Align the srs_cards.review_mode CHECK constraint with the 4
-- review modes the client has been emitting since #76:
--   en-to-zh, zh-to-en, py-to-en-zh, listen-type
--
-- `schema.sql` was updated when listen-type was added, but no
-- migration was written, so already-provisioned databases still
-- reject listen-type (and, depending on provisioning vintage,
-- possibly py-to-en-zh). apply_ingest_bundle runs as one txn, so
-- the failing card insert rolls back the entire sentence + all
-- its meanings, producing the "save looks fine locally but the
-- data disappears after sign out" symptom.
-- ============================================================

alter table srs_cards
  drop constraint if exists srs_cards_review_mode_check;

alter table srs_cards
  add constraint srs_cards_review_mode_check
  check (review_mode in ('en-to-zh', 'zh-to-en', 'py-to-en-zh', 'listen-type'));
