-- BlueWrite migration 009: the translation verification record.
--
-- Phase 6 Stage 4 (docs/PHASE6_MULTILINGUAL.md §5.4, §8 Q6, decisions D1/D3).
-- A translated report can be independently reviewed by a SECOND officer who
-- reads the source language. That act is a human attestation — not a proof,
-- not automation — and it is recorded HERE, permanently, bound to the exact
-- texts the reviewer saw.
--
-- APPEND-ONLY. The application exposes no UPDATE and no DELETE path for this
-- table at all: a correction is a new row, and a later verification or dispute
-- is a new row. There is deliberately no `updated_at`, and no soft-delete
-- column — the record of a review is not something to edit.
--
-- WHY HASHES. A verification that merely said "reviewed" could later vouch for
-- words that changed after the reviewer looked (Invariant 4). Each row records
-- the SHA-256 of BOTH texts exactly as the verifier saw them, so the current
-- texts can be compared against it at read time and a changed pair reports as
-- "changed since verification" instead of silently carrying the old review
-- forward.
--
--   narrative_hash — SHA-256 hex of the English narrative the verifier saw.
--   source_hash    — SHA-256 hex of the officer's original text they saw.
--   Both are the same canonical form everywhere (app/core/ReportVerification.php
--   and src/lib/reportVerification.js): newline endings CRLF/CR → LF, then
--   SHA-256 over the UTF-8 bytes. NOTHING else is normalized — no trimming, no
--   whitespace collapse, no Unicode normalization.
--
-- COLUMNS
--   report_id      — the report under review (FK, as report_history uses).
--   verifier_id    — the signed-in user who performed the review. SERVER-SET
--                    from the session; a client-supplied value is ignored.
--   verified_at    — server clock at the moment of the act.
--   outcome        — 'verified' | 'disputed'. Exactly two outcomes.
--   note           — required when outcome='disputed' (what is wrong); the
--                    requirement is enforced in the API, because the column
--                    cannot express "required only for one enum value".
--   source_language— the declared language of the source the reviewer saw,
--                    using the Stage 1 code set (ceb | tl | mixed | other).
--                    Recorded on the row so the attestation names what was
--                    being read, independent of later changes to the report.
--
-- KEY/INDEX CHOICE: `BIGINT` id like audit_logs (this table can only grow), and
-- two composite indexes covering the only two reads — "the verifications of
-- one report, newest first" (report_id, id) and "what has this user verified"
-- (verifier_id, id). No index on outcome or verified_at: nothing filters on
-- them alone.
--
-- NO SEED, AND NO AUTOMATION. This migration creates an empty table. Nothing —
-- not a migration, not a seed, not a default — may create a verification; only
-- an authenticated human request through the endpoint may (Invariant 3).
--
-- Rollback: migrations/009_report_verification.down.sql — states plainly what
--   it loses.

CREATE TABLE IF NOT EXISTS report_verifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id INT UNSIGNED NOT NULL,
  verifier_id INT UNSIGNED NOT NULL,
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome ENUM('verified','disputed') NOT NULL,
  note VARCHAR(1000) NULL,
  source_language VARCHAR(20) NOT NULL,
  narrative_hash CHAR(64) NOT NULL,
  source_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rv_report FOREIGN KEY (report_id) REFERENCES reports (id),
  CONSTRAINT fk_rv_verifier FOREIGN KEY (verifier_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_rv_report ON report_verifications (report_id, id);
CREATE INDEX idx_rv_verifier ON report_verifications (verifier_id, id);
