// BlueWrite — the form-format preference (tests/rules/).
//
// Small, but not trivial: the value comes out of localStorage, where a previous
// build or a hand-edit can leave anything at all. A value no format answers to
// would render Write Report with no format — and because the editor switches on
// `formFormat === 'sheet'` and `=== 'steps'`, a junk value would silently mean
// "document" for one of them and "neither" for the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORM_FORMATS,
  FORM_FORMAT_HINTS,
  FORM_FORMAT_LABELS,
  normaliseFormFormat,
} from '../../src/lib/formFormat.js';

test('the three formats, in the order the control shows them', () => {
  assert.deepEqual(FORM_FORMATS, ['document', 'sheet', 'steps']);
});

test('every format has a label and a hint — the hint IS the row value', () => {
  for (const value of FORM_FORMATS) {
    assert.ok(FORM_FORMAT_LABELS[value], `${value} has no label`);
    assert.ok(FORM_FORMAT_HINTS[value], `${value} has no hint`);
  }
  // No stale key pointing at a format that no longer exists: the row would
  // print a hint for a value the control cannot select.
  assert.equal(Object.keys(FORM_FORMAT_LABELS).length, FORM_FORMATS.length);
  assert.equal(Object.keys(FORM_FORMAT_HINTS).length, FORM_FORMATS.length);
});

test('normaliseFormFormat accepts the three values and rejects everything else', () => {
  for (const value of FORM_FORMATS) {
    assert.equal(normaliseFormFormat(value), value);
  }
  // What localStorage can actually hand back.
  for (const junk of ['', 'Steps', 'page', 'blank', 'STEPPED', null, undefined, 0, {}, []]) {
    assert.equal(normaliseFormFormat(junk), null, `${JSON.stringify(junk)} must not be a format`);
  }
});

test('"page" is NOT a format — the sheet format is called "sheet"', () => {
  // Worth pinning: the value travels through localStorage and a route check, so
  // a wrong literal in one of them would be a silent fallback to the document
  // format rather than an error.
  assert.equal(normaliseFormFormat('page'), null);
  assert.equal(normaliseFormFormat('sheet'), 'sheet');
});
