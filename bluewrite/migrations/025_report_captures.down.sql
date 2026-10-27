-- Rollback for migration 025: drops the capture rows. The files under
-- storage/report_captures/ are left on disk and must be removed by hand.

DROP TABLE IF EXISTS report_captures;
