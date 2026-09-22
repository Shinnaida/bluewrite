-- BlueWrite migration 016: the "somebody is typing" signal.
--
-- WHAT THIS IS FOR. 015 gave the station a way to say something to a colleague, and
-- the thread draws a message the moment it is sent. What it could not do is show a
-- reply being WRITTEN, so the newest thing on screen was always at least one finished
-- sentence old. This table is the one fact that cannot be derived from `messages`: not
-- what was said, but that somebody is in the middle of saying it.
--
-- IT IS NOT A MESSAGE AND IT MUST NOT BECOME ONE. No body, no history, no recipient
-- inbox — a row says "this account touched their composer for that one, recently",
-- and it is overwritten by the next touch. Nothing here is ever read back as a record
-- of anything a person said, which is why the audit trail does not see it either (see
-- the note in 015): a keystroke in a draft is less than a message, not more.
--
-- THE DESIGN IS A LATCH, NOT A LOG. One row per (writer, reader) pair, replaced in
-- place. The alternative — a row per keystroke, or per ping — would put a station's
-- typing into a table that grows with every sentence somebody begins and abandons, to
-- answer a question whose whole answer is about the last few seconds. A pair that has
-- not been touched since is simply OLD, and old is what the read side looks for.
--
-- WHY updated_at IS IN THE PRIMARY KEY'S OWN ROW rather than a separate index: the
-- read is "is there a row for (them, me) with a fresh stamp", which the primary key
-- seeks to directly. No index beyond it is needed, and the table holds at most one row
-- per ordered pair of accounts — its ceiling is the square of the roster, not the
-- number of things anybody has ever typed.
--
-- EXPIRY IS THE READER'S JUDGEMENT, not a delete job. A stamp older than the window is
-- ignored (see MessagesController::TYPING_WINDOW), so a crash, a closed laptop or a
-- session that was never told to stop leaves a row that means nothing rather than a
-- row that means something wrong. There is no cron here and none is required: the
-- worst a stale row can do is sit in a table that is bounded anyway, and the columns
-- die with their accounts through the foreign keys.
--
-- COLUMNS
--   user_id    — the account doing the typing. The SESSION's id, never a body field.
--   peer_id    — who they are typing TO. This is what makes the signal private: the
--                read side asks for rows addressed to itself, so a stamp is only ever
--                visible to the one colleague it was aimed at.
--   updated_at — the DATABASE's clock. A client never supplies a time.
--
-- Rollback: migrations/016_message_typing.down.sql — drops the table. Nothing else
-- depends on it and no message is touched, so this is one of the few rollbacks here
-- that loses nothing anybody would miss: an indicator's memory is seconds long.

CREATE TABLE IF NOT EXISTS message_typing (
  user_id INT UNSIGNED NOT NULL,
  peer_id INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, peer_id),
  CONSTRAINT fk_message_typing_writer FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_message_typing_reader FOREIGN KEY (peer_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
