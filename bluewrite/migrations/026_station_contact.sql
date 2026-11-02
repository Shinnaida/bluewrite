-- BlueWrite migration 026: the station's contact lines.
--
-- station_settings.station_email / station_phone — the station's Gmail and
-- telephone number, kept on file with the letterhead. They are NOT printed
-- lines: the sheet's letterhead stays the seven fixed lines, and these ride
-- along in the same row so every reader of /station sees one station record.
-- NULL/blank means "not set", and each falls back independently (empty), so
-- existing installs print exactly what they printed before this migration.
--
-- Rollback: migrations/026_station_contact.down.sql — drops both columns.
-- The contact lines are lost with them; the letterhead is untouched.
ALTER TABLE station_settings
  ADD COLUMN station_email VARCHAR(160) NULL AFTER noted_by,
  ADD COLUMN station_phone VARCHAR(40) NULL AFTER station_email;
