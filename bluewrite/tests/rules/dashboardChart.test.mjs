// BlueWrite — the dashboard's stacked "Reports over time" chart.
//
// Two halves, because this chart can be wrong in two unrelated ways:
//
//   - the ARITHMETIC (src/lib/dashboardChart.js) — a band stacked from the wrong
//     base draws a column of the right height with a nonsense composition inside
//     it, and nothing about the picture tells you so;
//   - the RAMP (--cat-1 .. --cat-N in both themes) — it is ORDINAL. Step 1 is the
//     station's busiest incident type and the ramp is supposed to lighten as the
//     type gets rarer, so a reader takes the heaviest band for the commonest
//     incident without consulting the legend. That claim is only true if the
//     steps are actually ordered, in BOTH themes, which is a measurable property
//     of the token values rather than a matter of taste. It has been false twice:
//     once because the steps were picked by eye (step 7 was drawn heavier than
//     step 3), and once because dark inherited a ramp solved for white paper and
//     so drew the busiest type as its most invisible band.
//
// So the ramp is asserted here, against the real stylesheets, rather than trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAT_RAMP_STEPS,
  CHART_MENU,
  alignmentWarning,
  bandAtPointer,
  chartMenuItems,
  dayAtPointer,
  dayBreakdownText,
  orderForDisplay,
  rampColor,
  rampStep,
  stackBands,
} from '../../src/lib/dashboardChart.js';

const css = (name) => readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8');

/** WCAG relative luminance of a #RRGGBB string. */
function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB strings. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The ramp declared in a stylesheet, as { step: hex }. */
function ramp(source) {
  const out = {};
  for (const m of css(source).matchAll(/--cat-(\d+):\s*(#[0-9A-Fa-f]{6})/g)) out[Number(m[1])] = m[2];
  return out;
}

/** The panel a themed chart actually sits on. */
function panel(source) {
  const m = css(source).match(/--panel:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(m, `${source} must declare --panel`);
  return m[1];
}

// ---- The arithmetic --------------------------------------------------------

// A 2-day, 3-type payload in the server's volume order. Day 0 has two types,
// day 1 has one, and Stealing is absent on both — the three cases that matter.
const series = [
  { date: '2026-09-01', count: 4 },
  { date: '2026-09-02', count: 2 },
];
const byType = [
  { type: 'Theft', total: 3, counts: [3, 0] },
  { type: 'Assault', total: 3, counts: [1, 2] },
  { type: 'Stealing', total: 0, counts: [0, 0] },
];

test('bands accumulate per DAY, not per type', () => {
  const bands = stackBands(series, byType);
  const day0 = bands.filter((b) => b.day === 0);
  // Both bands of day 0 start from the day's own baseline, so the second one
  // stacks ON the first (1 -> 4) rather than on its own total. Accumulating per
  // type instead would put both at from=0 and draw two bands on top of each
  // other: a column of the right height, half the composition.
  assert.deepEqual(day0.map((b) => [b.type, b.from, b.to]), [
    ['Theft', 0, 3],
    ['Assault', 3, 4],
  ]);
});

test('the last band of a day tops out at that day total', () => {
  const bands = stackBands(series, byType);
  for (const [day, total] of [[0, 4], [1, 2]]) {
    const dayBands = bands.filter((b) => b.day === day);
    assert.equal(dayBands[dayBands.length - 1].to, total, `day ${day} must reach its total`);
    assert.equal(dayBands[dayBands.length - 1].from, total - dayBands[dayBands.length - 1].value);
  }
});

test('a type with no reports that day produces no band', () => {
  // Stealing is 0 on both days. A zero-height band would still claim a hover row
  // and a place in the stack, telling the reader a type occurred when it did not.
  const bands = stackBands(series, byType);
  assert.equal(bands.filter((b) => b.type === 'Stealing').length, 0);
});

test('bands are emitted in the server order, most frequent first', () => {
  const bands = stackBands(series, byType).filter((b) => b.day === 0);
  assert.deepEqual(bands.map((b) => b.type), ['Theft', 'Assault']);
  assert.deepEqual(bands.map((b) => b.rank), [0, 1]);
});

test('rank is the type index the server sent, not a per-day recount', () => {
  // Day 1 has only Assault. It stays rank 1 — the ramp colour is the type's
  // STANDING in the window, not its place in the day, so a type keeps its colour
  // on every day it appears. Rank 0 there would recolour it per day and make the
  // legend wrong for every day but the busiest.
  const bands = stackBands(series, byType).filter((b) => b.day === 1);
  assert.deepEqual(bands.map((b) => [b.type, b.rank]), [['Assault', 1]]);
});

test('a payload with no per-type data still draws the day totals', () => {
  const bands = stackBands(series, []);
  assert.deepEqual(bands.map((b) => [b.day, b.from, b.to]), [[0, 0, 4], [1, 0, 2]]);
});

test('junk in the series is read as zero rather than drawn as NaN', () => {
  const bands = stackBands([{ count: 'nonsense' }, { count: -5 }, { count: 2 }], []);
  assert.deepEqual(bands.map((b) => b.day), [2]);
  assert.equal(bands[0].to, 2);
});

test('a missing or malformed payload yields no bands instead of throwing', () => {
  for (const junk of [undefined, null, 'nope', {}, []]) {
    assert.deepEqual(stackBands(junk, junk), []);
  }
});

test('rampStep clamps to the ramp instead of wrapping around it', () => {
  assert.equal(rampStep(0), 1);
  assert.equal(rampStep(CAT_RAMP_STEPS - 1), CAT_RAMP_STEPS);
  // The bug this guards: `rank % CAT_RAMP_STEPS + 1` would hand type 15 step 1,
  // dressing it in the BUSIEST type's colour — the one thing the ramp means.
  assert.equal(rampStep(CAT_RAMP_STEPS), CAT_RAMP_STEPS);
  assert.equal(rampStep(CAT_RAMP_STEPS + 9), CAT_RAMP_STEPS);
});

test('rampStep falls back to the tail for an unusable rank', () => {
  for (const junk of [-1, NaN, undefined, null, 'x', {}]) {
    // Never step 1: an unknown type must not borrow the commonest type's colour.
    assert.equal(rampStep(junk), CAT_RAMP_STEPS);
  }
});

test('rampColor names a token, never a literal colour', () => {
  // The token is themed; a literal here would freeze the chart in one theme.
  assert.equal(rampColor(0), 'var(--cat-1)');
  assert.equal(rampColor(3), 'var(--cat-4)');
  assert.match(rampColor(CAT_RAMP_STEPS + 4), /^var\(--cat-\d+\)$/);
});

test('alignmentWarning is silent when the payload lines up', () => {
  assert.equal(alignmentWarning(series, byType), '');
  assert.equal(alignmentWarning([], byType), '');
});

test('alignmentWarning names types whose counts are short of the day axis', () => {
  const short = [{ type: 'Theft', total: 3, counts: [3] }];
  assert.match(alignmentWarning(series, short), /^1 incident type/);
  const alsoShort = [...short, { type: 'Assault', total: 1, counts: [] }];
  assert.match(alignmentWarning(series, alsoShort), /^2 incident types/);
});

// ---- Display order: the catch-all bucket goes last -------------------------

/**
 * A server payload in volume order, with the catch-all mid-list as it arrives.
 *
 * Every entry has at least one report, so every one produces a band — an ordering
 * test that silently skipped an empty type would not be testing the ordering. And
 * `counts` sums to each type's `total`, which sums to the day totals below, so the
 * arithmetic and the ordering can be checked against the same fixture.
 */
const bigSeries = [
  { date: '2026-09-01', count: 8 },
  { date: '2026-09-02', count: 6 },
];
const byVolume = [
  { type: 'Theft', total: 7, counts: [5, 2] },
  { type: 'Assault / Physical Injury', total: 4, counts: [2, 2] },
  { type: 'Other Incident', total: 2, counts: [1, 1] },
  { type: 'Burglary / Break-In', total: 1, counts: [0, 1] },
];

test('the catch-all bucket is moved to the end', () => {
  const out = orderForDisplay(byVolume).map((c) => c.type);
  assert.deepEqual(out, [
    'Theft',
    'Assault / Physical Injury',
    'Burglary / Break-In',
    'Other Incident',
  ]);
});

test('everything that is not the catch-all keeps the server order', () => {
  // The rule moves ONE entry. If it sorted the rest, it would be a second,
  // competing opinion about volume alongside the server's.
  const before = byVolume.filter((c) => c.type !== 'Other Incident').map((c) => c.type);
  const after = orderForDisplay(byVolume).filter((c) => c.type !== 'Other Incident').map((c) => c.type);
  assert.deepEqual(after, before);
});

test('ordering never drops or duplicates an entry', () => {
  // The failure that matters most: a moved entry that is also lost takes a whole
  // incident type out of the key, and nothing on screen says so.
  const out = orderForDisplay(byVolume);
  assert.equal(out.length, byVolume.length);
  assert.deepEqual([...out].map((c) => c.type).sort(), byVolume.map((c) => c.type).sort());
});

test('ordering does not mutate the array it was handed', () => {
  const input = [...byVolume];
  orderForDisplay(input);
  assert.deepEqual(input.map((c) => c.type), byVolume.map((c) => c.type));
});

test('a list with no catch-all is left exactly as the server sent it', () => {
  const noBucket = byVolume.slice(0, 2);
  assert.deepEqual(orderForDisplay(noBucket).map((c) => c.type), noBucket.map((c) => c.type));
});

test('the catch-all is matched on its name, case-insensitively', () => {
  for (const name of ['Other Incident', 'other incident', 'OTHER', 'other']) {
    const list = [{ type: name, total: 1, counts: [1] }, { type: 'Theft', total: 9, counts: [9] }];
    assert.deepEqual(orderForDisplay(list).map((c) => c.type), ['Theft', name], `${name} must sort last`);
  }
});

test('a type that merely starts with those letters mid-word is not the catch-all', () => {
  // Anchored, not a substring search: "Mother" is not "Other".
  const list = [{ type: 'Mother', total: 1, counts: [1] }, { type: 'Theft', total: 9, counts: [9] }];
  assert.deepEqual(orderForDisplay(list).map((c) => c.type), ['Mother', 'Theft']);
});

test('a renamed catch-all falls back to volume order rather than breaking', () => {
  // The station owns its type list, so the bucket can be renamed. The chosen
  // failure is "the rule does not fire", not "the rule mangles the list".
  const renamed = [
    { type: 'Theft', total: 31, counts: [3, 0] },
    { type: 'Miscellaneous', total: 4, counts: [1, 0] },
  ];
  assert.deepEqual(orderForDisplay(renamed).map((c) => c.type), ['Theft', 'Miscellaneous']);
});

test('junk entries are dropped instead of being ordered into the key', () => {
  assert.deepEqual(orderForDisplay([null, undefined, { type: 'Theft', total: 1, counts: [1] }]).map((c) => c.type), ['Theft']);
  assert.deepEqual(orderForDisplay(undefined), []);
});

test('moving the catch-all keeps the stack summing to the day totals', () => {
  // Reordering must not disturb the arithmetic: the buckets are the same set, so
  // every day must still stack to its total, whatever order they are drawn in.
  const ordered = orderForDisplay(byVolume);
  const bands = stackBands(bigSeries, ordered);
  for (const [day, total] of [[0, 8], [1, 6]]) {
    const top = bands.filter((b) => b.day === day).reduce((m, b) => Math.max(m, b.to), 0);
    assert.equal(top, total, `day ${day} must still stack to ${total}`);
  }
  // The bucket is drawn in its new position — last, so highest in the column.
  const day0 = bands.filter((b) => b.day === 0);
  assert.equal(day0[day0.length - 1].type, 'Other Incident');
});

test('the key and the stack read the same position, once, from one list', () => {
  // The key identifies a band by its ordinal position, so the two must come from
  // a single ordering. Ordering the stack separately would let key row 3 name a
  // different type from stack band 3 — a key that lies, with no way to see it.
  const ordered = orderForDisplay(byVolume);
  const bands = stackBands(bigSeries, ordered);
  for (let rank = 0; rank < ordered.length; rank++) {
    const band = bands.find((b) => b.rank === rank);
    if (band) assert.equal(band.type, ordered[rank].type);
  }
});

// ---- The ramp, in both themes ---------------------------------------------

test('every ramp step has a matching fill class', () => {
  // The tokens and the classes can drift apart silently: a band whose class does
  // not exist renders with no fill, which on a dark panel looks like a gap.
  const classes = new Set([...css('styles.css').matchAll(/\.dash-seg--(\d+)\s*\{/g)].map((m) => Number(m[1])));
  for (let step = 1; step <= CAT_RAMP_STEPS; step++) {
    assert.ok(classes.has(step), `.dash-seg--${step} must be defined`);
  }
  assert.equal(classes.size, CAT_RAMP_STEPS, 'no stray dash-seg classes beyond the ramp');
});

test('light declares the whole ramp, with no repeated step', () => {
  const light = ramp('styles.css');
  assert.equal(Object.keys(light).length, CAT_RAMP_STEPS);
  assert.equal(new Set(Object.values(light)).size, CAT_RAMP_STEPS, 'each step must be its own colour');
});

test('dark states its OWN ramp rather than inheriting light\'s', () => {
  // Inheriting is not a near-miss here: light's ladder runs dark-to-pale for a
  // white panel, so on a near-black one it inverts and the busiest type becomes
  // the least visible band. This asserts the override exists at all.
  const dark = ramp('dark-theme.css');
  assert.equal(Object.keys(dark).length, CAT_RAMP_STEPS);
  assert.notDeepEqual(dark, ramp('styles.css'));
});

test('each theme\'s ramp descends in contrast against its own panel', () => {
  for (const [name, source] of [['light', 'styles.css'], ['dark', 'dark-theme.css']]) {
    const tokens = ramp(source);
    const bg = panel(source);
    const ratios = [];
    for (let step = 1; step <= CAT_RAMP_STEPS; step++) {
      ratios.push(contrast(tokens[step], bg));
    }
    for (let i = 1; i < ratios.length; i++) {
      assert.ok(
        ratios[i] < ratios[i - 1],
        `${name}: step ${i + 1} (${ratios[i].toFixed(2)}:1) must be lighter than step ${i} (${ratios[i - 1].toFixed(2)}:1) — ` +
          'the ramp is ordinal, so a later type drawn heavier inverts what the chart says',
      );
    }
  }
});

test('the busiest type is the heaviest band in both themes', () => {
  for (const [name, source, floor] of [['light', 'styles.css', 8], ['dark', 'dark-theme.css', 8]]) {
    const tokens = ramp(source);
    const bg = panel(source);
    const head = contrast(tokens[1], bg);
    const tail = contrast(tokens[CAT_RAMP_STEPS], bg);
    assert.ok(head >= floor, `${name}: step 1 is ${head.toFixed(2)}:1, wants ≥ ${floor}:1`);
    assert.ok(head / tail >= 2.5, `${name}: step 1 must clearly out-weigh step N (${head.toFixed(2)} vs ${tail.toFixed(2)})`);
  }
});

test('no step sinks into the panel it is drawn on', () => {
  // The 1px --panel stroke separates neighbours, but a step below this floor is
  // invisible as a band regardless of its stroke.
  for (const [name, source] of [['light', 'styles.css'], ['dark', 'dark-theme.css']]) {
    const tokens = ramp(source);
    const bg = panel(source);
    for (let step = 1; step <= CAT_RAMP_STEPS; step++) {
      const c = contrast(tokens[step], bg);
      assert.ok(c >= 2.2, `${name}: step ${step} is ${c.toFixed(2)}:1 against ${bg} — too faint to see`);
    }
  }
});

// ---- Where the pointer is --------------------------------------------------

// A plot whose days divide its inner width EXACTLY, so the boundaries below are
// real expectations rather than floating-point coin flips: 1000px of inner width
// over 10 days is a 100px column, and every boundary lands on a whole pixel.
const PLOT = { width: 1040, padLeft: 20, padRight: 20, days: 10 };

test('the pointer names the day whose column it is over', () => {
  assert.equal(dayAtPointer(20, PLOT), 0, 'the first pixel of the inner width is day 0');
  assert.equal(dayAtPointer(119.9, PLOT), 0, 'day 0 runs to its own right edge');
  assert.equal(dayAtPointer(120, PLOT), 1, 'the boundary belongs to the NEXT day, as the column does');
  assert.equal(dayAtPointer(500, PLOT), 4);
  assert.equal(dayAtPointer(1019.9, PLOT), 9, 'the last day ends at the inner right edge');
});

test('the pointer is clamped into the plot, never off the end of it', () => {
  // A pointer in the left padding is nearer day 0 than no day at all, and the same
  // at the right — the padding is a margin, not a gap in the chart.
  assert.equal(dayAtPointer(0, PLOT), 0);
  assert.equal(dayAtPointer(-40, PLOT), 0);
  assert.equal(dayAtPointer(1040, PLOT), 9);
  assert.equal(dayAtPointer(9999, PLOT), 9);
});

test('a plot with no days, no width, or no number gives no day', () => {
  // The frame before the width is measured: there are no columns to be over, and
  // reporting day 0 there would open a menu on a column that is not drawn.
  assert.equal(dayAtPointer(100, { ...PLOT, width: 0 }), null);
  assert.equal(dayAtPointer(100, { ...PLOT, days: 0 }), null);
  assert.equal(dayAtPointer(100, { ...PLOT, days: 1 }), 0, 'one day is always that day');
  assert.equal(dayAtPointer(Number.NaN, PLOT), null);
  assert.equal(dayAtPointer(100, { ...PLOT, width: Number.NaN }), null);
});

test('one day at the pointer is the same day the hover reports', () => {
  // The two read the same function, which is the point: a right-click that
  // computed its own day from the band width is how a menu comes to act on the
  // column beside the cursor. Here the geometry is the real one — the padded
  // width of a full-width plot over 30 days.
  const real = { width: 1084, padLeft: 34, padRight: 12, days: 30 };
  const band = (1084 - 34 - 12) / 30;
  for (const day of [0, 1, 15, 29]) {
    const middle = 34 + band * day + band / 2;
    assert.equal(dayAtPointer(middle, real), day, `the middle of column ${day}`);
    assert.equal(dayAtPointer(34 + band * day + 0.01, real), day, `the left edge of column ${day}`);
  }
});

// A 4-report column of two bands: 3 of Theft on the baseline, 1 of Robbery above
// it. axisMax 4 over 100px of inner height puts a report at 25px, so the column
// runs from the baseline (y=100) up to y=0 — the Robbery band from 0 to 25, and
// Theft from 25 to 100.
const COLUMN = [
  { day: 0, type: 'Theft', rank: 0, value: 3, from: 0, to: 3 },
  { day: 0, type: 'Robbery', rank: 1, value: 1, from: 3, to: 4 },
];
const COLUMN_GEO = { axisMax: 4, innerH: 100, padTop: 0 };

test('the pointer picks the band it is actually inside', () => {
  assert.equal(bandAtPointer(12, COLUMN, COLUMN_GEO).type, 'Robbery', 'the top of the column');
  assert.equal(bandAtPointer(60, COLUMN, COLUMN_GEO).type, 'Theft', 'the bottom of the column');
});

test('up the column is up the counts, not down them', () => {
  // The one mistake this function can make that a hover cannot reveal: flipping the
  // projection puts the RAREST band on the baseline, which is a claim about the
  // data rather than a mis-aimed menu.
  const rarest = bandAtPointer(10, COLUMN, COLUMN_GEO);
  const busiest = bandAtPointer(90, COLUMN, COLUMN_GEO);
  assert.equal(rarest.type, 'Robbery');
  assert.equal(rarest.from, 3, 'the band at the TOP of the column starts where the baseline band ends');
  assert.equal(busiest.from, 0, 'the band on the baseline carries the column up from zero');
});

test('above the column, and beside it, is no band at all', () => {
  // The plot's top padding is background, and so is anywhere a day has no report
  // of any type: offering "show only Theft" there would name a box that is not drawn.
  assert.equal(bandAtPointer(-5, COLUMN, COLUMN_GEO), null, 'above the axis maximum');
  assert.equal(bandAtPointer(120, COLUMN, COLUMN_GEO), null, 'below the baseline');
  assert.equal(bandAtPointer(50, [], COLUMN_GEO), null, 'a day with no bands');
  assert.equal(bandAtPointer(Number.NaN, COLUMN, COLUMN_GEO), null);
  assert.equal(bandAtPointer(50, COLUMN, { ...COLUMN_GEO, axisMax: 0 }), null);
});

// ---- The day, as text for the clipboard ------------------------------------

test("a day's breakdown carries the scope, because the paste has lost it", () => {
  const bands = [
    { type: 'Theft', value: 2 },
    { type: 'Domestic Violence', value: 1 },
    { type: 'Assault / Physical Injury', value: 1 },
  ];
  const lines = dayBreakdownText('2026-09-13', bands).split('\n');
  assert.equal(lines[0], '4 reports on 2026-09-13 (station-wide)');
  // Most frequent first, then by name — the question the chart answers. NOT the
  // ramp's order, which exists so the colours stay readable and means nothing to
  // someone reading the text in an email.
  assert.deepEqual(lines.slice(1), [
    'Theft: 2',
    'Assault / Physical Injury: 1',
    'Domestic Violence: 1',
  ]);
});

test('the copied header names a filter that is in force', () => {
  const bands = [{ type: 'Theft', value: 3 }];
  assert.equal(
    dayBreakdownText('2026-09-13', bands, { scope: 'mine' }),
    '3 reports on 2026-09-13 (my reports only)\nTheft: 3',
  );
  // With the chart filtered to a type, the day's total is a THEFT total — a header
  // that said "3 reports" would read as the day's whole register.
  assert.equal(
    dayBreakdownText('2026-09-13', bands, { type: 'Theft' }),
    '3 Theft reports on 2026-09-13 (station-wide)\nTheft: 3',
  );
});

test('a day with nothing in it copies nothing', () => {
  assert.equal(dayBreakdownText('2026-09-13', []), '');
  assert.equal(dayBreakdownText('', [{ type: 'Theft', value: 1 }]), '');
  assert.equal(dayBreakdownText('2026-09-13', null), '');
  // Zero-value bands are not rows — the clipboard has no use for a type that is
  // not on the day, and a header of "0 reports" would be a claim about a day the
  // range does not even contain.
  assert.equal(dayBreakdownText('2026-09-13', [{ type: 'Theft', value: 0 }]), '');
});

// ---- The right-click menu --------------------------------------------------

test('the plot menu offers a box type only when a box was right-clicked', () => {
  const background = chartMenuItems({ date: '2026-09-13', total: 4 });
  const onBox = chartMenuItems({ date: '2026-09-13', type: 'Theft', total: 4 });
  assert.equal(background.length, 4, 'no incident type under the pointer, no type entry');
  assert.equal(onBox.length, 5);
  assert.deepEqual(
    onBox.map((i) => i.key),
    [CHART_MENU.focusDay, CHART_MENU.onlyType, CHART_MENU.openReports, CHART_MENU.copyDay, CHART_MENU.pinDay],
  );
  assert.equal(onBox[1].label, 'Show only Theft');
  assert.ok(!background.some((i) => i.key === CHART_MENU.onlyType));
});

test('every entry says what it will do, and says it for the state it is in', () => {
  // Each of these is a label that would be a lie under the other condition.
  assert.equal(
    chartMenuItems({ date: 'd', type: 'Theft', activeType: 'Theft' })[1].label,
    'Show every incident type',
    'a filter already in force has to be the thing the entry removes',
  );
  assert.equal(chartMenuItems({ date: 'd', pinned: true }).at(-1).label, 'Unpin this day');
  assert.equal(chartMenuItems({ date: 'd' }).at(-1).label, 'Pin this day open');
  assert.equal(
    chartMenuItems({ date: 'd', activeDay: 'd' })[0].disabled,
    true,
    'the range is already this day, so narrowing it again is a dead entry',
  );
  assert.equal(chartMenuItems({ date: 'd', activeDay: 'other' })[0].disabled, false);
  assert.equal(
    chartMenuItems({ date: 'd', total: 0 }).find((i) => i.key === CHART_MENU.openReports).disabled,
    true,
    'nothing to open on a day with no reports',
  );
  // One report is 'report', not 'reports'.
  assert.match(chartMenuItems({ date: 'd', total: 1 }).find((i) => i.key === CHART_MENU.openReports).hint, /1 report on d/);
  assert.match(chartMenuItems({ date: 'd', total: 4 }).find((i) => i.key === CHART_MENU.openReports).hint, /4 reports on d/);
  // The register has no scope of its own, so a chart scoped to the reader's own
  // reports must not promise a list of exactly that.
  const openHint = (scope) =>
    chartMenuItems({ date: 'd', total: 4, scope }).find((i) => i.key === CHART_MENU.openReports).hint;
  assert.doesNotMatch(openHint('all'), /not only your own/);
  assert.match(openHint('mine'), /not only your own reports/);
});

test('a menu with no day to act on is not a menu', () => {
  assert.deepEqual(chartMenuItems(), []);
  assert.deepEqual(chartMenuItems({ date: '' }), []);
  // Every entry is labelled, hinted and keyed — an unlabelled button or a key the
  // chart does not dispatch is an entry that does nothing when clicked.
  const keys = new Set(Object.values(CHART_MENU));
  for (const item of chartMenuItems({ date: '2026-09-13', type: 'Theft', total: 2 })) {
    assert.ok(item.label, 'every entry needs a label');
    assert.ok(item.hint, `${item.key} needs a hint — the label cannot carry the specifics`);
    assert.ok(keys.has(item.key), `${item.key} is not a key the chart can dispatch`);
  }
});

// ---- The dim that answers a hover ------------------------------------------

const component = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');

/** The sRGB channels of a #RRGGBB string. */
function channels(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}

/** `fg` drawn over `bg` at an opacity — how CSS opacity composites (in sRGB). */
function over(fg, bg, alpha) {
  const F = channels(fg);
  const B = channels(bg);
  return '#' + F.map((v, i) => Math.round(v * alpha + B[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

/** The opacity a non-hovered band recedes to, read from the real stylesheet. */
function mutedOpacity() {
  const m = css('styles.css').match(/\.dash-seg\.is-muted\s*\{[^}]*opacity:\s*([\d.]+)/);
  assert.ok(m, 'styles.css must dim the non-hovered bands through .dash-seg.is-muted');
  return Number(m[1]);
}

test('a hover dims the other days, and can only ever do so on request', () => {
  const sheet = css('styles.css');
  const alpha = mutedOpacity();
  // Below the floor the neighbouring days are erased rather than pushed back and
  // the plot stops being a plot; at 1 the hover emphasises nothing at all.
  assert.ok(
    alpha > 0.15 && alpha < 0.6,
    `.dash-seg.is-muted is ${alpha}, outside the 0.15–0.6 band — a no-op or a blackout, not a dim`,
  );
  // SCOPED to the class. On the bare `.dash-seg` rule it would dim every band on
  // every render, including the hovered day's.
  //
  // Read per RULE and look for an `opacity:` DECLARATION: a plain substring hunt
  // also matches the reduced-motion rule, whose `transition: opacity 140ms` is
  // not a dim at all.
  for (const [, selector, body] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const bare = selector.split(',').map((s) => s.trim());
    if (!bare.includes('.dash-seg')) continue;
    assert.ok(
      !/(?:^|;)\s*opacity\s*:/m.test(body),
      'opacity belongs on .dash-seg.is-muted — on .dash-seg it would dim the hovered day too',
    );
  }
  // The two halves of one coupling: the class the stylesheet dims must be the
  // class the chart puts on the other days. Renaming either side stops the dim
  // silently — no error, no visual clue, just a hover that no longer answers.
  assert.match(component, /is-muted/, 'Dashboard.jsx must apply the class styles.css dims');
  assert.match(
    component,
    /shown\s*!=\s*null\s*&&\s*b\.day\s*!==\s*shown/,
    'the dim must select the days that are NOT the one on screen',
  );
  // ...and the day on screen must be the hovered one OR the pinned one. A dim keyed
  // to `hover` alone would leave a pinned card floating over an undimmed chart,
  // reading as a card about no particular day.
  assert.match(
    component,
    /const shown = hover != null \? hover : pinnedIdx >= 0 \? pinnedIdx : null/,
    'the shown day must fall back to the pinned day when nothing is hovered',
  );
});

test('a dimmed day recedes but stays readable, and stays ordinal', () => {
  const alpha = mutedOpacity();
  for (const [name, source] of [['light', 'styles.css'], ['dark', 'dark-theme.css']]) {
    const tokens = ramp(source);
    const bg = panel(source);
    const steps = [];
    for (let step = 1; step <= CAT_RAMP_STEPS; step++) steps.push(tokens[step]);
    const full = steps.map((hex) => contrast(hex, bg));
    const muted = steps.map((hex) => contrast(over(hex, bg, alpha), bg));
    for (let i = 1; i < muted.length; i++) {
      assert.ok(
        muted[i] < muted[i - 1],
        `${name}: dimmed step ${i + 1} (${muted[i].toFixed(2)}:1) must still be lighter than step ${i} ` +
          `(${muted[i - 1].toFixed(2)}:1) — the dim must not invert the ramp it is dimming`,
      );
    }
    // Receded (so the hover reads) yet present (so the neighbours are context).
    assert.ok(muted[0] < full[0] * 0.6, `${name}: the dimmed ramp barely moved (${muted[0].toFixed(2)}:1 of ${full[0].toFixed(2)}:1)`);
    assert.ok(muted[0] >= 1.5, `${name}: dimmed step 1 is ${muted[0].toFixed(2)}:1 — the shape is gone, not dimmed`);
    assert.ok(muted[muted.length - 1] >= 1.25, `${name}: dimmed step ${CAT_RAMP_STEPS} is ${muted[muted.length - 1].toFixed(2)}:1 — invisible`);
  }
});
