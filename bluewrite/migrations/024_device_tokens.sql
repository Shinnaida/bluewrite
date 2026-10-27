-- BlueWrite migration 024: device tokens for the blotter-capture phone app.
--
-- A device token is a long-lived credential a phone holds INSTEAD of a
-- password: it is issued once, after a FULL sign-in (password plus the
-- second factor, migration 013/018), and presented as
-- `Authorization: Bearer <token>` on every later call. The phone never
-- stores the officer's password, and the officer's daily unlock is a local
-- app PIN that only opens the phone's own secure storage — the PIN never
-- reaches the server (see DevicesController::issue).
--
-- WHAT IS STORED. Only the SHA-256 hash of the token, never the token
-- itself: a leaked dump hands over hashes that cannot be presented back,
-- the same reasoning as RecoveryCodes (migration 018). The 64-hex token is
-- 256 bits from random_bytes, so a hash lookup is the right scheme (no
-- bcrypt cost on every request).
--
-- SCOPE. One token signs in as one account, with exactly that account's
-- permissions (Auth::requireUser resolves the account off the token). A
-- token is revoked, never edited: sign-out on the phone, or an Admin's
-- suspicion, ends it with revoked_at, and expiry (a year) ends it quietly.
-- Tokens do not need CSRF (there is no cookie to forge against — see
-- Auth::requireCsrf), and they can never mint further tokens (issue and
-- revoke-by-id require the cookie session, see DevicesController).
--
-- Rollback: migrations/024_device_tokens.down.sql — drops the table. Every
-- phone signed in through it stops working and must be set up again.

CREATE TABLE IF NOT EXISTS device_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  device_name VARCHAR(120) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  CONSTRAINT fk_device_tokens_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE UNIQUE INDEX ux_device_tokens_hash ON device_tokens (token_hash);
CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);
