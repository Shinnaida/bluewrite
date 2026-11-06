import test from 'node:test';
import assert from 'node:assert/strict';
import { auditClosingLines, withClosingLineGaps, RECORDED_BY_GAP, REQUESTED_BY_GAP } from '../../src/lib/closingLines.js';

const FULL = 'Facts:\nThe incident was reported.\nRecorded by: PO1 Ana Lim\nThis certification is issued upon the request of Mark Reyes for whatever legal purposes.';

test('a report with both closing lines raises no warning', () => {
  assert.deepEqual(auditClosingLines(FULL), []);
});

test('missing Recorded by warns', () => {
  const gaps = auditClosingLines(FULL.replace('Recorded by: PO1 Ana Lim\n', ''));
  assert.deepEqual(gaps.map((g) => g.description), [RECORDED_BY_GAP]);
  assert.equal(gaps[0].severity, 'error');
});

test('missing Requested by warns, and "Requested by:" also counts', () => {
  const noReq = FULL.replace(/\nThis certification.*$/, '');
  assert.deepEqual(auditClosingLines(noReq).map((g) => g.description), [REQUESTED_BY_GAP]);
  assert.deepEqual(auditClosingLines(noReq + '\nRequested by: Mark Reyes'), []);
});

test('an empty label does not count', () => {
  const gaps = auditClosingLines('Facts:\nSomething happened.\nRecorded by:');
  assert.equal(gaps.length, 2);
});

test('both missing warns twice; empty text warns nothing', () => {
  assert.equal(auditClosingLines('Facts:\nSomething happened.').length, 2);
  assert.deepEqual(auditClosingLines(''), []);
});

test('the warnings join a draft once, never twice', () => {
  const draft = { possibleGaps: [{ description: 'Other gap', severity: 'info' }] };
  const once = withClosingLineGaps(draft, 'Facts:\nx');
  assert.equal(once.possibleGaps.length, 3);
  assert.equal(withClosingLineGaps(once, 'Facts:\nx').possibleGaps.length, 3);
});
