-- BlueWrite migration 022: the station's default signing official.
--
-- station_settings.noted_by — the name printed on the sheet's "Noted by:"
-- line when a report names no reviewing official of its own
-- (reports.noted_by_name, set when an official acts). NULL means the
-- built-in default (see App\Core\Station::DEFAULTS), so existing installs
-- print exactly what they printed before this migration.
ALTER TABLE station_settings
  ADD COLUMN noted_by VARCHAR(120) NULL AFTER office_code;
