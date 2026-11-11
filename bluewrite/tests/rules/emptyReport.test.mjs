// BlueWrite — no blank records (owner request).
//
// Completeness is bypassed, so a half-written draft saves and finalizes —
// but a report with NOTHING inputted yet is no report at all. The explicit
// presses (Save Draft, Finalized) refuse it with an error naming what to do
// instead of filing emptiness. Silent writes (exit flush, AI id) never pass
// through here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('an untouched draft reads as empty, any ink reads as a report', () => {
  const src = code(REPORTS);
  const at = src.indexOf('function draftIsEmpty(d)');
  assert.notEqual(at, -1, 'draftIsEmpty is gone');
  const body = src.slice(at, src.indexOf('\n}', at));
  // The common fields, the prose fields (tags stripped) and every
  // type-specific cell are all read — ink anywhere means a report.
  for (const key of ['incident_type', 'incident_datetime', 'location', 'narrative', 'action_taken', 'letter_html', 'type_specific']) {
    assert.ok(body.includes(key), `draftIsEmpty no longer reads ${key}`);
  }
});

test('Save Draft refuses a blank report with an error', () => {
  const src = code(REPORTS);
  const at = src.indexOf('async function saveDraft()');
  assert.notEqual(at, -1, 'saveDraft is gone');
  const body = src.slice(at, src.indexOf('async function printSlip()', at));
  assert.match(body, /if \(draftIsEmpty\(draft\)\)/, 'saveDraft no longer refuses a blank report');
  assert.match(body, /There is nothing to save yet/, 'the refusal lost its error');
});

test('Finalized refuses a blank report before any review opens', () => {
  const src = code(REPORTS);
  const at = src.indexOf('async function finalize()');
  assert.notEqual(at, -1, 'finalize is gone');
  const end = src.indexOf('async function confirmFinalize()', at);
  const body = src.slice(at, end);
  assert.match(body, /if \(draftIsEmpty\(draft\)\)/, 'finalize no longer refuses a blank report');
  assert.match(body, /There is nothing to finalize yet/, 'the refusal lost its error');
  // The refusal comes FIRST: a blank must never reach the review sheet.
  assert.ok(
    body.indexOf('draftIsEmpty') < body.indexOf('checkFullRules'),
    'the blank refusal no longer runs before the rules',
  );
});
