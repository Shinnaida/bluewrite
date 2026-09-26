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
