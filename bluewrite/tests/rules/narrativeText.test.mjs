// BlueWrite — Task 6: the narrative never repeats the blotter entry number.
//
// The certification line above FACTS OF THE CASE already states it, so a
// leading restatement is a defect. The server strips one in code
// (NarrativeService::stripLeadingBlotterRestatement); this pins the client
// mirror, so a legacy row or a draft from another path still prints correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctNagaPlaceLines,
  correctNagaPlaceLinesHtml,
  stripLeadingBlotterRestatement,
  stripRedundantSheetHeader,
  stripRedundantSheetHeaderHtml,
} from '../../src/lib/narrativeText.js';

test('a leading "Blotter Entry No. …" restatement is removed', () => {
  assert.equal(
    stripLeadingBlotterRestatement(
      'Blotter Entry No. BW-0321. On or about 09:00 hours on 23 September 2026, the subject fled.',
    ),
    'On or about 09:00 hours on 23 September 2026, the subject fled.',
  );
});

test('the hash form and lower case are recognised', () => {
  assert.equal(
    stripLeadingBlotterRestatement('blotter entry # BW-0321. The subject fled.'),
    'The subject fled.',
  );
});

test('a restatement carrying its own date is removed whole', () => {
  assert.equal(
    stripLeadingBlotterRestatement('Blotter Entry No. BW-0321, dated 25 September 2026. The subject fled.'),
    'The subject fled.',
  );
});

test('only a LEADING reference is touched', () => {
  const later = 'On or about 09:00 hours the subject fled; see Blotter Entry No. BW-0321.';
  assert.equal(stripLeadingBlotterRestatement(later), later);
});

test('a plain narrative is untouched, character for character', () => {
  const plain = 'On or about 09:00 hours, [VICTIM_1], female, 21 years old, reported the loss.';
  assert.equal(stripLeadingBlotterRestatement(plain), plain);
});

test('whitespace and empty input are handled', () => {
  assert.equal(stripLeadingBlotterRestatement(''), '');
  assert.equal(stripLeadingBlotterRestatement(null), '');
  assert.equal(stripLeadingBlotterRestatement(undefined), '');
  assert.equal(stripLeadingBlotterRestatement('   '), '   ');
});

// ---- Redundant sheet header (owner request, 2026-11-02) --------------------
// An arranged account restates the header the sheet already prints: its own
// opening date/time (the certification line dates the blotter entry) and its
// own title (the quoted title states it). Those leading lines are skipped on
// the paper only — the record keeps every word.

const TITLE = 'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY';

test('a leading bare date/time line is skipped', () => {
  assert.equal(
    stripRedundantSheetHeader(
      '10-20-26 10:00 AM' + String.fromCharCode(10, 10) + TITLE + String.fromCharCode(10, 10) + 'FACTS. PROSE.',
      TITLE,
    ),
    'FACTS. PROSE.',
  );
  assert.equal(
    stripRedundantSheetHeader('MORE OR LESS 8:40 AM OF 10-20-26\nBody prose.', TITLE),
    'Body prose.',
  );
});

test('a leading title restatement is skipped', () => {
  assert.equal(
    stripRedundantSheetHeader(`${TITLE}\n\nPLACE OF INCIDENT : NAGA`, TITLE),
    'PLACE OF INCIDENT : NAGA',
  );
});

test('body lines are never touched', () => {
  const body = `FACTS. At 10:00 AM the witness arrived.\n${TITLE} was discussed.`;
  assert.equal(stripRedundantSheetHeader(body, TITLE), body);
  const prose = 'On October 20, 2026, the complainant reported the loss.';
  assert.equal(stripRedundantSheetHeader(prose, TITLE), prose);
});

test('skipping never blanks the paper', () => {
  assert.equal(stripRedundantSheetHeader('10-20-26 10:00 AM', TITLE), '10-20-26 10:00 AM');
  assert.equal(stripRedundantSheetHeader(TITLE, TITLE), TITLE);
  assert.equal(stripRedundantSheetHeader('', TITLE), '');
});

test('arranged HTML drops redundant leading paragraphs only', () => {
  const html =
    '<p>10-20-26 10:00 AM</p>' +
    `<p><b>${TITLE}</b></p>` +
    '<p>PLACE OF INCIDENT : NAGA</p>';
  assert.equal(
    stripRedundantSheetHeaderHtml(html, TITLE),
    '<p>PLACE OF INCIDENT : NAGA</p>',
  );
  // Officer rich text in another shape renders as stored.
  const other = '<div>10-20-26 10:00 AM</div>';
  assert.equal(stripRedundantSheetHeaderHtml(other, TITLE), other);
});

// ---- Conclusive Naga place for the narrative's place line ------------------
// The account keeps the place as written; the sheet prints the value under
// PLACE OF INCIDENT in the gazetteer's conclusive spelling (owner request,
// 2026-11-02). Only that label's value moves.

test('the PLACE OF INCIDENT value takes the conclusive Naga spelling', () => {
  assert.equal(
    correctNagaPlaceLines(
      'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA\nT/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
    ),
    'PLACE OF INCIDENT : Cansimundong, INOBURAN, CITY OF NAGA\nT/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
  );
  // Exact barangays and out-of-scope words stay exactly as written.
  const exact = 'PLACE OF INCIDENT: INOBURAN, CITY OF NAGA';
  assert.equal(correctNagaPlaceLines(exact), exact);
  // The same words inside prose are not the label line.
  const prose = 'Upon reaching the place of incident, V2 encroached into the lane.';
  assert.equal(correctNagaPlaceLines(prose), prose);
});

test('the formatter HTML corrects only the labeled place value', () => {
  const html =
    '<p><b>PLACE OF INCIDENT:</b> CANGI MUNDONG, INOBUKAN, CITY OF NAGA</p>' +
    '<p><b>T/D OF INCIDENT:</b> MORE OR LESS 8:40 AM OF 10-20-26</p>' +
    '<p>UPON REACHING THE PLACE OF INCIDENT V2 ENCROACHED INTO V1 LANE</p>';
  assert.equal(
    correctNagaPlaceLinesHtml(html),
    '<p><b>PLACE OF INCIDENT:</b> Cansimundong, Inoburan, CITY OF NAGA</p>' +
      '<p><b>T/D OF INCIDENT:</b> MORE OR LESS 8:40 AM OF 10-20-26</p>' +
      '<p>UPON REACHING THE PLACE OF INCIDENT V2 ENCROACHED INTO V1 LANE</p>',
  );
  // A plain (unbolded) stored label takes the same pass.
  assert.equal(
    correctNagaPlaceLinesHtml('<p>PLACE OF INCIDENT: CANGIMUNDONG</p>'),
    '<p>PLACE OF INCIDENT: Cansimundong</p>',
  );
});
