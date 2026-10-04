// BlueWrite — the printed sheet's pure fact builders.
//
// Task 7 added a labeled "Date of Discovery" line to the Theft and Burglary
// templates (distinct from "Date & Time of Incident"); this pins it so the
// field added to both engines actually reaches the sheet. Task 2's proper-noun
// collector is pinned here too, since the casing pass reads it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTypeFacts, properNounsFor } from '../../src/lib/sheetFacts.js';

const labels = (type, ts, report = {}) =>
  buildTypeFacts(type, { report, ts }).map((e) => e.label);

test('Theft prints "Date of Discovery" when one is recorded', () => {
  const ls = labels('Theft', { date_of_discovery: '2026-09-24' });
  assert.ok(ls.includes('Date of Discovery'), ls.join(' | '));
});

test('Theft omits "Date of Discovery" when none is recorded (never invented)', () => {
  const ls = labels('Theft', {});
  assert.ok(!ls.includes('Date of Discovery'), ls.join(' | '));
});

test('Burglary / Break-In prints "Date of Discovery" when recorded', () => {
  const ls = labels('Burglary / Break-In', { date_of_discovery: '2026-09-24' });
  assert.ok(ls.includes('Date of Discovery'), ls.join(' | '));
});

test('"Date of Discovery" is formatted like the sheet\'s other dates', () => {
  const entry = buildTypeFacts('Theft', {
    report: {},
    ts: { date_of_discovery: '2026-09-24' },
  }).find((e) => e.label === 'Date of Discovery');
  assert.equal(entry.values[0], 'September 24, 2026');
});

test('Missing Person "Last Seen" prints the template date/time, not raw ISO', () => {
  const entry = buildTypeFacts('Missing Person', {
    report: {},
    ts: { location_last_seen: 'Ctu Naga', date_last_seen: '2026-09-23', time_last_seen: '09:00' },
  }).find((e) => e.label === 'Last Seen');
  assert.equal(entry.values[0], 'Ctu Naga, September 23, 2026 9:00 A.M.');
});

test('properNounsFor collects party names and the capitalized words of the place', () => {
  const names = properNounsFor(
    { location: 'Public market, Barangay Dagatan' },
    { complainant: [{ name: 'Shaine Jayme' }] },
  );
  assert.ok(names.includes('Shaine Jayme'));
  assert.ok(names.includes('Dagatan'));
  // A lower-cased word of the place is NOT promoted to a proper noun.
  assert.ok(!names.includes('market'));
});

// ---- The AI draft's own Suspect sentence in the facts block -------------------
// While a draft is under review the sheet's Suspect row reads the model's own
// formalised sentence for the row it describes (the record's raw values are
// what the officer typed; the sentence is what the draft proposes). The report
// itself is never written from them — preview only.
const RAW_SUSPECT = {
  sex: 'Male',
  hair: 'Black',
  clothing: 'He is wear a violet jacket',
  suspect_status: 'Unidentified',
  distinguishing_features: 'Have big nose',
};
const FORMAL_LINE =
  'One unidentified male, described as Black, was reportedly wearing a violet jacket and had a prominent nose.';

const suspectValue = (ts, suspectLines) =>
  buildTypeFacts('Rape / Sexual Assault', { report: {}, ts, suspectLines })
    .find((e) => e.label === 'Suspect').values[0];

test('the record\'s raw suspect values compose the sheet line when no draft is under review', () => {
  assert.equal(
    suspectValue({ respondent: [RAW_SUSPECT] }, null),
    'One unidentified male, Black, He is wear a violet jacket, Have big nose',
  );
});

test('the draft\'s own sentence replaces the raw line on the row it describes', () => {
  assert.equal(
    suspectValue({ respondent: [RAW_SUSPECT] }, [{ row: 0, line: FORMAL_LINE }]),
    FORMAL_LINE,
  );
});

test('a row the model did not describe keeps the record\'s own line', () => {
  const values = buildTypeFacts('Theft', {
    report: {},
    ts: { respondent: [{ name: 'Pedro Reyes', age: '34', sex: 'Male' }, RAW_SUSPECT] },
    suspectLines: [{ row: 1, line: FORMAL_LINE }],
  }).find((e) => e.label === 'Suspect').values;
  assert.deepEqual(values, ['Pedro Reyes, 34, Male', FORMAL_LINE]);
});

test('a line with no row, a blank line or a non-row key is ignored', () => {
  const ts = { respondent: [RAW_SUSPECT] };
  const raw = 'One unidentified male, Black, He is wear a violet jacket, Have big nose';
  assert.equal(suspectValue(ts, [{ row: 4, line: FORMAL_LINE }]), raw);
  assert.equal(suspectValue(ts, [{ row: 0, line: '   ' }]), raw);
  assert.equal(suspectValue(ts, [{ nope: true }, { row: 'x', line: FORMAL_LINE }]), raw);
});
