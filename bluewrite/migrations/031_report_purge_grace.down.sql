-- Rollback for 031_report_purge_grace.sql.
--
-- Dropping the two columns is the whole rollback: nothing else in the schema or
-- the code depends on them, and a report that was scheduled for deletion simply
-- stays archived (deleted_at is not touched here), which is where it was before
-- the schedule. No data is lost that was anybody's: the countdown is not a fact
-- about the report, it is a note about when it would have gone.
--
-- With this applied, DELETE /reports/:id/purge answers 409 from its own schema
-- guard, the archive's menu stops offering a delete, and the sweep does nothing.

ALTER TABLE reports
  DROP FOREIGN KEY fk_reports_purge_by,
  DROP KEY idx_reports_purge_after,
  DROP COLUMN purge_requested_by,
  DROP COLUMN purge_after;
