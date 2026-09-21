-- BlueWrite migration 012: the second factor (TOTP) and its recovery codes.
--
-- SUPERSEDED BY 013. This is kept because it is history — a database built from
-- these files in order passes through it — but the authenticator-app factor it
-- describes was REPLACED by an emailed one-time code (migration 013 drops both
-- tables below). The current design is docs/EMAIL_OTP.md; the reasoning recorded
-- here about offline sign-in is the trade that was given up, and is worth reading
-- before deciding to go back.
--
-- WHY THIS EXISTS. Until now a password was the whole of signing in: knowing
-- one account's password was enough to read every report that account wrote,
-- sign a report, or — for an Admin — create and deactivate accounts. This adds
-- a factor the officer HOLDS rather than knows: a six-digit code from an
-- authenticator app, derived from a per-account secret by RFC 6238.
--
-- WHY AN AUTHENTICATOR APP AND NOT EMAIL. This is a LAN system whose Admin
-- login must keep working when the internet is down; an emailed code would put
-- a mail server on the critical path of signing in to the thing you fix the
-- mail server with. TOTP needs no service at all: the secret is shared once at
-- enrollment and the phone computes the rest offline. (The officer's own report
-- drafting already calls a network service, but that is a feature that degrades;
-- this would be a lockout.)
--
-- TWO TABLES, AND THE SPLIT IS THE POINT:
--
--   mfa_credentials      — the shared secret and its state: confirmed or not,
--                          the last code spent, and the attempt counter. ONE
--                          ROW PER ACCOUNT, which the primary key enforces
--                          rather than an index someone has to remember.
--
--   mfa_recovery_codes   — ten single-use codes, stored as digests, because a
--                          phone is a physical object that gets lost, dropped
--                          in a canal or left at home, and a factor with no
--                          way past it is a support queue and — worse — an
--                          incentive to share the secret.
--
-- COLUMNS
--   secret_encrypted — AES-256-GCM ciphertext of the base32 secret, with the
--     nonce and the authentication tag inside the same value. ENCRYPTED
--     BECAUSE A TOTP SECRET IS A PASSWORD THAT NEVER CHANGES: anyone who reads
--     it can generate valid codes forever, so a database dump — a backup file,
--     an accidental SELECT, a stolen .sql — must not be enough to impersonate
--     an officer. The key lives OUTSIDE the database (config/config.php's
--     `app.mfa_key`, or a generated config/mfa.key) precisely so that a leaked
--     dump alone is not enough. WHAT THIS DOES NOT PROTECT AGAINST: someone who
--     has both the dump and the filesystem. See docs/EMAIL_OTP.md for how the
--     CURRENT factor stores what it keeps, and why it needs no key at all.
--
--   confirmed_at — when the officer PROVED the secret works by entering a code
--     from their own app. NULL means enrollment was started and never finished
--     (they closed the browser, or scanned and gave up). The row is kept rather
--     than thrown away so that reopening the setup screen shows the SAME secret:
--     generating a new one would silently invalidate the QR code already sitting
--     in their phone. An unconfirmed row grants NOTHING — no code from it is
--     ever accepted (see Mfa::status/verify).
--
--   last_step — the highest 30-second step whose code has been accepted for
--     this secret. THIS IS WHAT MAKES A CODE SINGLE-USE. A TOTP code is valid
--     for its whole step and, with the ±1 step margin for clock drift, for two
--     more; without this column an officer reading a code aloud over the radio,
--     or anyone who watched it being typed, could use it again inside that
--     window. A code from a step that is not greater than this one is refused.
--     BIGINT UNSIGNED: the step is unix-time/30, which outgrows a 32-bit INT in
--     2174 — not a pressing concern, but the column is free and a silent
--     overflow would be a replay window rather than an error.
--
--   failed_attempts / locked_until — the second factor's OWN lockout, separate
--     from the password's (users.failed_attempts / users.locked_until). They
--     are kept apart on purpose: a wrong code and a wrong password are
--     different events with different remedies, and a shared counter would let
--     someone lock an officer out of their password by guessing at the factor
--     they never got past. A pending sign-in allows five wrong codes, which is
--     enough for a mis-typed code and a wrong authenticator entry; past that
--     the account's MFA is locked for the same window as the password lockout
--     (app.lockout_minutes), and can be cleared by an Admin instead of waiting.
--
--   code_digest — HMAC-SHA256 of the normalized recovery code, keyed by the
--     same server key, hex-encoded. DIGEST, NOT A HASH: the codes are generated
--     with 50 bits of entropy so a plain SHA-256 would already be uncrackable,
--     but the key is what stops a dump from being checkable OFFLINE at all,
--     and the key already exists for the secrets above. The codes are shown to
--     the officer exactly once, at the moment they are generated, and never
--     again — there is no endpoint that returns them, because the server
--     cannot and should not be able to.
--
--   used_at — stamped when a recovery code is spent. A spent code stays in the
--     table rather than being deleted, so the panel can say how many are left
--     and the trail shows the codes were used instead of the list quietly
--     shrinking. The UNIQUE key on (user_id, code_digest) makes a repeated code
--     inside one generation impossible rather than merely unlikely.
--
-- WHAT IS NOT STORED, deliberately: no code, no digest of a code, no timestamp
-- of a failed code, and no copy of the otpauth URI. A six-digit code is valid
-- for seconds and is verified against the secret, so there is nothing to keep;
-- storing one would create a credential out of a value that expires on its own.
--
-- Rollback: migrations/012_mfa.down.sql — states plainly what it loses.

CREATE TABLE mfa_credentials (
  user_id INT UNSIGNED NOT NULL,
  secret_encrypted VARBINARY(255) NOT NULL,
  confirmed_at DATETIME NULL DEFAULT NULL,
  last_step BIGINT UNSIGNED NULL DEFAULT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_mfa_credential_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mfa_recovery_codes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  code_digest CHAR(64) NOT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mfa_recovery_digest (user_id, code_digest),
  INDEX idx_mfa_recovery_user (user_id),
  CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
