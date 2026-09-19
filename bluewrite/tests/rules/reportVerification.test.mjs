// Phase 6 Stage 4 — the client verification module.
// Covers the two shared contracts: the status vocabulary (D5) and the hash rule
// (D6). The hash vectors are ALSO asserted in tests/ReportVerificationTest.php,
// which is what proves the client and the server hash identically.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFICATION_STATUSES,
  STATUS_LABELS,
  STATUS_CLASS,
  FORBIDDEN_CLAIM_WORDS,
  NEW_WORDING,
  statusLabel,
  statusClass,
  hasSource,
  isVerifiable,
  userReadsLanguage,
  canonical,
  canonicalHash,
  verifiedStatement,
  disputedStatement,
  finalizeNotice,
  staleRejectionMessage,
  APPENDIX_HEADING,
  appendixIntro,
  appendixSourceLabel,
  appendixVerifiedLine,
  appendixDisputedLine,
  appendixStaleLine,
  appendixNotReviewedLine,
  appendixCloseLine,
  formatReviewDate,
  appendixReviewLine,
  verifyPanelIntro,
  verifyNoSourceNotice,
  verifySelfNotice,
  verifyLanguageNotice,
} from '../../src/lib/reportVerification.js';

// --- the status vocabulary (D5) --------------------------------------------

test('every status code has a label and a class, and labels are the approved wording', () => {
  assert.deepEqual(VERIFICATION_STATUSES, [
    'english_original', 'not_translated', 'translated', 'verified', 'disputed', 'stale',
  ]);
  for (const code of VERIFICATION_STATUSES) {
    assert.equal(typeof STATUS_LABELS[code], 'string');
    assert.ok(STATUS_LABELS[code].length > 0, `${code} needs a label`);
    assert.equal(typeof STATUS_CLASS[code], 'string');
    assert.equal(statusLabel(code), STATUS_LABELS[code]);
    assert.equal(statusClass(code), STATUS_CLASS[code]);
  }
  assert.equal(STATUS_LABELS.translated, 'Translated — not independently verified');
  assert.equal(STATUS_LABELS.stale, 'Changed since verification');
  assert.equal(statusLabel('nope'), '');
});

// --- source detection -------------------------------------------------------

test('only a report with a stored source is verifiable', () => {
  assert.equal(hasSource({ narrative_source_text: 'Nasakpan.' }), true);
  assert.equal(isVerifiable({ narrative_source_text: 'Nasakpan.' }), true);
  assert.equal(hasSource({ narrative_source_text: '' }), false);
  assert.equal(hasSource({ narrative_source_text: null }), false);
  assert.equal(hasSource({}), false);
});

// --- who reads which language (mirrors ReportVerification::userReadsLanguage) ---

test('userReadsLanguage mirrors the server rule', () => {
  assert.equal(userReadsLanguage('ceb,tl', 'ceb'), true);
  assert.equal(userReadsLanguage(' CEB ', 'ceb'), true);
  assert.equal(userReadsLanguage('ceb', 'tl'), false);
  assert.equal(userReadsLanguage(null, 'ceb'), false);
  assert.equal(userReadsLanguage('', 'ceb'), false);
  // An 'en' source never exists (nothing was translated), so it is always true.
  assert.equal(userReadsLanguage(null, 'en'), true);
  assert.equal(userReadsLanguage(null, ''), true);
});

// --- the appendix (D2) -------------------------------------------------------

test('the appendix status lines state who reviewed what, and when', () => {
  const verified = appendixVerifiedLine('A. Officer', 'Officer', 'January 1, 2026');
  assert.match(verified, /Independently reviewed against the original by A\. Officer, Officer, on January 1, 2026/);
  assert.match(verified, /states the same facts/);

  const disputed = appendixDisputedLine('A. Officer', 'Officer', 'January 1, 2026', 'the date differs');
  assert.match(disputed, /do not state the same facts/);
  assert.match(disputed, /Note: the date differs/);

  const stale = appendixStaleLine('A. Officer', 'January 1, 2026');
  assert.match(stale, /has changed since it was reviewed/);
  assert.match(stale, /no longer applies/);
});

test('appendixReviewLine picks the approved sentence for every status', () => {
  const review = {
    verifier_name: 'A. Officer',
    verifier_role: 'Officer',
    verified_at: '2026-09-19 10:00:00',
    note: 'the date differs',
  };
  // translated / unverified, and no record at all → the not-reviewed line.
  assert.equal(appendixReviewLine('translated', null), appendixNotReviewedLine);
  assert.equal(appendixReviewLine('translated', review), appendixNotReviewedLine);
  assert.equal(appendixReviewLine('stale', null), appendixNotReviewedLine);
  assert.equal(appendixReviewLine(null, null), appendixNotReviewedLine);

  assert.match(appendixReviewLine('verified', review), /Independently reviewed against the original by A\. Officer, Officer, on September 19, 2026/);
  assert.match(appendixReviewLine('disputed', review), /do not state the same facts/);
  assert.match(appendixReviewLine('disputed', review), /Note: the date differs/);
  assert.match(appendixReviewLine('stale', review), /has changed since it was reviewed by A\. Officer on September 19, 2026/);
});

test('formatReviewDate reads a MySQL DATETIME, and never invents a date', () => {
  assert.equal(formatReviewDate('2026-09-19 10:00:00'), 'September 19, 2026');
  assert.equal(formatReviewDate(null), '—');
  assert.equal(formatReviewDate(''), '—');
});

// --- the review panel wording (Invariant 7) ---------------------------------

test('the panel wording states facts and never asserts quality', () => {
  assert.match(verifyPanelIntro, /It is optional/);
  assert.match(verifyPanelIntro, /can be filed whether or not anyone reviews it/);
  assert.match(verifyNoSourceNotice, /nothing to review against/);
  assert.match(verifySelfNotice, /cannot be its reviewer/);
  assert.match(verifyLanguageNotice('Tagalog'), /not recorded as able to read Tagalog/);
});

// --- the hash rule (D6) -----------------------------------------------------

test('canonical replaces CRLF and lone CR with LF, and nothing else', () => {
  assert.equal(canonical('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  // No trimming, no whitespace collapse, no Unicode normalization.
  assert.equal(canonical('  spaced  \n\n'), '  spaced  \n\n');
  assert.equal(canonical('tabs\tand  spaces'), 'tabs\tand  spaces');
});

test('canonicalHash matches the server vectors byte for byte', async () => {
  // These exact hex strings are asserted in tests/ReportVerificationTest.php.
  assert.equal(await canonicalHash('Hello\r\nWorld'), '35c6b9f66dceb6cf8f733d08689564e420e18eb40250d9435352617c027f36d6');
  assert.equal(await canonicalHash('Peña\nline2'), 'c71490699d2e142aa588849aaf79ac6f328193b4b06706c61968862ac7ca83f9');
  // CRLF and LF forms of the same text hash the same — the whole point.
  assert.equal(await canonicalHash('a\r\nb'), await canonicalHash('a\nb'));
  // A diacritic is NOT normalized away: ñ stays distinct from n.
  assert.notEqual(await canonicalHash('Peña'), await canonicalHash('Pena'));
});

// --- Invariant 7: no forbidden claim wording --------------------------------

test('no new sentence uses a forbidden claim word', () => {
  for (const sentence of NEW_WORDING) {
    const lower = String(sentence).toLowerCase();
    for (const word of FORBIDDEN_CLAIM_WORDS) {
      assert.ok(
        !lower.includes(word),
        `forbidden claim word "${word}" in: ${sentence}`,
      );
    }
  }
});

test('the statements and appendix lines state facts only', () => {
  assert.match(verifiedStatement('Bisaya (Cebuano)'), /states the same facts/);
  assert.match(disputedStatement('Tagalog'), /my note below says what differs/);
  assert.match(finalizeNotice('Tagalog'), /You can still file it/);
  assert.match(staleRejectionMessage, /reload the report and review it again/);
  assert.equal(APPENDIX_HEADING, 'APPENDIX — ORIGINAL TEXT');
  assert.match(appendixIntro('Bisaya (Cebuano)'), /produced from the original/);
  assert.equal(appendixSourceLabel('Tagalog'), 'ORIGINAL TEXT (Tagalog):');
  assert.match(appendixNotReviewedLine, /has not been independently reviewed/);
  assert.match(appendixCloseLine, /does not replace reading the original/);
});
