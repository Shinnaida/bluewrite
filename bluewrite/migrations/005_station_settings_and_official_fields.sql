-- BlueWrite migration 005: station settings + the official-document fields.
--
-- Part 1 of the PNP Police Report specification.
--
-- station_settings — ONE row (id = 1) holding the fixed agency header the
--   sheet carries. It replaces the literals that used to live in
--   ReportPrint.jsx and in the AI system prompt, so a station's header is
--   deployment data, not code. incident_types is an optional per-station
--   override of the selectable incident types (NULL = use the built-in
--   list). Seeded with the values BlueWrite already printed, so an
--   existing install's sheet is unchanged by this migration.
--
-- reports — the document fields the specification keeps separate:
--   report_date / blotter_no / blotter_date  (distinct from incident date)
--   incident_date + incident_time + incident_time_approximate
--   discovery_date + discovery_time + discovery_time_approximate
--   updated_by          — who last edited (audit gap from 1.10)
--   noted_by_id / noted_by_name / noted_at — the reviewing official
--
--   incident_datetime is KEPT and now DERIVED (set by the API from
--   incident_date + incident_time) because the dashboard series, the list
--   sort and the date-range filters are all built on it. The two fields
--   remain the record of what the officer entered; the datetime is only a
--   sortable key, never what the sheet prints.

CREATE TABLE IF NOT EXISTS station_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  agency VARCHAR(120) NOT NULL,
  commission VARCHAR(120) NOT NULL,
  regional_office VARCHAR(120) NOT NULL,
  provincial_office VARCHAR(120) NOT NULL,
  station_name VARCHAR(160) NOT NULL,
  station_location VARCHAR(160) NOT NULL,
  office_code VARCHAR(40) NOT NULL,
  incident_types JSON NULL,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_station_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO station_settings
  (id, agency, commission, regional_office, provincial_office, station_name, station_location, office_code)
VALUES
  (1, 'Republic of the Philippines', 'National Police Commission',
   'PHILIPPINE NATIONAL POLICE, POLICE REGIONAL OFFICE 7', 'CEBU POLICE PROVINCIAL OFFICE',
   'CITY of NAGA POLICE STATION', 'City of Naga, Cebu', 'NCPS – INVEST');

ALTER TABLE reports
  ADD COLUMN report_date DATE NULL AFTER incident_type,
  ADD COLUMN blotter_no VARCHAR(40) NULL AFTER report_date,
  ADD COLUMN blotter_date DATE NULL AFTER blotter_no;

ALTER TABLE reports
  ADD COLUMN incident_date DATE NULL AFTER incident_datetime,
  ADD COLUMN incident_time TIME NULL AFTER incident_date,
  ADD COLUMN incident_time_approximate TINYINT(1) NOT NULL DEFAULT 0 AFTER incident_time;

ALTER TABLE reports
  ADD COLUMN discovery_date DATE NULL AFTER respondent,
  ADD COLUMN discovery_time TIME NULL AFTER discovery_date,
  ADD COLUMN discovery_time_approximate TINYINT(1) NOT NULL DEFAULT 0 AFTER discovery_time;

ALTER TABLE reports
  ADD COLUMN noted_by_id INT UNSIGNED NULL AFTER finalized_at,
  ADD COLUMN noted_by_name VARCHAR(120) NULL AFTER noted_by_id,
  ADD COLUMN noted_at DATETIME NULL AFTER noted_by_name,
  ADD COLUMN updated_by INT UNSIGNED NULL AFTER noted_at,
  ADD CONSTRAINT fk_reports_noted_by FOREIGN KEY (noted_by_id) REFERENCES users (id),
  ADD CONSTRAINT fk_reports_updated_by FOREIGN KEY (updated_by) REFERENCES users (id);

-- Backfill for rows created before this migration: today's single
-- incident_datetime becomes the date + (exact) time pair, and the report
-- date defaults to when the record was written. Nothing is approximated,
-- so no approximate flag is set on legacy rows.
UPDATE reports
   SET incident_date = DATE(incident_datetime),
       incident_time = TIME(incident_datetime)
 WHERE incident_datetime IS NOT NULL AND incident_date IS NULL;

UPDATE reports SET report_date = DATE(created_at) WHERE report_date IS NULL;
