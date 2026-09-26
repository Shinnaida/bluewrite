-- Rollback 019_account_requests.sql — drop the self-service request flags.
--
-- WHAT THIS LOSES. Any OPEN requests: an officer who asked for a password reset
-- or an email change, and the Admin flag that says so. It does NOT lose any
-- action an Admin actually took — Reset password, an address edit, Reset
-- verification and recovery-code issues are all in audit_logs, which this table
-- never duplicated. After this, an officer must again ask an Admin in person,
-- with nothing in the app recording the ask.
--
-- Apply WITH the code that no longer reads the table: AccountRequestsController
-- queries it on every request, so a database without it answers 500 rather than
-- degrading.

DROP TABLE IF EXISTS account_requests;
