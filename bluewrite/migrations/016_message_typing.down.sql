-- Rollback for 016_message_typing.sql.
--
-- DROP TABLE, and unlike the messages rollback this loses nothing that was ever
-- anybody's. A row here is a stamp a few seconds old saying that somebody was typing;
-- the messages themselves are in `messages` and are untouched by this file.
--
-- The only consequence is the indicator: with the table gone, POST /messages/:id/typing
-- has nowhere to write and the three dots never appear. Nothing else in the app reads
-- it, and no route outside MessagesController mentions it.

DROP TABLE IF EXISTS message_typing;
