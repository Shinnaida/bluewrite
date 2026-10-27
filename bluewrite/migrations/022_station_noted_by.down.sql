-- BlueWrite migration 022 rollback: drop the default signing official.
ALTER TABLE station_settings
  DROP COLUMN noted_by;
