-- BlueWrite migration 026 rollback: drop the station contact lines.
ALTER TABLE station_settings
  DROP COLUMN station_phone,
  DROP COLUMN station_email;
