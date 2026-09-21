-- Rollback of migration 013: back to the authenticator app (migration 012).
--
-- WHAT THIS LOSES: users.email — every address an account was known by — and the
-- outstanding sign-in code of every account mid-flow. It puts the TOTP tables
-- back exactly as 012 left them, which means every Admin and Officer is
-- unenrolled again and has to add a key to an authenticator app at their next
-- sign-in. Recovery codes come back empty; there is nothing to restore them
-- FROM, because 013 never kept a copy of the set anyone was shown.
--
-- The order matters and is the reverse of the forward migration: the new table
-- goes first, then the column, then the old tables are recreated. The two
-- CREATEs below are copied from 012 verbatim (the long explanatory header lives
-- there and is not repeated).
--
-- Apply this WITH the code that reads it: the sign-in gate joins
-- email_otp_codes and reads users.email, so a rollback has to land with the
-- version of the app that expects mfa_credentials instead.

DROP TABLE IF EXISTS email_otp_codes;

ALTER TABLE users DROP INDEX uq_users_email;
ALTER TABLE users DROP COLUMN email;

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
