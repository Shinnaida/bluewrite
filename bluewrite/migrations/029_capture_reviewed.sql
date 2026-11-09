-- BlueWrite migration 029: a phone capture leaves the folder once reviewed.
--
-- report_captures.reviewed_at / reviewed_by — the moment an officer's draft
-- took in the capture's words (Insert, or an AI draft accepted/kept over
-- them), the capture is REVIEWED, so the Phone files folder drops it for
-- good instead of re-offering it every reload. The row and the photo stay:
-- like verifications, a capture is evidence of what the blotter page showed,
-- so nothing here deletes anything — reviewed captures simply stop counting
-- as waiting (see the register's capture_count).
--
-- NULL means "still waiting", so every existing install keeps exactly the
-- folder it has today until its next review.
--
-- Rollback: migrations/029_capture_reviewed.down.sql — drops both columns.
-- Reviewed state is lost with them; every capture reads as waiting again.
ALTER TABLE report_captures
  ADD COLUMN reviewed_at DATETIME NULL DEFAULT NULL AFTER engine,
  ADD COLUMN reviewed_by INT UNSIGNED NULL DEFAULT NULL AFTER reviewed_at,
  ADD CONSTRAINT fk_captures_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_captures_waiting ON report_captures (report_id, reviewed_at);
