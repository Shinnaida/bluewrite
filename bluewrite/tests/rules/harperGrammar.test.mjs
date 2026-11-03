// Harper wrapper rules (src/lib/harperGrammar.js): Harper does not know the
// blotter. Its lints over identifiers, names and places must be dropped
// before an officer ever sees them — only mechanical prose fixes survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRecordTouching,
  filterHarperLints,
  mergeGrammarIssues,
  extractSeedWords,
} from '../../src/lib/harperGrammar.js';

const lint = (start, end, kind = 'Grammar', message = 'Fix.', suggestions = ['x']) => ({
  start, end, kind, message, suggestions,
});

test('identifier spans are record-touching', () => {
  const t = 'V1 NMAX OR# 0716-819041 DOB: 2-25-1990 at 8:40';
  assert.equal(isRecordTouching(t, 0, 2), true); // V1
  assert.equal(isRecordTouching(t, 9, 11), true); // OR inside OR#
  assert.equal(isRecordTouching(t, 13, 23), true); // the number
  assert.equal(isRecordTouching(t, 30, 39), true); // DOB digits with dashes
  assert.equal(isRecordTouching(t, 43, 47), true); // 8:40
  assert.equal(isRecordTouching(t, 48, 48), false); // empty span is not
});

test('clean prose is not record-touching', () => {
  const t = 'Both vehicles were travelling uphill.';
  assert.equal(isRecordTouching(t, 0, 4), false);
  assert.equal(isRecordTouching(t, 5, 13), false);
});

test('record lints are dropped, prose lints survive', () => {
  const t = 'V1 NMAX drove teh car.';
  const lints = [
    lint(0, 2, 'Spelling', 'V1?', ['Vi']), // identifier
    lint(3, 7, 'Spelling', 'NMAX?', ['Max']), // shouting
    lint(14, 17, 'Spelling', 'teh?', ['the']), // lowercase typo survives
  ];
  const out = filterHarperLints(t, lints);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].suggestions, ['the']);
});

test('a capitalized unknown is a name until proven otherwise', () => {
  const t = 'Driven by Porol from Inoburan.';
  const out = filterHarperLints(t, [
    lint(10, 15, 'Spelling', 'Porol?', ['Parole']),
    lint(21, 29, 'Spelling', 'Inoburan?', ['Inhuman']),
  ]);
  assert.deepEqual(out, []);
});

test('en-dash formatting inside numbers is dropped', () => {
  const t = 'CR# 0716-25-250349 driven.';
  const dashAt = t.indexOf('-');
  const out = filterHarperLints(t, [
    lint(dashAt, dashAt + 1, 'Formatting', 'en dash?', ['\u2013']),
  ]);
  assert.deepEqual(out, []);
});

test('suggestion-less and unkind lints never surface', () => {
  const t = 'Plain words here.';
  assert.deepEqual(filterHarperLints(t, [lint(0, 5, 'Grammar', 'M.', [])]), []);
  assert.deepEqual(filterHarperLints(t, [lint(0, 5, 'Style', 'M.', ['x'])]), []);
  assert.deepEqual(filterHarperLints(t, [lint(0, 5, 'Readability', 'M.', ['x'])]), []);
});

test('seed words carry the report\'s own names and station spellings', () => {
  const seeds = extractSeedWords('Driven by Porol from Inoburan. They were travelling.');
  const low = seeds.map((w) => String(w).toLowerCase());
  assert.ok(low.includes('porol'), 'the report name is seeded');
  assert.ok(low.includes('inoburan'), 'the report place is seeded');
  assert.ok(low.includes('travelling'), 'the station spelling is seeded');
  assert.ok(!low.includes('a'), 'fragments are never seeded');
  assert.ok(!low.includes(''), 'no blank seed');
});

test('merge keeps order, drops overlaps, caps the run', () => {
  const base = [lint(0, 4), lint(10, 14)];
  const extra = [lint(2, 6), lint(20, 24)]; // first overlaps base, second is new
  const out = mergeGrammarIssues(base, extra);
  assert.deepEqual(out.map((i) => [i.start, i.end]), [[0, 4], [10, 14], [20, 24]]);
});
