-- BlueWrite migration 007 DOWN — undo `007_narrative_language.sql`.
--
-- This is the first .down.sql in the project: migrations 001–006 are
-- forward-only and were applied by hand, so there was no rollback convention
-- to follow. Phase 6 introduces one — `NNN_name.down.sql`, run by hand beside
-- its forward file. Nothing runs these automatically; the test harness only
-- replays the forward files.
--
-- Run it only to undo 007. To go forward again, apply 007_narrative_language.sql.
--
-- WHAT THIS LOSES — stated plainly, because §6 Step 1 of the Stage 1 brief
-- requires it rather than a shrug:
--
--   * `narrative_language` for EVERY row — not a subset, and there is no
--     backup of it. After a rollback, every report's declared language is
--     unknown again, and reports filed in Bisaya or Tagalog become
--     indistinguishable from English ones.
--   * `narrative_source_text` for every row. It is NULL everywhere while only
--     Stage 1 is deployed, so today this loses nothing. From Stage 3 onward it
--     holds the officer's own native-language words — the copy that is meant
--     to outlive a translation — and dropping it destroys the only copy.
--
-- It does NOT touch `narrative`, any other column, or any row's identity.
-- A report's text, parties, dates and status are exactly as they were.
--
-- It does NOT rewrite `report_history`. Snapshots taken while 007 was applied
-- still carry `narrative_language` and `narrative_source_text` inside their
-- JSON. That is deliberate: a snapshot is the record of what the row WAS, and
-- editing history to match a schema change is the opposite of an audit trail.
-- The UI's history dialog prints snapshots as raw JSON, so the keys simply
-- remain visible in older entries — reporting their absence instead would be
-- the misleading option.
--
-- Order: narrative_source_text was added AFTER narrative_language, and one
-- ALTER may drop both.

ALTER TABLE reports
  DROP COLUMN narrative_source_text,
  DROP COLUMN narrative_language;
