-- BlueWrite migration 027: the letterhead as a document, and the seals as files.
--
-- station_settings.letterhead_html — the letterhead's center block as the
-- officer typed it (the freed-letter allowlist, see RichText::sanitizeLetter).
-- NULL/empty means "not freed" and every sheet composes the block from the
-- seven lines exactly as before, so existing installs print what they printed.
-- When set, the sheet renders this in place of the composed lines; the seals
-- beside it and the signature block below stay composed system ink, so a freed
-- letterhead can never lose its seals or its signatories.
--
-- station_settings.seal_left_path / seal_right_path — the two badge files
-- (PNP seal left, station seal right) uploaded by an Admin. NULL means the
-- bundled artwork. The bytes live in storage/seals, outside the web root,
-- like the avatars (see App\Core\StationSeal).
--
-- Rollback: migrations/027_station_letterhead_doc.down.sql — drops all three
-- columns. A freed letterhead is lost with them (sheets fall back to the
-- composed lines); uploaded seal files left on disk are orphaned, not served.
ALTER TABLE station_settings
  ADD COLUMN letterhead_html MEDIUMTEXT NULL AFTER noted_by,
  ADD COLUMN seal_left_path VARCHAR(255) NULL AFTER letterhead_html,
  ADD COLUMN seal_right_path VARCHAR(255) NULL AFTER seal_left_path;
