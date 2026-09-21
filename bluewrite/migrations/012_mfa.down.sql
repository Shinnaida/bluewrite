-- Rollback of migration 012.
--
-- WHAT THIS LOSES: every account's second factor, and every unused recovery
-- code. Dropping these tables does NOT weaken a password or an existing
-- session, and it does not touch users, reports or the audit trail — but after
-- it runs, every Admin and Officer account is back to a password-only sign-in,
-- and everyone must enrol again from scratch. The authenticator entries already
-- in the officers' phones become dead keys they should delete themselves.
--
-- Before running this on a live system, empty the tables' accounts: the app
-- requires the second factor for Admin and Officer roles, so a rollback has to
-- happen together with the code that enforces it (Auth::requireUser's
-- mfa_setup_required gate), or every one of those accounts is stuck at a setup
-- screen with no table to write to.
--
-- The order matters because of the foreign keys: the recovery codes reference
-- `users` only, so either table can go first, but dropping the credentials
-- first is the honest reading of "the factor is gone".

DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS mfa_credentials;
