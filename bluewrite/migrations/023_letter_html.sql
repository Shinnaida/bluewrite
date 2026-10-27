-- BlueWrite migration 023: the letter's own text (free edit).
--
-- letter_html — the officer's free-typed letter body, stored as the same
-- allowlisted HTML subset the sheet renders (see RichText::sanitizeLetter).
-- It holds ONLY the body below the letterhead: the station header, the
-- signature block and the translation appendix stay composed from system
-- data, so a freed letter can never lose its seals or its signatories.
-- NULL/empty means "no override" and the sheet composes the letter from
-- the report's fields exactly as before, so old reports keep printing
-- what they always printed. MEDIUMTEXT because a full letter of nested
-- divs and spans runs an order of magnitude larger than a prose field.
--
-- Rollback: migrations/023_letter_html.down.sql — drops the column. Any
-- freed letters are lost with it; the fields they were seeded from remain,
-- so affected reports fall back to the composed letter.

ALTER TABLE reports
  ADD COLUMN letter_html MEDIUMTEXT NULL AFTER action_taken;
