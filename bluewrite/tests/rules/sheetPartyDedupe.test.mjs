import test from 'node:test';
import assert from 'node:assert/strict';
import { omitPartiesRestatedInNarrative } from '../../src/lib/sheetFacts.js';

const FACTS = [
  { label: 'Place', values: ['Purok 3, Langtad, City of Naga, Cebu'] },
  { label: 'Victim', values: ['MARK ANTHONY REYES'] },
  { label: 'Suspect', values: ['RONALD JAMES GARCIA'] },
];
const NARRATIVE = [
  'Persons involved:',
  'Complainant: Mark Anthony Reyes, male, Filipino, 28 years old, DOB: 06-15-1998, a resident of Purok 3, Langtad.',
  'Respondent: Ronald James Garcia, male, Filipino, 30 years old, DOB: 09-12-1996, a resident of Purok 5, Langtad.',
  'Facts:',
  'The complainant and the respondent were involved in a verbal altercation.',
].join('\n');

test('a Victim/Suspect line is dropped when the narrative already lists the same people', () => {
  const out = omitPartiesRestatedInNarrative(FACTS, NARRATIVE);
  assert.deepEqual(out.map((f) => f.label), ['Place']);
});

test('only the restated party goes; a different person stays', () => {
  const facts = [{ label: 'Victim', values: ['MARK ANTHONY REYES'] }, { label: 'Suspect', values: ['JOSE LIM'] }];
  const out = omitPartiesRestatedInNarrative(facts, NARRATIVE);
  assert.deepEqual(out.map((f) => f.label), ['Suspect']);
});

test('an unidentified suspect is never matched and always stays', () => {
  const facts = [{ label: 'Suspect', values: ['One unidentified male, about 30, dark jacket'] }];
  assert.equal(omitPartiesRestatedInNarrative(facts, NARRATIVE).length, 1);
});

test('a name only mentioned in the story keeps its labelled head line', () => {
  const story = 'Facts:\nMark Anthony Reyes was struck by Ronald James Garcia.';
  assert.equal(omitPartiesRestatedInNarrative(FACTS, story).length, 3);
});

test('a line with every person present only if ALL values are restated', () => {
  const facts = [{ label: 'Suspect', values: ['RONALD JAMES GARCIA', 'JOSE LIM'] }];
  assert.equal(omitPartiesRestatedInNarrative(facts, NARRATIVE).length, 1);
});
