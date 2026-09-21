-- BlueWrite migration 013: the second factor moves from an authenticator app to
-- a one-time code sent to the officer's Gmail.
--
-- WHY THIS REPLACES 012 RATHER THAN SITTING BESIDE IT. The station changed its
-- mind about which factor an officer HOLDS: a phone with an authenticator app
-- needs an app installed and a key typed in, and the station wants the factor to
-- be a code that arrives in the mailbox the account is already known by. Two
-- factors side by side is two enrollment stories, two recovery stories and two
-- sets of screens for one account, so the old one is removed outright.
--
-- WHAT THIS COSTS, stated plainly, because it is the trade the station accepted:
-- the second factor now needs the internet. An emailed code cannot be generated
-- offline — that was the whole reason 012 chose TOTP — so a sign-in to BlueWrite
-- now depends on Gmail being reachable. The station's own answer is that the
-- mailbox is where its accounts already live and the offline case is an
-- acceptable one, not that the concern was imaginary.
--
-- COLUMNS
--   users.email — the address a sign-in code is sent to. NULL means "not
--     recorded", which is a real state for a Staff account (password only) but a
--     blocking one for an Admin or an Officer: Auth::requireUser refuses a
--     session for an account whose role requires the factor and which has no
--     address on file. UNIQUE because two accounts sharing one inbox would let
--     one person's code sign the other in, which is not a second factor.
--
--   email_otp_codes — ONE ROW PER ACCOUNT (the primary key enforces it rather
--     than an index somebody has to remember), holding the code that is
--     currently outstanding:
--       code_hash      — password_hash() of the six digits, so a database dump
--                        does not hand over a live code. The code lives for
--                        minutes, so it is hashed with the same bcrypt the
--                        passwords use rather than a keyed digest: there is no
--                        long-lived secret at rest to protect here.
--       expires_at     — when the code stops being accepted. Ten minutes, the
--                        same window the pending sign-in itself gets.
--       sent_at        — when the mail went out, which is what the resend
--                        throttle measures from.
--       failed_attempts / locked_until — the factor's OWN lockout, separate from
--                        the password's, on the same pattern 012 used: a wrong
--                        code and a wrong password are different events with
--                        different remedies, and a shared counter would let
--                        somebody lock an officer's PASSWORD by guessing at the
--                        code.
--
-- WHAT IS NOT STORED: no list of recovery codes (the screen that showed them is
-- gone with the app factor), and no copy of the email itself. An unexpired row
-- is simply deleted once a code is used or replaced.
--
-- Rollback: migrations/013_email_otp.down.sql — restores 012's tables and
-- removes the column, and states what it loses.

ALTER TABLE users
  ADD COLUMN email VARCHAR(160) NULL DEFAULT NULL AFTER username,
  ADD UNIQUE KEY uq_users_email (email);

DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS mfa_credentials;

CREATE TABLE email_otp_codes (
  user_id INT UNSIGNED NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_email_otp_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
