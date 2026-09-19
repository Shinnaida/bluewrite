-- BlueWrite migration 010 DOWN — undo `010_users_languages_read.sql`.
--
-- Run it only to undo 010. To go forward again, apply
-- 010_users_languages_read.sql.
--
-- WHAT THIS LOSES — stated plainly:
--
--   * WHICH source languages every account was recorded as able to read. There
--     is no backup. After a rollback, no account can verify a translation until
--     the attribute is recorded again, and an Admin must re-enter it by hand.
--
-- It does NOT touch any other user column (name, badge, username, role,
--   status, credentials) and it does NOT touch `report_verifications`
--   (migration 009) — existing reviews survive; only the ability to perform a
--   NEW one is lost until the attribute is restored.

ALTER TABLE users
  DROP COLUMN languages_read;
