// City of Naga gazetteer (src/lib/nagaPlaces.js): near-miss barangay
// spellings map to the closest of the station's 28 barangays; everything
// else — city variants, exact names, puroks, unknowns — is kept as written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAGA_BARANGAYS,
  NAGA_SITIOS,
  closestBarangay,
  closestSitio,
  correctNagaLocation,
  editDistance,
  norm,
} from '../../src/lib/nagaPlaces.js';

test('the gazetteer holds the station 28 barangays', () => {
  assert.equal(NAGA_BARANGAYS.length, 28);
  for (const name of ['Inoburan', 'Mainit', 'Tinaan', 'Langtad', 'Lutac']) {
    assert.ok(NAGA_BARANGAYS.includes(name), `${name} is missing`);
  }
});

test('normalisation ignores case, spacing, punctuation and hyphens', () => {
  assert.equal(norm('Main It'), 'MAINIT');
  assert.equal(norm('Cantao-an'), 'CANTAOAN');
  assert.equal(norm('Brgy. Tinaan'), 'BRGYTINAAN');
});

test('edit distance is exact on the pairs that matter', () => {
  assert.equal(editDistance('INOBUKAN', 'INOBURAN'), 1);
  assert.equal(editDistance('LUTAK', 'LUTAC'), 1);
  assert.equal(editDistance('TINAAN', 'TINAAN'), 0);
});

test('near-miss spellings resolve to the closest barangay', () => {
  assert.deepEqual(closestBarangay('INOBUKAN'), { name: 'Inoburan', corrected: true });
  assert.deepEqual(closestBarangay('LUTAK'), { name: 'Lutac', corrected: true });
  assert.deepEqual(closestBarangay('TINAAN'), { name: 'Tinaan', corrected: false });
  assert.deepEqual(closestBarangay('TINAN'), { name: 'Tinaan', corrected: true });
});

test('exact barangays are recognised, never rewritten', () => {
  assert.deepEqual(closestBarangay('Mainit'), { name: 'Mainit', corrected: false });
  assert.deepEqual(closestBarangay('MAIN IT'), { name: 'Mainit', corrected: false });
  assert.deepEqual(closestBarangay('INOBURAN'), { name: 'Inoburan', corrected: false });
});

test('short tokens and unknowns are kept, never forced', () => {
  assert.equal(closestBarangay('XYZ'), null);
  assert.equal(closestBarangay('V1'), null);
  assert.equal(closestBarangay('UL'), null);
  assert.equal(closestSitio('XYZ'), null);
});

test('the verified sitio resolves its one-letter misread', () => {
  // Cansimundong, Inoburan — verified against community place records; the
  // blotter's CANGIMUNDONG is a one-letter G/S misread in the sitio slot.
  assert.ok(NAGA_SITIOS.some((s) => s.name === 'Cansimundong' && s.barangay === 'Inoburan'));
  assert.deepEqual(closestSitio('CANGIMUNDONG'), { name: 'Cansimundong', barangay: 'Inoburan', corrected: true });
  assert.deepEqual(closestSitio('Cansimundong'), { name: 'Cansimundong', barangay: 'Inoburan', corrected: false });
  // A barangay-strength answer still wins the token: sitios never steal one.
  assert.deepEqual(closestBarangay('INOBUKAN'), { name: 'Inoburan', corrected: true });
});

test('a blotter place line is corrected segment by segment', () => {
  const fixed = correctNagaLocation('CANGIMUNDONG, INOBUKAN, CITY OF NAGA');
  assert.equal(fixed.text, 'Cansimundong, Inoburan, CITY OF NAGA');
  assert.deepEqual(fixed.changes, [
    { from: 'CANGIMUNDONG', to: 'Cansimundong' },
    { from: 'INOBUKAN', to: 'Inoburan' },
  ]);
});

test('barangay prefixes canonicalise, purok lines are untouched', () => {
  assert.equal(correctNagaLocation('BRGY. MAIN IT').text, 'Brgy. Mainit');
  assert.equal(correctNagaLocation('PUROK TAL-OT, BRGY. MAINIT').text, 'PUROK TAL-OT, Brgy. Mainit');
  assert.equal(correctNagaLocation('Sta. Cruz Street, Naga City').text, 'Sta. Cruz Street, Naga City');
  assert.equal(correctNagaLocation('').text, '');
});

test('codes, V-markers and names never enter the gazetteer', () => {
  // Plates, OR/CR numbers, licences, dates and V-markers carry digits or
  // V-prefixes: they are codes, so they print exactly as written even when
  // a barangay sits a letter or two away.
  assert.equal(correctNagaLocation('V1 YAMAHA NMAX WITH PLATE 071ESR').text, 'V1 YAMAHA NMAX WITH PLATE 071ESR');
  assert.equal(correctNagaLocation("V2 ENCROACHED INTO V1'S LANE PLATE GF39112").text, "V2 ENCROACHED INTO V1'S LANE PLATE GF39112");
  assert.equal(correctNagaLocation('G04-16-000471 VALID UNTIL 2-25-2029').text, 'G04-16-000471 VALID UNTIL 2-25-2029');
  // Person words are not places either.
  assert.equal(correctNagaLocation('JOSEPH LONTAYO POROL').text, 'JOSEPH LONTAYO POROL');
});

test('one-letter drifts inside a multi-word place land on the conclusive spelling', () => {
  // No commas: each drifted word still files as its verified name.
  assert.equal(correctNagaLocation('CANGIMUNDONG INOBUKAN').text, 'Cansimundong Inoburan');
  // Headed one-letter barangay drift: the sheet carries Tinaan, not TINAN.
  assert.equal(correctNagaLocation('BARANGAY TINAN').text, 'Brgy. Tinaan');
  // Headed sitio + barangay: both conclusive under one steady prefix.
  assert.equal(correctNagaLocation('BARANGAY CANGIMUNDONG TINAAN').text, 'Brgy. Cansimundong Tinaan');
  // Sitio prefix keeps its prefix; only the drifted name moves.
  assert.equal(correctNagaLocation('SITIO CANGIMUNDONG').text, 'SITIO Cansimundong');
  // Ordinary scene words are never forced into a barangay.
  assert.equal(correctNagaLocation('CITID PLACE OF INCIDENT').text, 'CITID PLACE OF INCIDENT');
});

test('a full vehicle line fixes only the place drift', () => {
  // The sheet's V-paragraphs carry plates, names and addresses in one line:
  // the conclusive spelling lands inside the address while every code and
  // name prints exactly as written.
  assert.equal(
    correctNagaLocation('V1 YAMAHA NMAX OWNED AND DRIVEN BY JOSEPH LONTAYO POROL RESIDENT OF PUROK SAMBAG INOBUKAN CITY OF NAGA').text,
    'V1 YAMAHA NMAX OWNED AND DRIVEN BY JOSEPH LONTAYO POROL RESIDENT OF PUROK SAMBAG Inoburan CITY OF NAGA',
  );
  assert.equal(
    correctNagaLocation('PUROK TAL-OT, BRGY. MAIN IT, CITY OF NAGA, CEBU').text,
    'PUROK TAL-OT, Brgy. Mainit, CITY OF NAGA, CEBU',
  );
});
