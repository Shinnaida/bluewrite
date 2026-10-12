-- BlueWrite migration 020, reversed.
--
-- Dropping the column loses only the SECONDARY types of a compound report: the
-- primary is `incident_type`, which no migration here touches, and every report
-- this app has ever written has one. A row written while this column existed
-- would come back as a single-type report carrying its primary type's fields and
-- its party groups — the facts of the other type are still in `type_specific`,
-- so nothing an officer typed is destroyed by this, only the list that said which
-- sections to draw.

ALTER TABLE reports
  DROP COLUMN incident_types;
