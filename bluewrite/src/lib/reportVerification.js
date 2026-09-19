// BlueWrite — Phase 6 Stage 4: translation verification, client side.
// docs/PHASE6_MULTILINGUAL.md §5.4, decisions D3–D8.
//
// TWO jobs, both shared so the surfaces cannot disagree:
//
//  1. The STATUS VOCABULARY (D5). The server DERIVES the status; the client
//     only turns its code into a label and a CSS class. It never re-derives.
//  2. The HASH RULE (D6), which must equal the server's byte for byte
//     (app/core/ReportVerification.php): newline endings CRLF/CR → LF, then
//     SHA-256 hex over the UTF-8 bytes. Nothing else is normalized — see the
//     PHP docblock for why Unicode normalization is deliberately NOT applied.
//     A unit test asserts this module's output equals the PHP vectors.
//
// It also owns the WORDING of every new sentence this stage adds, so one unit
// test can prove none of them makes a claim the software must not make
// (Invariant 7): no "certified", "official", "accurate" or "valid".

/** The derived status codes, matching ReportVerification::CODE_* (D5). */
export const VERIFICATION_STATUSES = [
  'english_original',
  'not_translated',
  'translated',
  'verified',
  'disputed',
  'stale',
];

/** The status vocabulary, verbatim (D5). Nothing stronger may be said. */
export const STATUS_LABELS = {
  english_original: 'English original',
  not_translated: 'Not translated',
  translated: 'Translated — not independently verified',
  verified: 'Verified',
  disputed: 'Disputed',
  stale: 'Changed since verification',
};

/** A short badge-class fragment for each status. */
export const STATUS_CLASS = {
  english_original: 'plain',
  not_translated: 'untranslated',
  translated: 'unverified',
  verified: 'verified',
  disputed: 'disputed',
  stale: 'stale',
};

export const statusLabel = (code) => STATUS_LABELS[code] ?? '';
export const statusClass = (code) => STATUS_CLASS[code] ?? 'plain';

/** Words the software must never use to describe a translation (Invariant 7). */
export const FORBIDDEN_CLAIM_WORDS = ['certif', 'official', 'accurat', 'valid'];

/** Does this report carry a kept source (i.e. was it translated)? */
export function hasSource(report) {
  return String(report?.narrative_source_text ?? '').trim() !== '';
}

/** Only a report that carries a source can be verified. */
export const isVerifiable = hasSource;

/**
 * Does an account's recorded `languages_read` cover a source code? Mirrors
 * ReportVerification::userReadsLanguage. NULL or empty means "not recorded as
 * able to read any source", so no.
 *
 * NOTE: this is only for wording and layout. The SERVER decides who may verify
 * (VerificationController::store) and reports the answer as `can_verify`, so
 * the UI cannot widen the rule by disagreeing with it.
 *
 * @param {unknown} languagesRead comma-separated codes, or null
 * @param {unknown} code the report's source language
 */
export function userReadsLanguage(languagesRead, code) {
  const want = String(code ?? '').toLowerCase();
  if (want === '' || want === 'en') return true;
  return String(languagesRead ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .includes(want);
}

// ---------------------------------------------------------------------------
// The hash rule (D6) — MUST equal app/core/ReportVerification.php
// ---------------------------------------------------------------------------

/** Newline canonicalization ONLY. */
export function canonical(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * SHA-256 hex of the canonical text, as a Promise (browser SubtleCrypto; Node's
 * global crypto in the test runner both provide it).
 */
export async function canonicalHash(text) {
  const bytes = new TextEncoder().encode(canonical(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Wording (Invariant 7). Facts only: what was produced, and who reviewed it.
// ---------------------------------------------------------------------------

/** The verifier's statement on a successful review. */
export const verifiedStatement = (languageLabel) =>
  `I have read the original text in ${languageLabel} and the English narrative on this report, and compared them. ` +
  'So far as I can read the original, I state that the English narrative states the same facts.';

/** The verifier's statement on a dispute. */
export const disputedStatement = (languageLabel) =>
  `I have read the original text in ${languageLabel} and the English narrative on this report, and compared them. ` +
  'I state that they do not state the same facts; my note below says what differs.';

/** Non-blocking notice in the finalize dialog for a translated, unverified report. */
export const finalizeNotice = (languageLabel) =>
  `This report was translated from ${languageLabel}. No second officer has reviewed the translation. You can still file it.`;

/** The D6 rejection message. */
export const staleRejectionMessage =
  'The text changed since you opened it — reload the report and review it again. Nothing was recorded.';

// ---- The print appendix (wording approved at G2) ---------------------------

export const APPENDIX_HEADING = 'APPENDIX — ORIGINAL TEXT';

export const appendixIntro = (languageLabel) =>
  `This report was written in ${languageLabel}. The English narrative in this report was produced from the original ` +
  'text below with AI assistance and was reviewed and applied by the reporting officer. The original text is kept ' +
  'exactly as it was written.';

export const appendixSourceLabel = (languageLabel) => `ORIGINAL TEXT (${languageLabel}):`;

export const appendixVerifiedLine = (name, role, date) =>
  `Independently reviewed against the original by ${name}, ${role}, on ${date}: the reviewer states that, so far as ` +
  'they can read the original, the English narrative states the same facts.';

export const appendixDisputedLine = (name, role, date, note) =>
  `Reviewed against the original by ${name}, ${role}, on ${date}: the reviewer states that the texts do not state the ` +
  `same facts. Note: ${note}`;

export const appendixStaleLine = (name, date) =>
  `The original text or the English narrative has changed since it was reviewed by ${name} on ${date}. ` +
  'That review no longer applies to the current text.';

export const appendixNotReviewedLine = 'This translation has not been independently reviewed by a second officer.';

export const appendixCloseLine =
  'This appendix records what was produced and who reviewed it. It does not replace reading the original.';

/**
 * A review date, formatted for the record. MySQL DATETIME arrives as
 * "2026-09-19 10:00:00" and a space separator is parsed inconsistently across
 * engines, so normalize to ISO first — a wrong date printed on the appendix
 * would be its own small inaccuracy.
 */
const LONG_DATE = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
export function formatReviewDate(v) {
  if (!v) return '—';
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(v) : LONG_DATE.format(d);
}

/**
 * Which line the appendix prints for a status (D2/D8). Pure, so the exact
 * printed wording is unit-tested rather than buried in JSX — the print sheet is
 * the document of record and its sentences must be the approved ones.
 *
 * `review` is the latest record (or null). Only a `verified` / `disputed` /
 * `stale` status WITH a record names anyone; every other case states plainly
 * that no second officer has reviewed the translation.
 *
 * @param {unknown} statusCode the server-derived status code
 * @param {object|null} review the latest verification row, or null
 */
export function appendixReviewLine(statusCode, review) {
  if (!review) return appendixNotReviewedLine;
  const who = review.verifier_name ?? '—';
  const role = review.verifier_role ?? '';
  const when = formatReviewDate(review.verified_at);
  if (statusCode === 'verified') return appendixVerifiedLine(who, role, when);
  if (statusCode === 'disputed') return appendixDisputedLine(who, role, when, review.note);
  if (statusCode === 'stale') return appendixStaleLine(who, when);
  return appendixNotReviewedLine;
}

// ---- The verifier's panel (editor and review screen) -----------------------

export const VERIFY_PANEL_HEADING = 'Translation review';

export const verifyPanelIntro =
  'A second officer who reads the original language may record here that they compared the two texts. ' +
  'It is optional, and the report can be filed whether or not anyone reviews it.';

export const verifyNoSourceNotice =
  'This report carries no original text, so there is nothing to review against.';

export const verifySelfNotice =
  'The officer who wrote this report cannot be its reviewer.';

export const verifyLanguageNotice = (languageLabel) =>
  `Your account is not recorded as able to read ${languageLabel}, so you cannot review this translation. ` +
  'An administrator records which languages each account can read.';

export const verifyRecordedNotice = 'Your review has been recorded.';

export const verifyDisputePlaceholder = 'What differs between the original text and the English narrative?';

/** Every sentence this stage adds — the forbidden-word test iterates this. */
export const NEW_WORDING = [
  ...Object.values(STATUS_LABELS),
  VERIFY_PANEL_HEADING,
  verifyPanelIntro,
  verifyNoSourceNotice,
  verifySelfNotice,
  verifyLanguageNotice('Bisaya (Cebuano)'),
  verifyRecordedNotice,
  verifyDisputePlaceholder,
  verifiedStatement('Bisaya (Cebuano)'),
  disputedStatement('Bisaya (Cebuano)'),
  finalizeNotice('Bisaya (Cebuano)'),
  staleRejectionMessage,
  APPENDIX_HEADING,
  appendixIntro('Bisaya (Cebuano)'),
  appendixSourceLabel('Bisaya (Cebuano)'),
  appendixVerifiedLine('A. Officer', 'Officer', 'January 1, 2026'),
  appendixDisputedLine('A. Officer', 'Officer', 'January 1, 2026', 'the date differs'),
  appendixStaleLine('A. Officer', 'January 1, 2026'),
  appendixNotReviewedLine,
  appendixCloseLine,
];
