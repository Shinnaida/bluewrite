-- BlueWrite migration 008 DOWN — undo `008_narrative_source_language.sql`.
--
-- Run it only to undo 008. To go forward again, apply
-- 008_narrative_source_language.sql.
--
-- WHAT THIS LOSES — stated plainly, as 007's down file does:
--
--   * `narrative_source_language` for EVERY translated report. The source TEXT
--     (`narrative_source_text`) is NOT touched, so the officer's own words
--     survive — but the declaration of which language they are in is gone, and
--     a reader can no longer tell a Bisaya source from a Tagalog one without
--     reading it. There is no backup of the column.
--
-- It does NOT touch `narrative_source_text`, `narrative`, `narrative_language`,
--   any other column, or any row's identity.
--
-- It does NOT rewrite `report_history`. Snapshots taken while 008 was applied
--   keep `narrative_source_language` inside their JSON — the same rule 007's
--   down file states, for the same reason: a snapshot is what the row WAS.

ALTER TABLE reports
  DROP COLUMN narrative_source_language;
