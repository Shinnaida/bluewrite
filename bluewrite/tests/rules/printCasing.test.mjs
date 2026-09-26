// BlueWrite — the bondpaper sheet's casing rules, asserted rather than eyeballed.
//
// The printed sheet must read like an official certification letter whatever
// the officer or the AI typed. These tests pin the two hazards that make a
// naive `.toLowerCase()` corrupt a record: proper nouns and acronyms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toUpperCase,
  toTitleCase,
  toSentenceCase,
  labelCase,
  properNounMap,
} from '../../src/lib/printCasing.js';

test('toUpperCase is total and collapses whitespace', () => {
  assert.equal(toUpperCase('robbery'), 'ROBBERY');
  assert.equal(toUpperCase('  missing   person  '), 'MISSING PERSON');
  assert.equal(toUpperCase(null), '');
  assert.equal(toUpperCase(undefined), '');
  assert.equal(toUpperCase('Fraud / Estafa'), 'FRAUD / ESTAFA');
});

test('toTitleCase follows English title-case conventions', () => {
  assert.equal(toTitleCase('name of missing person'), 'Name of Missing Person');
  assert.equal(toTitleCase('date & time of incident'), 'Date & Time of Incident');
  assert.equal(toTitleCase('last seen'), 'Last Seen');
  // A leading minor word still takes a capital.
  assert.equal(toTitleCase('the incident'), 'The Incident');
});

test('toTitleCase preserves proper nouns and acronyms', () => {
  assert.equal(toTitleCase('CTU naga'), 'CTU Naga');
  assert.equal(toTitleCase('PNP'), 'PNP');
  assert.equal(toTitleCase('mcarthur highway'), 'Mcarthur Highway'); // shape unknown → normal
  assert.equal(toTitleCase('McArthur highway'), 'McArthur Highway'); // interior capital kept
});

test('toSentenceCase capitalizes sentence starts and never flattens names', () => {
  assert.equal(
    toSentenceCase('the suspect fled. the officer responded.'),
    'The suspect fled. The officer responded.',
  );
  // Existing capitals are preserved — a proper noun is not lower-cased.
  assert.equal(
    toSentenceCase('shaine jayme filed. Pedro left.'),
    'Shaine jayme filed. Pedro left.',
  );
  assert.equal(toSentenceCase('i saw it'), 'I saw it');
  assert.equal(toSentenceCase(''), '');
  assert.equal(toSentenceCase(null), '');
});

test('toSentenceCase can correct a value against the report\'s own proper nouns', () => {
  const proper = properNounMap(['Shaine Jayme', 'CTU Naga', 'Barangay Dagatan']);
  // A lower-cased value is corrected from the record's own spelling.
  assert.equal(
    toSentenceCase('shaine jayme reported to ctu naga.', proper),
    'Shaine Jayme reported to CTU Naga.',
  );
  // A word the record never capitalizes is never guessed at.
  assert.equal(toSentenceCase('the market was busy', proper), 'The market was busy');
  // Acronyms and existing capitals survive; nothing is flattened.
  assert.equal(toSentenceCase('PNP and NBI responded', proper), 'PNP and NBI responded');
});

test('toSentenceCase promotes a known institutional acronym typed in title case', () => {
  // The sheet bug seen live: "Ctu Naga" / "Ctu uniform" on a CTU report.
  assert.equal(toSentenceCase('Ctu Naga', []), 'CTU Naga');
  assert.equal(toSentenceCase('Ctu uniform, Tall', []), 'CTU uniform, Tall');
  // An ordinary word is never promoted.
  assert.equal(toSentenceCase('the cat sat', []), 'The cat sat');
});

test('labelCase is the one spelling used for a bold sheet label', () => {
  assert.equal(labelCase('name of missing person'), 'Name of Missing Person');
  assert.equal(labelCase('distinguishing marks/clothing'), 'Distinguishing Marks/Clothing');
});
