-- Rollback of migration 018.
--
-- WHAT THIS LOSES: every account's offline way in. After it runs, an Admin or
-- Officer can only sign in through the emailed code again, which means an
-- internet or mail outage locks the whole station out of the system — the exact
-- failure 018 exists to remove. Apply it together with the code that reads these
-- tables (RecoveryCodes, AuthController::mfaRecovery, the Admin generate route),
-- or a request handled by that code answers 500 against a missing table.
--
-- WHAT IT DOES NOT TOUCH: passwords, email addresses, sessions, the email OTP
-- state, reports or the audit trail. The codes already printed are dead the
-- moment the tables go; nobody can spend one.

DROP TABLE IF EXISTS mfa_recovery_state;
DROP TABLE IF EXISTS mfa_recovery_codes;
