-- Rollback for 032: the draft's provenance mark goes away. Text filings stop
-- reaching the arrival banner; the capture-driven banner is unaffected.
ALTER TABLE reports DROP COLUMN filed_from;
