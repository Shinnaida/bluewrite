// BlueWrite — the report mix, as arithmetic.
//
// The picture this draws is a grid of squares, and a grid of squares that is
// wrong still looks like a picture: a kind wearing another kind's ramp step, a
// catch-all ranked into the middle, squares that stop at the cap and drop the
// remainder without saying so. None of those throw, and none of them are
// noticeable by eye — which is the whole reason the arithmetic is a lib and this
// file is here.
//
// Two of the assertions below also pin the SHARING: the ranks come from
// lib/dashboardChart.js, so the mix wears the same ramp the dashboard's own
// chart does. A second palette here would let "the kind with the most reports"
// mean two different colours on two screens, and neither screen would look
// broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIX_SQUARE_CAP, reportMix } from '../../src/lib/reportMix.js';
import { CAT_RAMP_STEPS } from '../../src/lib/dashboardChart.js';

/** A report list in the shape the register returns: newest first. */
const REPORTS = [
  { id: 321, incident_type: 'Missing Person' },
  { id: 320, incident_type: 'Traffic Accident' },
  { id: 319, incident_type: 'Traffic Accident' },
  { id: 318, incident_type: 'Theft' },
  { id: 317, incident_type: 'Traffic Accident' },
  { id: 316, incident_type: 'Other Incident' },
  { id: 315, incident_type: 'Traffic Accident' },
  { id: 314, incident_type: 'Theft' },
];

const counts = (mix) => mix.rows.map((row) => [row.type, row.count]);

test('the mix counts kinds, busiest first, and never invents a kind', () => {
  const mix = reportMix(REPORTS);

  assert.equal(mix.total, 8);
  assert.equal(mix.perSquare, 1, 'eight reports fit well inside the cap');
  assert.deepEqual(counts(mix), [
    ['Traffic Accident', 4],
    ['Theft', 2],
    ['Missing Person', 1],
    ['Other Incident', 1],
  ]);
});

test('the station’s catch-all is read last, whatever its count', () => {
  // The one kind here with MORE reports than anything else, so a purely
  // volume-ordered list would put it first: the mix must not.
  const mix = reportMix([
    { incident_type: 'Other Incident' },
    { incident_type: 'Other Incident' },
    { incident_type: 'Other Incident' },
    { incident_type: 'Other Incident' },
    { incident_type: 'Theft' },
  ]);

  assert.deepEqual(counts(mix), [
    ['Theft', 1],
    ['Other Incident', 4],
  ]);
});

test('two kinds with the same count keep the register’s own order', () => {
  // The list arrives newest-first, so the tie is broken by whichever kind the
  // officer filed most recently — never by a second sort here.
  const mix = reportMix([
    { incident_type: 'Theft' },
    { incident_type: 'Robbery' },
    { incident_type: 'Theft' },
    { incident_type: 'Robbery' },
  ]);

  assert.deepEqual(counts(mix), [
    ['Theft', 2],
    ['Robbery', 2],
  ]);
});

test('one square is one report, and the squares sit in their kind’s own run', () => {
  const mix = reportMix(REPORTS);

  assert.deepEqual(
    mix.rows.map((row) => row.squares),
    [4, 2, 1, 1],
    'the squares are the counts themselves until the cap applies',
  );
  assert.equal(
    mix.rows.reduce((sum, row) => sum + row.squares, 0),
    mix.total,
    'one square per report, however the counts fall',
  );
});

test('past the cap each square stands for more than one report — and says so', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({
    incident_type: i % 3 === 0 ? 'Theft' : i % 3 === 1 ? 'Robbery' : 'Other Incident',
  }));
  const mix = reportMix(many, { cap: 50 });

  assert.equal(mix.total, 300);
  assert.equal(mix.perSquare, 6, '300 reports over a 50-square grid');
  assert.deepEqual(counts(mix), [
    ['Theft', 100],
    ['Robbery', 100],
    ['Other Incident', 100],
  ]);
  assert.deepEqual(
    mix.rows.map((row) => row.squares),
    [17, 17, 17],
    'each run is its count divided by what a square stands for',
  );
  assert.ok(
    mix.rows.reduce((sum, row) => sum + row.squares, 0) <= 50 + mix.rows.length,
    'the cap bounds the SCALE, not the square count to the last square: each '
      + 'kind’s run is rounded to its nearest square, and a kind with reports '
      + 'always keeps one',
  );
  // The exact counts stay exact on every row: the grid is approximate past the
  // cap, the key is not, and the key is what the officer reads the numbers off.
  assert.deepEqual(
    mix.rows.map((row) => row.count).reduce((a, b) => a + b, 0),
    300,
  );
});

test('a kind too small to earn a square still gets one', () => {
  // 40 reports, a 10-square grid: one square is 4 reports. The single theft
  // rounds to zero and would vanish from a grid whose key still names it.
  const many = [
    ...Array.from({ length: 28 }, () => ({ incident_type: 'Traffic Accident' })),
    ...Array.from({ length: 11 }, () => ({ incident_type: 'Theft' })),
    { incident_type: 'Fire Incident' },
  ];
  const mix = reportMix(many, { cap: 10 });

  assert.equal(mix.perSquare, 4);
  assert.equal(mix.rows.at(-1).type, 'Fire Incident');
  assert.equal(mix.rows.at(-1).count, 1);
  assert.equal(mix.rows.at(-1).squares, 1, 'a kind with reports is never invisible');
});

test('colour is the dashboard’s ramp, handed out by rank', () => {
  const mix = reportMix(REPORTS);

  assert.deepEqual(
    mix.rows.map((row) => row.color),
    ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)'],
  );
  assert.deepEqual(
    mix.rows.map((row) => row.step),
    [1, 2, 3, 4],
  );
  // Past the end of the ramp a kind takes the LAST step rather than wrapping to
  // the busiest kind's colour, which would be a false statement about the data.
  const long = reportMix(
    Array.from({ length: CAT_RAMP_STEPS + 3 }, (_, i) => ({ incident_type: `Type ${i}` })),
  );
  assert.equal(long.rows.at(-1).step, CAT_RAMP_STEPS);
  assert.equal(long.rows.at(-1).color, `var(--cat-${CAT_RAMP_STEPS})`);
});

test('a report with no recorded kind is counted by nothing, and breaks nothing', () => {
  const mix = reportMix([
    ...REPORTS,
    { id: 1, incident_type: '' },
    { id: 2, incident_type: '   ' },
    { id: 3 },
    null,
  ]);

  assert.equal(mix.total, 8, 'the total is what the chart draws');
  assert.deepEqual(counts(mix), [
    ['Traffic Accident', 4],
    ['Theft', 2],
    ['Missing Person', 1],
    ['Other Incident', 1],
  ]);
});

test('an empty desk, and anything that is not a list at all, draws nothing', () => {
  for (const input of [[], null, undefined, 'reports', 7, {}]) {
    const mix = reportMix(input);
    assert.deepEqual(mix, { total: 0, perSquare: 1, rows: [] });
  }
});

test('an unusable cap falls back to the constant instead of dividing by it', () => {
  // `total / 0` is Infinity and `total / undefined` is NaN; either would leave
  // here as a row of NaN squares and a grid the browser draws as nothing.
  for (const cap of [0, -5, NaN, undefined, Infinity, '40']) {
    const mix = reportMix(REPORTS, { cap });
    assert.equal(mix.perSquare, 1);
    assert.deepEqual(
      mix.rows.map((row) => row.squares),
      [4, 2, 1, 1],
    );
  }
  assert.equal(MIX_SQUARE_CAP, 120);
});