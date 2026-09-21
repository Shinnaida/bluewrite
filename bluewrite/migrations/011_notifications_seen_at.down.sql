-- Rollback of migration 011.
--
-- WHAT THIS LOSES: every account's notification watermark. After this runs,
-- GET /notifications reports every event on the account's own reports as
-- unread again — the events themselves are untouched (they live in
-- report_verifications and report_history), so nothing is lost except the
-- record of how far each account had read. The bell badge will show a count
-- until the officer opens the panel once, at which point the watermark is
-- written again.

ALTER TABLE users
  DROP COLUMN notifications_seen_at;
