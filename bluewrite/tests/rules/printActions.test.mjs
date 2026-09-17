// BlueWrite — printed ACTION TAKEN / STATUS composition tests.
// Runs with Node's built-in runner (see package.json "test"). Covers: the
// routing line is printed once and only when the recorded disposition does not
// already state an onward action; the disclaimer wording is gone; the
// medico-legal examination is not repeated when the per-type fact block already
// prints it; and the officer's own lines still lead the block.

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

test('the on-file note is a stand-in, not a footer', () => {
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
  // With nothing recorded at all, it is the only true thing the block can say.
  assert.deepEqual(buildActionBlock({}), [ON_FILE_NOTE, REFERRAL_LINE]);
  assert.deepEqual(buildActionBlock({ recordedLines: ['', '   '] }), [ON_FILE_NOTE, REFERRAL_LINE]);
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

test('the routing line prints only when the record states no onward action', () => {
  const onward = [
    'endorsed to follow up investigation',
    'The case was endorsed for a follow-up investigation by this Office.',
    'referred to the station investigator-on-case',
    'case remains under investigation',
    'suspect turned over to the station',
    'case filed in court',
    'no referral necessary',
  ];
  for (const disposition of onward) {
    const lines = buildActionBlock({ recordedLines: [disposition] });
    assert.ok(!lines.includes(REFERRAL_LINE), `routing line restated the disposition: ${disposition}`);
  }

  const plain = ['responded 10pm, talked to both parties, gave warning, no injuries'];
  assert.deepEqual(buildActionBlock({ recordedLines: plain }), [...plain, REFERRAL_LINE]);
});

test('a recorded state keeps the station convention even with no disposition', () => {
  assert.deepEqual(buildActionBlock({ recordedLines: [], structured: ['Suspect status: At large.'] }), [
    'Suspect status: At large.',
    REFERRAL_LINE,
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

test('the officer\'s own lines lead the block, blank lines dropped', () => {
  const lines = buildActionBlock({
    recordedLines: ['Suspect arrested and detained.  ', '', '  '],
    structured: ['Recovery status: Full.'],
    finalizedLine: '',
  });
  assert.equal(lines[0], 'Suspect arrested and detained.');
  assert.equal(lines[1], 'Recovery status: Full.');
});
