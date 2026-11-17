-- Rollback for 030_report_composing.sql.
--
-- DROP TABLE, and unlike most rollbacks this loses nothing that was ever
-- anybody's. A row here is a stamp a few seconds old saying that somebody was
-- composing; the reports themselves are in `reports` and are untouched by this
-- file.
--
-- The only consequence is the indicator: with the table gone,
-- POST /reports/:id/composing has nowhere to write and the pen badges never
-- appear. Saves keep flagging writers through the audit trail exactly as
-- before, and no route outside ReportsController mentions it.

DROP TABLE IF EXISTS report_composing;
