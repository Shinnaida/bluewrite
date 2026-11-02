// BlueWrite — printed ACTION TAKEN / STATUS composition tests.
// Runs with Node's built-in runner (see package.json "test"). Covers: the
// block prints only what the officer recorded (no on-file stand-in, no
// automatic routing line — both retired as canned defaults, owner requests
// 2026-10-31); the disclaimer wording is gone; the medico-legal examination
// is not repeated when the per-type fact block already prints it; and the
// officer's own lines still lead the block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActionBlock, REFERRAL_LINE, ON_FILE_NOTE } from '../../src/lib/printActions.js';

const MEDICO = 'Medico-legal examination: Conducted.';
// "labels" as the sheet's per-type fact block prints them.
const RAPE_LABELS = ['Place of Incident', 'Date and Time of Incident', 'Victim', 'Suspect', 'Medico-Legal Examination'];

test('the block reproduces the reported sheet: no second disposition', () => {
  // The exact case in the bug report — report BW-0294, whose recorded
  // disposition is "endorsed to follow up investigation".
  const lines = buildActionBlock({
    recordedLines: ['The case was endorsed for a follow-up investigation by this Office.'],
    structured: [MEDICO],
    perTypeLabels: RAPE_LABELS,
    finalizedLine: '',
  });
  assert.deepEqual(lines, [
    'The case was endorsed for a follow-up investigation by this Office.',
  ]);
  assert.ok(!lines.includes(REFERRAL_LINE), 'a referral the officer already recorded must not be restated');
  assert.ok(!lines.includes(MEDICO), 'the medico-legal exam already prints as a per-type fact');
});

test('an empty block stays empty — no canned stand-in, no routing line', () => {
  // Owner request 2026-10-31: with nothing recorded the block prints nothing
  // at all, instead of the old "entry is on file" + referral defaults.
  assert.deepEqual(buildActionBlock({}), []);
  assert.deepEqual(buildActionBlock({ recordedLines: ['', '   '] }), []);
  // A recorded disposition says what was done; a line telling the reader the
  // entry exists adds nothing about the case and is not printed beside it.
  assert.ok(
    !buildActionBlock({ recordedLines: ['Suspect arrested and detained.'] }).includes(ON_FILE_NOTE),
    'a disposition must not be followed by the on-file note'
  );
  assert.ok(
    !buildActionBlock({ structured: ['Suspect status: At large.'] }).includes(ON_FILE_NOTE),
    'a recorded state already fills the block'
  );
});

test('no disposition ever prints a disclaimer about its own record', () => {
  const variants = [
    { recordedLines: ['endorsed to follow up investigation'] },
    { recordedLines: ['responded 10pm, gave warning, no injuries'] },
    { recordedLines: [] },
  ];
  for (const v of variants) {
    const text = buildActionBlock(v).join('\n');
    assert.ok(!/subject to further verification/i.test(text), 'the draft disclaimer is gone');
  }
});

test('the routing line is never emitted — a referral is the officer’s own line', () => {
  // Owner request 2026-10-31: the canned referral is retired. A disposition
  // that states no onward action prints exactly as recorded — beside a
  // settled case ("both parties amicably settled") no referral may appear.
  const plain = ['responded 10pm, talked to both parties, gave warning, no injuries'];
  assert.deepEqual(buildActionBlock({ recordedLines: plain }), [...plain]);
  assert.deepEqual(buildActionBlock({ recordedLines: ['BOTH PARTIES AMICABLY SETTLED THE INCIDENT'] }), [
    'BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
  ]);
  for (const lines of [
    buildActionBlock({ recordedLines: plain }),
    buildActionBlock({ structured: ['Suspect status: At large.'] }),
    buildActionBlock({}),
  ]) {
    assert.ok(!lines.includes(REFERRAL_LINE), 'the canned referral must never print');
  }
});

test('a recorded state prints without any station tail', () => {
  assert.deepEqual(buildActionBlock({ recordedLines: [], structured: ['Suspect status: At large.'] }), [
    'Suspect status: At large.',
  ]);
});

test('a recorded state the per-type facts do not print is kept', () => {
  // Physical Injuries / Theft sheets have no Medico-Legal Examination field.
  const lines = buildActionBlock({
    recordedLines: ['The case was referred for filing.'],
    structured: ['Recovery status: Partial.', MEDICO],
    perTypeLabels: ['Place of Incident', 'Injuries'],
  });
  assert.deepEqual(lines, ['The case was referred for filing.', 'Recovery status: Partial.', MEDICO]);
});

test('a finalized report prints its finalization note, not the on-file note', () => {
  const lines = buildActionBlock({
    recordedLines: ['Case is to be investigated.'],
    finalizedLine: 'The entry was reviewed and finalized by Sgt. Marlon Rivera on September 16, 2026.',
  });
  assert.ok(lines.includes('The entry was reviewed and finalized by Sgt. Marlon Rivera on September 16, 2026.'));
  assert.ok(!lines.includes(ON_FILE_NOTE), 'a finalized entry is not still awaiting verification');
});

test('the officer’s own lines still lead the block, blank lines dropped', () => {
  const lines = buildActionBlock({
    recordedLines: ['Suspect arrested and detained.  ', '', '  '],
    structured: ['Recovery status: Full.'],
    finalizedLine: '',
  });
  assert.equal(lines[0], 'Suspect arrested and detained.');
  assert.equal(lines[1], 'Recovery status: Full.');
});
