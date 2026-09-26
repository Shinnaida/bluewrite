-- BlueWrite migration 018: single-use recovery codes — the OFFLINE second factor.
--
-- WHY THIS EXISTS. Migration 013 moved the second factor to a code emailed to
-- the officer's own address. That removed the enrollment step, but it put the
-- station's internet connection on the critical path of signing in: if the mail
-- cannot be sent, every Admin and Officer is locked out, and there is no route
-- in at all (docs/EMAIL_OTP.md says so plainly). This adds the route back — a
-- factor the officer HOLDS rather than receives, which works with no network.
--
-- WHAT IT IS. Ten single-use recovery codes, generated for an account at
-- enrollment (Admin-assisted, in person) and printed for the officer. Each code
-- is a 10-character Crockford Base32 string — 50 bits — and is spent the moment
-- it is accepted, exactly like the emailed code. A code is the "look-up secret"
-- of NIST SP 800-63B-4: at least six decimal digits (or equivalent) in length,
-- single-use, and stored in a hashed form.
--
-- WHY HASHED AND NOT KEYED. 012 (the authenticator-app factor this station moved
-- away from) encrypted its long-lived TOTP secret under a key held outside the
-- database. A recovery code is not a long-lived secret in that sense — it is
-- consumed on first use — so it is stored with the same `password_hash()`
-- (bcrypt) the emailed code uses, and there is deliberately no key file to lose,
-- back up or rotate. A leaked dump therefore hands over only salted hashes.
--
-- TWO TABLES, and the split is the same one 012 used:
--
--   mfa_recovery_codes — one row per code: the bcrypt hash, and `used_at` when
--     it was spent. A spent code is KEPT rather than deleted, so the panel can
--     say how many are left, the trail shows a code was used, and the audit can
--     reconstruct the list's history. The hash is NOT the plaintext: no endpoint
--     can ever return a code, because the server does not store one.
--
--   mfa_recovery_state — ONE ROW PER ACCOUNT: the factor's own attempt counter
--     and lock, kept apart from the password's (users.failed_attempts) and the
--     email code's (email_otp_codes) for the reason 012 gave — a wrong recovery
--     code and a wrong password are different events with different remedies,
--     and a shared counter would let somebody lock an officer's PASSWORD by
--     guessing at a recovery code. `generated_at` is the last time the set was
--     issued, which is what "these are the codes from 2026-09-26" means.
--
-- WHAT IS NOT STORED: no plaintext code, no copy of the printed sheet, and no
-- record of which physical copy was used. The sheet is paper; the server knows
-- only that a code was spent.
--
-- Rollback: migrations/018_recovery_codes.down.sql — states plainly what it
-- loses (every account's offline route in).
--
-- Deployment: apply WITH the code that reads it. `RecoveryCodes::hasAny()` is
-- consulted by Auth::requireUser for any Admin/Officer with no email address, so
-- a database without these tables refuses those sessions rather than degrading.

CREATE TABLE mfa_recovery_codes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mfa_recovery_user (user_id, used_at),
  CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mfa_recovery_state (
  user_id INT UNSIGNED NOT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL DEFAULT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_mfa_recovery_state_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
