-- BlueWrite migration 002: Phase 3 structured type-specific fields.
-- Adds a JSON column holding the per-incident-type field set defined by
-- docs/architecture-for-AI/report-generation-engine-prompt.md (Section 3).
-- NULL for legacy rows; the app treats missing/NULL as "no specific fields".
-- incident_type stays VARCHAR(60) — the 14-type list is enforced in PHP
-- (ReportsController::TYPES), not by the schema.

ALTER TABLE reports
  ADD COLUMN type_specific JSON NULL AFTER narrative;
