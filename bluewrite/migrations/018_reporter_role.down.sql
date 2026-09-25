-- Reverse of 018_reporter_role.sql: Drop the reporting party's capacity column.
-- The reporter's name, contact details and signature timestamp are migration 006
-- and are deliberately untouched.

ALTER TABLE reports
  DROP COLUMN reporter_role;
