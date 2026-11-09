-- BlueWrite migration 029 rollback: drop the capture review state.
ALTER TABLE report_captures
  DROP INDEX idx_captures_waiting,
  DROP FOREIGN KEY fk_captures_reviewer,
  DROP COLUMN reviewed_by,
  DROP COLUMN reviewed_at;
