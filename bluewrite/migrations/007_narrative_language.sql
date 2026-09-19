-- BlueWrite migration 007: the language the narrative is written in.
--
-- Phase 6 Stage 1 (docs/PHASE6_MULTILINGUAL.md §5.4). An officer who writes
-- better in Bisaya or Tagalog than in English declares the language of the
-- NARRATIVE field and writes it in that language. Stage 1 stores the
-- declaration and the officer's words; it translates nothing
-- (invariant 2 of the plan: no AI writes into the report).
--
-- narrative_language — the language `narrative` is written in, as DECLARED by
--   the officer. It is never detected: §8 Q2 of the plan settles that, because
--   detection by function words is unreliable (ang, sa and nga are shared
--   between Tagalog and Cebuano) and a wrong guess would silently apply the
--   wrong terminology table in Stage 2.
--
--   Allowed codes, validated in the API (not by the column type):
--     'en'    English           (the default, and every existing row)
--     'ceb'   Bisaya / Cebuano
--     'tl'    Tagalog
--     'mixed' more than one, in one narrative
--     'other' a language the station has not listed
--
--   NOT NULL DEFAULT 'en' does two jobs:
--     * every row that exists when this runs becomes 'en' — which is what
--       those rows are, because the app has only ever accepted English; and
--     * a client that does not send the field (an older build, the API driven
--       directly, a future import) stays valid rather than failing on a
--       column it has never heard of.
--
--   "Untranslated" is DERIVED (narrative_language <> 'en') and is deliberately
--   NOT stored: a stored flag can disagree with the language it describes.
--
--   VARCHAR(20) + validation rather than ENUM is this project's convention for
--   a list that is expected to grow — the same choice `incident_type` already
--   makes (001_schema.sql:34, validated in ReportsController::allowedTypes()).
--   ENUM is the house style for CLOSED sets (reports.status); §8 Q2 expects
--   more languages later, and an ENUM would make each addition an ALTER TABLE.
--
-- narrative_source_text — the officer's VERBATIM native-language text, kept
--   when a translation replaces `narrative`. Plan §5.4: a translated official
--   report whose source is gone cannot be audited — by a reviewing officer, by
--   the station, or in court.
--
--   NAMED `narrative_source_text`, NOT `narrative_source`, ON PURPOSE.
--   `narrative_source` is ALREADY an API request field meaning how the
--   narrative was AUTHORED ('manual' | 'ai-assisted'): the editor posts it on
--   every save (Reports.jsx) and the API reads it at
--   ReportsController::update() to tag the history note. One database column
--   cannot carry both meanings — a save would write the literal string
--   'manual' into a column reserved for a person's own words in Bisaya.
--
--   Created here, and deliberately NOT written and NOT shown by any Stage 1
--   code: Stage 3 populates it, at the moment an AI translation first replaces
--   native text. Until then it is NULL on every row and no read path looks at
--   it (ReportsController's whole-row snapshot copies it, which is the point —
--   see §5.4).
--
-- Charset: the table declares DEFAULT CHARSET=utf8mb4 (001_schema.sql:46), so
--   both columns inherit utf8mb4 at COLUMN level. No explicit CHARACTER SET or
--   COLLATE is given, matching the house convention in 005 and 006; the
--   migration test asserts the resulting column charset rather than assuming
--   it. (Column-level charset is what matters here: `narrative` is TEXT and
--   utf8mb4 is what lets a 4-byte character survive the round trip.)
--
-- No index is added: nothing filters or sorts by the language. ReportsController
-- ::index() only SELECTs it (for the editor's suggested default, D7) and a
-- selected column needs no index.
--
-- Rollback: migrations/007_narrative_language.down.sql — the house had no
--   down convention before this; Phase 6 introduces one (`NNN_name.down.sql`).
--   That file states plainly what it loses.

ALTER TABLE reports
  ADD COLUMN narrative_language VARCHAR(20) NOT NULL DEFAULT 'en' AFTER narrative,
  ADD COLUMN narrative_source_text TEXT NULL AFTER narrative_language;

-- Every existing row already holds 'en' from the DEFAULT above: MySQL fills
-- existing rows when a NOT NULL column with a default is added to a table.
-- This statement states that intent in the file itself, and guarantees the
-- column can only ever hold an allowed code — so a value that arrived outside
-- the API cannot sit in the table looking like a valid declaration.
--
-- It is a no-op on a clean run (every row is already 'en'), it touches no
-- other column, and it never reads or writes `narrative`.
UPDATE reports
   SET narrative_language = 'en'
 WHERE narrative_language = ''
    OR narrative_language NOT IN ('en', 'ceb', 'tl', 'mixed', 'other');
