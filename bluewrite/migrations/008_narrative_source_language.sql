-- BlueWrite migration 008: the language of the kept source text.
--
-- Phase 6 Stage 3 (docs/PHASE6_MULTILINGUAL.md §5.4, decision D1). Stage 1
-- created `narrative_source_text` — the officer's VERBATIM native-language
-- words, kept when a translation replaces `narrative` — but wrote nothing into
-- it. Stage 3 populates it the moment an AI translation first replaces native
-- text, and this migration adds the column that says WHICH language those kept
-- words are in.
--
-- narrative_source_language — the declared language of `narrative_source_text`,
--   using the SAME code set Stage 1 established for `narrative_language`
--   (ReportsController::NARRATIVE_LANGUAGES):
--     'ceb'   Bisaya / Cebuano
--     'tl'    Tagalog
--     'mixed' more than one, in one source text
--     'other' a language the station has not listed
--   'en' is NOT a valid source language: a source already in English is not a
--   source (nothing was translated). The API enforces that, not the column.
--
-- NULLABLE, and PAIRED with `narrative_source_text` — both set, or both NULL.
--   A report that was never translated has no source and therefore no source
--   language; every row that exists now is in exactly that state. The pairing
--   is a validation rule in the API (ReportsController), because the column
--   type cannot express "these two are one fact".
--
--   Deliberately a separate column from `narrative_language`: once a draft is
--   applied, `narrative` is English (`narrative_language = 'en'`) while the
--   kept source is Bisaya/Tagalog — one column cannot carry both.
--
-- VARCHAR(20) + validation rather than ENUM, matching 007 and the
--   `incident_type` convention: §8 Q2 expects more languages later, and an
--   ENUM would make each addition an ALTER TABLE.
--
-- Charset: inherited from the table's DEFAULT CHARSET=utf8mb4 (001_schema.sql),
--   as in 005–007. No explicit CHARACTER SET or COLLATE is given.
--
-- No index: nothing filters or sorts by it; the read paths only SELECT it.
--
-- Rollback: migrations/008_narrative_source_language.down.sql — states plainly
--   what it loses.

ALTER TABLE reports
  ADD COLUMN narrative_source_language VARCHAR(20) NULL AFTER narrative_source_text;

-- A declared source LANGUAGE with no source TEXT is meaningless, so clear it.
-- A no-op on a clean run (the column is NULL on every existing row), it touches
-- no other column, and it never reads or writes `narrative`, `narrative_language`
-- or `narrative_source_text`.
UPDATE reports
   SET narrative_source_language = NULL
 WHERE narrative_source_text IS NULL
   AND narrative_source_language IS NOT NULL;
