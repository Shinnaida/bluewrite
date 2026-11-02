-- BlueWrite migration 028: the letterhead's presentation as data.
--
-- station_settings.letterhead_style — a JSON object with the freed
-- letterhead's typography and seal arrangement:
--   { font, size_px, line_height, letter_spacing_px, color, align, seals }
-- (see Station::letterheadStyle() for the defaults and the accepted values).
--
-- It is DATA, not markup: the stored letter HTML keeps no style of its own
-- (the sanitizer still strips every style attribute), and every sheet
-- renders this object as the container's own inline style. A station that
-- never sets it prints exactly what it printed before.
--
-- Rollback: migrations/028_letterhead_style.down.sql — drops the column; a
-- customized letterhead falls back to the built-in presentation.
ALTER TABLE station_settings
  ADD COLUMN letterhead_style JSON NULL AFTER seal_right_path;
