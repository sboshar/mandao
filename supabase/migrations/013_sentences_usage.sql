-- ============================================================
-- Migration: sentences.usage
--
-- LLM-written notes on when a sentence is used (#212): register,
-- spoken/written medium, the speech act it performs, a few sentences of
-- prose on how and when you would meet it, concrete situations, and an
-- optional caution about where it would land wrong.
--
-- Stored as jsonb, not as columns. The shape is a snapshot of one model's
-- answer and will grow (a fifth field, a per-field confidence, a second
-- opinion from another model); each of those as a column would be its own
-- migration, and none of them is ever queried or filtered on — the whole
-- object is read and written together by the client.
--
-- Nullable with no default. NULL means "never generated", which is the
-- state of every existing row and of every sentence added on a device
-- with no API key; '{}' would be indistinguishable from a model that
-- answered with nothing.
--
-- No RPC change needed:
--   - writes arrive as an RLS-protected direct update from the client's
--     outbox (op 'updateSentenceUsage'), not through apply_ingest_bundle;
--   - the trg_sentences_sync trigger (migration 001) bumps usn +
--     updated_at on update, so other devices see the change;
--   - pull_changes (migration 002) selects rows with row_to_json, so the
--     new column flows through to clients untouched.
-- ============================================================

alter table sentences
  add column if not exists usage jsonb;
