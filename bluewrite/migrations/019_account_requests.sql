-- BlueWrite migration 019: a way to ASK, when you cannot change it yourself.
--
-- WHY THIS EXISTS. An officer who has forgotten their password, or whose mailbox
-- on file is wrong, has exactly one route today: find an Admin and tell them in
-- person, with no record of what was asked or when. This table is the record. It
-- is deliberately NOT a self-service change — the request changes nothing on its
-- own; it raises an audited flag an Admin acts on with the tools User Management
-- already has (Reset password, edit the address, Reset verification, Issue
-- recovery codes). Every one of those acts is already append-only audited.
--
-- WHAT IT IS. One row per request: who asked, what for, why, and when. `kind` is
-- one of 'password' or 'email' — the two facts an officer cannot fix alone. The
-- `reason` is free text the officer writes, kept short so it reads in a list.
--
-- THE FLAG IS CLEARED BY THE ADMIN, not by reading it. The existing bell moves a
-- per-account READ WATERMARK (users.notifications_seen_at); this is different —
-- a request is a task for somebody to DO, and a watermark that cleared it merely
-- because an Admin glanced at the dashboard would lose the work. `handled_at` /
-- `handled_by` are set when an Admin dismisses the flag after acting, and the
-- two together are the whole status: NULL means open.
--
-- NO CASCADE ON handled_by. If the Admin who cleared a request is later deleted
-- (which is deactivation, not deletion, in this app), the record of who cleared
-- it must survive; ON DELETE SET NULL keeps the timestamp and forgets only the
-- name. The request's own user_id cascades, because a request about an account
-- that genuinely no longer exists has nothing to be about.
--
-- Rollback: migrations/019_account_requests.down.sql — drops the table. It loses
-- only the open/closed flags and their reasons; every action an Admin actually
-- took on an account is in audit_logs, which this table never duplicates.

CREATE TABLE account_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind VARCHAR(20) NOT NULL,
  reason VARCHAR(500) NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at DATETIME NULL DEFAULT NULL,
  handled_by INT UNSIGNED NULL DEFAULT NULL,
  INDEX idx_account_requests_open (handled_at, created_at),
  INDEX idx_account_requests_user (user_id, created_at),
  CONSTRAINT fk_account_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_account_requests_handler FOREIGN KEY (handled_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
