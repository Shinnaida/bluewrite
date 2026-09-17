-- BlueWrite migration 004: disposition fields printed on the report sheet.
--
-- action_taken — the officer's own Action Taken / Status text. The sheet
--   prints it in the ACTION TAKEN / STATUS block, above the standard
--   station lines. NULL/empty means "nothing recorded by the officer" and
--   the sheet falls back to the generated disposition lines only.
-- ioc_name — the investigator-on-case who signs the "IOC:" line of the
--   printed report. NULL leaves the line blank for a manual signature.
--
-- Both are NULL for rows created before this migration; the app treats
-- missing/NULL as absent, so old reports keep printing exactly as before.

ALTER TABLE reports
  ADD COLUMN action_taken TEXT NULL AFTER type_specific,
  ADD COLUMN ioc_name VARCHAR(120) NULL AFTER action_taken;
