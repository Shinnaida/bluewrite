-- BlueWrite migration 027 rollback: drop the freed letterhead and seal files.
ALTER TABLE station_settings
  DROP COLUMN seal_right_path,
  DROP COLUMN seal_left_path,
  DROP COLUMN letterhead_html;
