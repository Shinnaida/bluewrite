-- BlueWrite migration 006: reporting party + signature block.
--
-- Spec: "Official Incident Reporting System" — the Submit Report screen.
--
-- Panel I (REPORTING PARTY INFORMATION) records who is filing the report.
-- That is NOT the same person as the logged-in officer (reports.created_by,
-- which the sheet prints on the "Recorded by:" line) and not the same as a
-- victim/witness group item: an organization can report an incident it is
-- not a party to, and one report can list several victims while only one
-- person files it.
--
-- Panel IV (SIGNATURES):
--   officer_initials  — the officer's initials, typed under the officer box
--   party_signed_at   — timestamp of the reporting party's signature, set by
--                       the API when the report is finalized (the moment the
--                       officer submits the document)
--
-- Every column is NULLable: the 295 existing reports, their drafts, and any
-- older client that does not send these keys keep working untouched.

ALTER TABLE reports
  ADD COLUMN reporter_name VARCHAR(160) NULL AFTER ioc_name,
  ADD COLUMN reporter_id_no VARCHAR(60) NULL AFTER reporter_name,
  ADD COLUMN reporter_contact VARCHAR(40) NULL AFTER reporter_id_no,
  ADD COLUMN reporter_email VARCHAR(160) NULL AFTER reporter_contact,
  ADD COLUMN reporter_address VARCHAR(255) NULL AFTER reporter_email,
  ADD COLUMN officer_initials VARCHAR(12) NULL AFTER reporter_address,
  ADD COLUMN party_signed_at DATETIME NULL AFTER officer_initials;
