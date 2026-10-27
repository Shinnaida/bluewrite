// BlueWrite — the sheet's typed-date reader (src/lib/sheetDateParse.js).
//
// The sheet's date lines are typed text, so a commit must be read back into
// the stored shape. These pin what the officer can type: the station's own
// numeric form, ISO, month names, each with or without a time — and that
// anything else keeps the stored value instead of writing a guess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetDate,
  parseSheetDateTime,
  parseSheetTime,
} from '../../src/lib/sheetDateParse.js';

test('the station numeric form reads day-first with its time', () => {
  assert.deepEqual(parseSheetDateTime('Around 21/10/2026 09:40 pm'), {
    date: '2026-10-21',
    time: '21:40',
  });
  assert.deepEqual(parseSheetDateTime('21-10-2026'), {
    date: '2026-10-21',
    time: null,
  });
  assert.equal(parseSheetDate('21/10/2026'), '2026-10-21');
});

test('month-first input still lands when the month gives it away', () => {
  assert.equal(parseSheetDate('10/21/2026'), '2026-10-21');
  assert.equal(parseSheetDate('October 21, 2026'), '2026-10-21');
  assert.equal(parseSheetDate('21 October 2026'), '2026-10-21');
});

test('ISO and 24-hour times pass through untouched', () => {
  assert.deepEqual(parseSheetDateTime('2026-10-21T21:40'), {
    date: '2026-10-21',
    time: '21:40',
  });
  assert.deepEqual(parseSheetDateTime('21/10/2026 21:40'), {
    date: '2026-10-21',
    time: '21:40',
  });
  assert.equal(parseSheetTime('9:40 P.M.'), '21:40');
  assert.equal(parseSheetTime('09:40'), '09:40');
});

test('a bare time carries half the datum', () => {
  assert.deepEqual(parseSheetDateTime('9:40 pm'), {
    date: null,
    time: '21:40',
  });
});

test('words, half-dates and impossible days read as nothing', () => {
  for (const bad of ['', 'yesterday', 'October 2026', '32/10/2026', '21/13/2026', '21/10/26x', '25:00']) {
    assert.deepEqual(parseSheetDateTime(bad), { date: null, time: null }, bad);
  }
  assert.equal(parseSheetDate('sometime last week'), null);
});
