-- BlueWrite migration 018: the reporting party's CAPACITY.
--
-- Panel I (REPORTING PARTY INFORMATION) records WHO is filing the report and,
-- with this column, in WHAT CAPACITY. The reporting party is not always the
-- victim or the driver: a traffic accident is routinely reported by a passenger,
-- a barangay official or the responding officer, a missing-person case by a
-- parent, a drug case by the arresting team. Without this label a reader cannot
-- tell whether the person on the signature line is the aggrieved party or the
-- one who merely brought the matter to the station.
--
-- It complements the per-type PARTY RECORDS rather than duplicating them: the
-- complainant / victim, suspect/respondent, witness, injured persons and the
-- rest live in the report's type_specific groups (see GROUP_CONFIG in
-- src/lib/incidentTypes.js and ReportRules::groupsFor in PHP). Nothing a group
-- already records is copied here.
--
-- The value is an ALLOWLIST shared by both engines — REPORTER_ROLES in
-- src/lib/incidentTypes.js and ReportRules::REPORTER_ROLES in
-- app/rules/report_rules.php — never free text. The server rejects a value the
-- list does not carry.
--
-- NULLable on purpose: every existing report, and any older client that does not
-- send the key, keeps working untouched. The requirement (a name and a contact
-- number must exist before a report can be finalized) is a RULE, not a NOT NULL:
-- a draft is allowed to be half-written, and 295 existing rows have no reporter.

ALTER TABLE reports
  ADD COLUMN reporter_role VARCHAR(40) NULL AFTER reporter_address;
