-- Rollback for 023_letter_html.sql.
--
-- Drops the free-letter column. Any letters the officers freed are lost with
-- it; the report fields every override was seeded from remain untouched, so
-- affected reports fall back to the composed letter — the same letter they
-- printed before they were ever freed.

ALTER TABLE reports
  DROP COLUMN letter_html;
