-- BlueWrite migration 030: the "somebody is composing a report" signal.
--
-- WHAT THIS IS FOR. The trail can say somebody SAVED a report, and it says it
-- late: keystrokes only mark a draft dirty, and the server learns about them on
-- the next save — a steady typist who never pauses sends nothing at all. What the
-- Connected now board could not do is show a report being WRITTEN, so the newest
-- thing on screen was always at least one finished save old. This table is the one
-- fact that cannot be derived from `audit_logs`: not what was written, but that
-- somebody is in the middle of writing it, and on which report.
--
-- IT FOLLOWS 016 (message_typing) ON PURPOSE: a latch, not a log. One row per
-- writer, replaced in place by POST /reports/:id/composing while the composer is
-- open. No body, no history, no revision — nothing here is ever read back as a
-- record of anything a person wrote, which is why the audit trail does not see
-- it either: a keystroke in a draft is less than a save, not more.
--
-- EXPIRY IS THE READER'S JUDGEMENT, not a delete job. A stamp older than the
-- window is ignored (see ReportsController::COMPOSING_WINDOW), so a crash, a
-- closed laptop or a tab that was never told to stop leaves a row that means
-- nothing rather than a row that means something wrong. There is no cron here
-- and none is required: the worst a stale row can do is sit in a one-row-per-
-- writer table, and the column dies with its account through the foreign key.
--
-- COLUMNS
--   user_id    — the account doing the composing. The SESSION's id, never a body
--                field: there is no id a caller could pass to put a draft in
--                somebody else's hands.
--   report_id  — which report the composer has open. NULL when the composer has
--                not saved yet and there is nothing to point at; the row still
--                says "writing", which is the whole of what the board draws.
--   updated_at — the DATABASE's clock. A client never supplies a time.
--
-- Rollback: migrations/030_report_composing.down.sql — drops the table. Nothing
-- else depends on it: with the table gone, the composing endpoint has nowhere to
-- write and the pen badges never appear, while saves keep flagging writers
-- through the trail exactly as before.

CREATE TABLE IF NOT EXISTS report_composing (
  user_id INT UNSIGNED NOT NULL,
  report_id INT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_report_composing_writer FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_report_composing_report FOREIGN KEY (report_id) REFERENCES reports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
