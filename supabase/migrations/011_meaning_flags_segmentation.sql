-- ============================================================
-- Widen meaning_flags.flag_kind CHECK to include
-- 'segmentation-disagreement' (PR #111).
--
-- Migration 010 declared the CHECK with only the five original
-- kinds. Without this widening, sync's apply_ingest_bundle would
-- reject any bundle carrying a segmentation flag — the local Dexie
-- write succeeds but the server op fails silently.
-- ============================================================

alter table meaning_flags
  drop constraint if exists meaning_flags_flag_kind_check;

alter table meaning_flags
  add constraint meaning_flags_flag_kind_check
  check (flag_kind in (
    'auto-corrected',
    'polyphone-coerced',
    'cedict-disagreement',
    'cedict-unknown',
    'segmentation-disagreement',
    'user-report'
  ));
