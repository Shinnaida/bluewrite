import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditClosingLines,
  withClosingLineGaps,
  stampClosingLine,
  fillClosingLine,
  fillBlankClosingLine,
  extractClosingValues,
  syncClosingLinesFromLetter,
  RECORDED_BY_GAP,
  REQUESTED_BY_GAP,
} from '../../src/lib/closingLines.js';

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

test('stamping appends a blank prebuilt line only when missing', () => {
  const base = '<p>Facts: something happened.</p>';
  const stamped = stampClosingLine(base, 'recorded');
  assert.equal(stamped.added, true);
  assert.ok(stamped.html.includes('Recorded by:</b> ____'));
  assert.deepEqual(stampClosingLine(stamped.html, 'recorded').added, false);
  const iss = stampClosingLine(base, 'requested');
  assert.equal(iss.added, true);
  assert.ok(iss.html.includes('request of ____ for whatever legal'));
});

test('Recorded by always lands above the issuance line, whatever the tap order', () => {
  const base = '<p>Facts: x.</p>';
  // Issuance first, Recorded by second: the recorder still sits above.
  const withIssuance = stampClosingLine(base, 'requested').html;
  const stamped = stampClosingLine(withIssuance, 'recorded');
  assert.equal(stamped.added, true);
  assert.ok(
    stamped.html.indexOf('Recorded by:</b> ____') < stamped.html.indexOf('request of ____'),
    'recorded stamps above the issuance',
  );
  // Same for the named fill path (gap name typed before stamping).
  const filled = fillClosingLine(withIssuance, 'recorded', 'PO1 Juan Dela Cruz');
  assert.ok(
    filled.indexOf('Recorded by:</b> PO1 Juan Dela Cruz') < filled.indexOf('request of ____'),
    'recorded fills above the issuance',
  );
  // No issuance present: still appends at the end, as before.
  const plain = stampClosingLine(base, 'recorded').html;
  assert.ok(plain.endsWith('Recorded by:</b> ____</p>'));
});

test('filling writes the name into the record line; blank keeps ____', () => {
  const stamped = stampClosingLine('<p>Facts: x.</p>', 'recorded').html;
  const filled = fillClosingLine(stamped, 'recorded', 'PO1 Juan Dela Cruz');
  assert.ok(filled.includes('Recorded by:</b> PO1 Juan Dela Cruz'));
  assert.ok(!filled.includes('____'));
  assert.equal(auditClosingLines(filled.replace(/<[^>]*>/g, ' ')).length, 1);
  const cleared = fillClosingLine(filled, 'recorded', '');
  assert.ok(cleared.includes('Recorded by:</b> ____'));
});

test('save-time sync copies canvas names back into the record', () => {
  const narrative = '<p>Facts: x.</p><p><b>Recorded by:</b> ____</p>';
  const ink = '<p>Facts: x.</p><p><b>Recorded by:</b> PO1 Ana Lim</p>';
  const synced = syncClosingLinesFromLetter(narrative, ink);
  assert.ok(synced.includes('PO1 Ana Lim'));
  assert.ok(!synced.includes('____'));
  // No ink, no names: the narrative passes through untouched.
  assert.equal(syncClosingLinesFromLetter(narrative, ''), narrative);
  assert.equal(syncClosingLinesFromLetter(narrative, '<p>Facts: x.</p>'), narrative);
});

test('save-time sync never re-appends a line the officer deleted', () => {
  const ink = '<p>Facts: x.</p><p><b>Recorded by:</b> PO1 Ana Lim</p>';
  // Whole line erased from the record: it stays erased, not re-appended.
  const erased = '<p>Facts: x.</p>';
  assert.equal(syncClosingLinesFromLetter(erased, ink), erased);
  // Name erased leaving an empty label: the old name must not come back.
  const emptied = '<p>Facts: x.</p><p><b>Recorded by:</b> </p>';
  assert.equal(syncClosingLinesFromLetter(emptied, ink), emptied);
});

test('save-time sync never overwrites a name corrected in the record', () => {
  const narrative =
    '<p>Facts: x.</p><p><b>Recorded by:</b> PO1 Correct Name</p>';
  const staleInk = '<p>Facts: x.</p><p><b>Recorded by:</b> PO1 Old Name</p>';
  assert.equal(syncClosingLinesFromLetter(narrative, staleInk), narrative);
});

test('save-time sync still fills a blank line and avoids duplicates', () => {
  const ink =
    '<p>Facts: x.</p><p>This certification is issued upon the request of Mark Reyes for whatever legal purposes it may serve.</p>';
  const blank =
    '<p>Facts: x.</p><p>This certification is issued upon the request of ____ for whatever legal purposes it may serve.</p>';
  const filled = syncClosingLinesFromLetter(blank, ink);
  assert.ok(filled.includes('request of Mark Reyes for whatever legal'));
  assert.ok(!filled.includes('____'));
  // A plain-prose line (not the stamped shape) is left alone, never doubled.
  const prose = '<p>Facts: x.</p><p>Recorded by: PO1 Ana Lim</p>';
  const proseInk = '<p>Facts: x.</p><p><b>Recorded by:</b> PO1 Other Name</p>';
  const kept = syncClosingLinesFromLetter(prose, proseInk);
  assert.equal(kept, prose);
  assert.equal(prose.match(/Recorded by:/g).length, 1);
});

test('fillBlankClosingLine only fills a present-but-blank line', () => {
  const blank = '<p><b>Recorded by:</b> ____</p>';
  const r = fillBlankClosingLine(blank, 'recorded', 'PO1 Juan Dela Cruz');
  assert.equal(r.filled, true);
  assert.ok(r.html.includes('PO1 Juan Dela Cruz'));
  assert.deepEqual(fillBlankClosingLine('<p>Facts.</p>', 'recorded', 'PO1 Juan').filled, false);
  const kept = fillBlankClosingLine(
    '<p><b>Recorded by:</b> PO1 Ana Lim</p>',
    'recorded',
    'PO1 Juan',
  );
  assert.equal(kept.filled, false);
  assert.ok(kept.html.includes('PO1 Ana Lim'));
});

test('extracted values ignore blanks', () => {
  assert.deepEqual(extractClosingValues('<p><b>Recorded by:</b> ____</p>'), { recordedBy: null, requestedBy: null });
});

test('the warnings join a draft once, never twice', () => {
  const draft = { possibleGaps: [{ description: 'Other gap', severity: 'info' }] };
  const once = withClosingLineGaps(draft, 'Facts:\nx');
  assert.equal(once.possibleGaps.length, 3);
  assert.equal(withClosingLineGaps(once, 'Facts:\nx').possibleGaps.length, 3);
});
