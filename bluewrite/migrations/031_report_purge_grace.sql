-- BlueWrite migration 031: a permanent delete that waits seven days.
--
-- WHY THE ARCHIVE WASN'T A BIN. Until now a report could be archived
-- (`deleted_at`) and restored, and nothing could ever leave the database: the
-- archive was a shelf, not a bin. The station has now asked for a real delete —
-- a record filed by mistake should be able to go — with one condition: nothing
-- disappears the instant somebody clicks, because that click is the one action
-- nothing can undo.
--
-- SO A DELETE IS A SCHEDULE. DELETE /reports/:id/purge stamps `purge_after`
-- seven days ahead and leaves the row archived and restorable; the archive's own
-- Restore clears the stamp and cancels the whole thing. Only a row whose date has
-- passed is removed, and removing it takes its history and its capture rows with
-- it (see ReportsController::purgeExpiredReports). Nothing else in the app reads
-- these columns, so with the migration applied and nobody scheduling anything,
-- behaviour is exactly what it was before.
--
-- THE CLOCK IS THE DATABASE'S. `purge_after` is computed with NOW() on the
-- server, never from a client time, so a laptop with a wrong clock can neither
-- shorten nor extend the grace period.
--
-- COLUMNS
--   purge_after        — when the row may be removed. NULL means "not
--                        scheduled", which is every row today.
--   purge_requested_by — the administrator who asked for it. Kept for the same
--                        reason created_by is: "who decided this record should
--                        go" is a question the station may have to answer, and an
--                        audit line alone cannot be joined back to the row.
--   idx_reports_purge_after — the one query that matters is "rows whose window
--                        has run out", and it must not scan the whole blotter to
--                        find them: the index makes the sweep cheap enough to run
--                        on every read of the archive.
--
-- Rollback: migrations/031_report_purge_grace.down.sql — drops all three, and the
-- archive reverts to a shelf where nothing can ever be deleted. Rows already
-- scheduled simply stay archived.

ALTER TABLE reports
  ADD COLUMN purge_after DATETIME NULL DEFAULT NULL AFTER deleted_at,
  ADD COLUMN purge_requested_by INT UNSIGNED NULL DEFAULT NULL AFTER purge_after,
  ADD KEY idx_reports_purge_after (purge_after),
  ADD CONSTRAINT fk_reports_purge_by FOREIGN KEY (purge_requested_by) REFERENCES users (id);
