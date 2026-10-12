-- BlueWrite migration 020: one report, more than one incident type.
--
-- A compound incident — a break-in that is also a theft, an accident that is
-- also a physical injury — used to have to be filed twice, splitting one account
-- of one event across two records, or filed under one type and lose the facts the
-- other type's block exists to hold.
--
-- `incident_type` therefore keeps its meaning UNCHANGED: it is the PRIMARY type,
-- the first one chosen, and every reader that predates this column (the folders,
-- the register's type filter and sort, the dashboard bands, the printed block
-- order, the AI prompt) goes on reading it exactly as it did. The list is what
-- the form reads.
--
-- JSON rather than a join table: the list is part of the report's own identity,
-- it is read and written whole with the row, and nothing queries it by element.
-- NULL means "written before this column existed" — the app falls back to
-- [incident_type], which is also what every API client that does not send a list
-- gets (see ReportsController::incidentTypesFrom()).

ALTER TABLE reports
  ADD COLUMN incident_types JSON NULL AFTER incident_type;
