import test from 'node:test';
import assert from 'node:assert/strict';

import { filterOptions, isChosenOption } from '../../src/lib/dropdownOptions.js';

// The station's own type list, in the order the form offers it — the list the bug
// was filed against. Fourteen rows, which is also why the card has to scroll.
const TYPES = [
  'Theft',
  'Robbery',
  'Assault / Physical Injury',
  'Traffic Accident',
  'Rape / Sexual Assault',
  'Domestic Violence',
  'Missing Person',
  'Lost Property',
  'Fraud / Estafa',
  'Property Damage',
  'Fire Incident',
  'Drug-Related Incident',
  'Burglary / Break-In',
  'Other Incident',
];

// ---------------------------------------------------------------------------
// The reopen bug. A typeable box already holding an answer must still open onto
// the answers: the filter used to match only the option that was already in the
// box, drop it as a suggestion, and leave the card empty — so a field holding
// "Domestic Violence" could not be opened or changed at all.
// ---------------------------------------------------------------------------

test('an answered box offers the whole list again', () => {
  assert.deepEqual(filterOptions(TYPES, 'Domestic Violence'), TYPES);
});

test('the current answer stays in the list, so another can be picked', () => {
  const listed = filterOptions(TYPES, 'Domestic Violence');
  assert.ok(listed.includes('Domestic Violence'));
  assert.ok(listed.includes('Theft'));
});

test('an answer that is a prefix of another option is not dropped from it', () => {
  const types = ['Theft', 'Theft of Motor Vehicle', 'Robbery'];
  assert.deepEqual(filterOptions(types, 'Theft'), types);
});

test('the answer is recognised whatever its case or padding', () => {
  assert.deepEqual(filterOptions(TYPES, ' domestic violence '), TYPES);
  assert.deepEqual(filterOptions(TYPES, 'DOMESTIC VIOLENCE'), TYPES);
});

test('an empty box offers the whole list', () => {
  assert.deepEqual(filterOptions(TYPES, ''), TYPES);
  assert.deepEqual(filterOptions(TYPES, undefined), TYPES);
  assert.deepEqual(filterOptions(TYPES, '   '), TYPES);
});

// ---------------------------------------------------------------------------
// Typing, which is the other half of the same box: text that is not a whole
// option is a search in progress and must narrow the list.
// ---------------------------------------------------------------------------

test('a search term narrows the list to the options containing it', () => {
  assert.deepEqual(filterOptions(TYPES, 'acc'), ['Traffic Accident']);
  assert.deepEqual(filterOptions(TYPES, 'robb'), ['Robbery']);
  // Case-insensitive, which is what the placeholder promises.
  assert.deepEqual(filterOptions(TYPES, 'MISSING'), ['Missing Person']);
});

test('a term matching nothing offers nothing', () => {
  assert.deepEqual(filterOptions(TYPES, 'zzz'), []);
});

test('isChosenOption only recognises a whole option', () => {
  assert.equal(isChosenOption(TYPES, 'Domestic Violence'), true);
  assert.equal(isChosenOption(TYPES, 'domestic violence'), true);
  // A term on its way to an option is a search, not an answer.
  assert.equal(isChosenOption(TYPES, 'Domestic'), false);
  assert.equal(isChosenOption(TYPES, 'Violence'), false);
  assert.equal(isChosenOption(TYPES, ''), false);
  assert.equal(isChosenOption(TYPES, undefined), false);
});
