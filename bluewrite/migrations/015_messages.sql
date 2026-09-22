-- BlueWrite migration 015: messages between officers.
--
-- WHAT THIS IS FOR. The station has a roster (014: who is at a desk) and no way to
-- say anything to the person on it. Everything an officer needs to tell a colleague
-- today goes through walking over to them, which is exactly what the roster exists to
-- avoid when the colleague is at the other end of the building.
--
-- ONE TABLE, TWO DIRECTIONS. A message is one row with a sender and a recipient; a
-- conversation is the rows between two accounts, in both directions. The alternative
-- — a `conversations` table with a `conversation_participants` join — is the right
-- shape for group chat and the wrong one here: this is a station's internal line, it
-- is one-to-one, and the extra two tables would exist to describe a set of exactly
-- two people. If group messaging ever arrives it arrives as its own migration.
--
-- NO SOFT DELETE, and no edit. A message is a record of something somebody said to a
-- colleague, and the point of the thing is that it can be read back. There is no UI
-- that would need to hide one, and a `deleted_at` added "just in case" would be the
-- column the next feature filters on by accident. (The report register's soft delete
-- is a different argument: reports are the station's records and are archived, not
-- removed.)
--
-- READ IS A TIMESTAMP RATHER THAN A FLAG, for the same reason last_seen_at is: it is
-- also the answer to "when", which the thread wants to show, and it costs nothing to
-- carry. `read_at IS NULL` is the unread predicate and is exactly what the index
-- below is built on.
--
-- WHAT IS DELIBERATELY *NOT* HERE: nothing about this is written to audit_logs. The
-- audit trail is available to administrators, and a private message between two
-- officers is not an administrative event — copying the body into a table an admin
-- reads would be a silent disclosure. The row itself is the record.
--
-- COLUMNS
--   sender_id    — who sent it; FK to users so a message cannot outlive its author.
--   recipient_id — who it is for. The pair (sender, recipient) is the thread.
--   body         — plain text, 1000 characters. Long enough for a paragraph of
--                  handover notes, short enough that it is not a report.
--   created_at   — the DATABASE's clock. The client never supplies a time.
--   read_at      — NULL until the recipient has actually seen it, set by
--                  POST /messages/:id/seen with the newest id that was on screen.
--
-- INDEXES
--   idx_messages_thread — (sender_id, recipient_id, id). Every thread read is
--     "the rows between me and them, newest last", and this is that walk. `id` is in
--     the index rather than created_at because id is the tie-breaker for two messages
--     written in the same second, and the thread orders by (created_at, id).
--   idx_messages_unread — (recipient_id, read_at). The unread count is asked on every
--     heartbeat, for every open workspace, every thirty seconds; this keeps it a range
--     scan on one account's unread rows rather than a scan of the whole table.
--
-- Rollback: migrations/015_messages.down.sql — drops the table. It takes every
-- message with it, which is the honest outcome: there is nowhere else they are kept.

CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sender_id INT UNSIGNED NOT NULL,
  recipient_id INT UNSIGNED NOT NULL,
  body VARCHAR(1000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL DEFAULT NULL,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id),
  CONSTRAINT fk_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_messages_thread ON messages (sender_id, recipient_id, id);
CREATE INDEX idx_messages_unread ON messages (recipient_id, read_at);
