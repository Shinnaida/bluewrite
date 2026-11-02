-- BlueWrite migration 028 rollback: drop the letterhead presentation column.
ALTER TABLE station_settings
  DROP COLUMN letterhead_style;
