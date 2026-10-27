-- BlueWrite migration 025: blotter-capture photos attached to a report.
--
-- The phone app photographs the written blotter, the server reads it
-- (POST /ocr/read, unchanged), and BOTH travel here: the photo as a file
-- under storage/report_captures/ and the officer-reviewed text beside it.
-- The draft sheet shows the photo next to the narrative it produced, so the
-- officer checks image against text in the portal exactly as with an
-- Upload / drag-drop capture on the web (see BlotterCapture.jsx).
--
-- APPEND-ONLY, like report verifications: a capture is evidence of what the
-- blotter page showed, so there is no update and no delete route. A row
-- names the report it belongs to and the account that filed it; the bytes
-- live outside the web root (storage/, never public/) and are readable only
-- through the API under a session or device token.
--
-- Rollback: migrations/025_report_captures.down.sql — drops the table. The
-- files under storage/report_captures/ are left on disk and must be removed
-- by hand; affected drafts keep their narratives.

CREATE TABLE IF NOT EXISTS report_captures (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  mime VARCHAR(60) NOT NULL DEFAULT 'image/jpeg',
  ocr_text MEDIUMTEXT NULL,
  engine VARCHAR(40) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_captures_report FOREIGN KEY (report_id) REFERENCES reports (id),
  CONSTRAINT fk_captures_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_captures_report ON report_captures (report_id);
