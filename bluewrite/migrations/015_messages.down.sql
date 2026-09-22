-- Rollback for 015_messages.sql.
--
-- DROP TABLE takes every message with it. That is stated rather than softened: unlike
-- the avatar rollback (which leaves orphaned FILES behind because the rows cannot name
-- them any more), a message has no existence outside its row — there is no folder to
-- leave behind, and nothing to recover by hand. Rolling this migration back on a
-- station that has been using it DESTROYS the correspondence between its officers.
--
-- Back the table up first if that matters:
--
--   mysqldump -u root -p bluewrite messages > messages-backup.sql

DROP INDEX idx_messages_unread ON messages;
DROP INDEX idx_messages_thread ON messages;
DROP TABLE IF EXISTS messages;
