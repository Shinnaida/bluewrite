-- Rollback of migration 014: the station forgets who was online, and every
-- avatar goes back to initials.
--
-- WHAT THIS LOSES: users.last_seen_at (nobody is online after this — the roster
-- is empty until the code that reads it is rolled back too), and every account's
-- photo_path and photo_updated_at. The images themselves are NOT deleted and
-- cannot be from here: they are files in storage/avatars/, one per account, and
-- this migration has no way to know which of them belong to whom once the
-- column that named them is gone.
--
-- So a rollback leaves the folder holding orphans. They are inert — nothing
-- reads a file whose name is in no row — and the note for whoever runs this is
-- that storage/avatars/ can then be cleared by hand, safely, before the forward
-- migration is applied again (every officer would simply re-upload).
--
-- APPLY THIS WITH THE CODE THAT MATCHES IT. The forward migration ships with the
-- workspace that calls POST /presence/heartbeat and the two photo routes; with
-- the column dropped and that client still running, every heartbeat is a 500 on
-- an unknown column. The order is the reverse of the forward migration: index
-- first, then the columns that the index is on.

DROP INDEX idx_users_last_seen ON users;

ALTER TABLE users
  DROP COLUMN photo_updated_at,
  DROP COLUMN photo_path,
  DROP COLUMN last_seen_at;
