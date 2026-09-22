// BlueWrite — the incident-category rank chart's arithmetic.
//
// "Which incident type is getting higher?" is answered by RANK over time, and rank is
// where a chart lies most easily. A type can climb because it grew, because a rival
// fell, or because both were tiny — three different stories, one identical picture. The
// rules that keep those apart live in src/lib/categoryRank.js and are pinned here,
// headlessly, because a chart drawn wrong still looks like a chart.
//
// The failures this file exists for:
//
//   - AN ABSENT TYPE RANKED LAST. A type with nothing in a bucket is not the least
//     frequent of that bucket's incidents; it had none. Ranking it last invents a
//     position, and joining the line across the gap draws a fall and a recovery that
//     never happened.
//   - A TIE DECIDED BY CHANCE. Two types on four reports must hold one order in every
//     bucket, or their lines cross for no reason and the panel reports a movement that
//     is only sort instability.
//   - A RANK COMPUTED OVER THE DRAWN TYPES ONLY. Position is a fact about the whole
//     register: hiding the types below the leaders would move the leaders up.
//   - A SENTENCE THE CHART CANNOT SUPPORT. The headline quotes two ranks the reader can
//     see at the ends of a line, and nothing about the path between them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BUCKETS,
  axisTicks,
  bucketNoun,
  bucketize,
  chooseDrawn,
  rankByBucket,
  rankGeometry,
  rankHeadline,
  typeReading,
} from '../../src/lib/categoryRank.js';

/** A zero-filled day axis, `n` days ending 2026-09-22. */
function days(n) {
  const out = [];
  const end = Date.UTC(2026, 8, 22);
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push({ date: new Date(end - i * 86400000).toISOString().slice(0, 10), count: 0 });
  }
  return out;
}

/** The same axis with `perDay` reports on every day — how bucket size is decided. */
function axis(n, perDay) {
  return days(n).map((d) => ({ ...d, count: perDay }));
}

/** `counts` is looked up by day index; every other day is zero. */
function type(name, counts) {
  const max = Math.max(...Object.keys(counts).map(Number)) + 1;
  return { type: name, total: Object.values(counts).reduce((a, b) => a + b, 0), counts: Array.from({ length: max }, (_, i) => counts[i] ?? 0) };
}

test('the bucket size follows how much the range HOLDS, not how long it is', () => {
  // The same thirty days at two volumes. A quiet month is three reports a day spread over
  // a dozen types, so cutting it daily gives a ruler with a few isolated dots on it — it
  // stays on weeks. A busy one is dense enough to be days, and thirty columns still fit.
  assert.equal(bucketize(axis(30, 3)).size, 'week');
  assert.equal(bucketize(axis(30, 30)).size, 'day');
  assert.equal(bucketize(axis(30, 30)).buckets.length, 30);

  // A longer range steps up even when it is sparse: sixty days of one report a day cannot
  // fill a week (9 buckets, 6.7 each), so it is drawn in weeks rather than in days.
  assert.equal(bucketize(axis(60, 1)).size, 'week');

  // A year: daily would be 365 columns two pixels apart, so it is months…
  assert.equal(bucketize(axis(365, 1)).size, 'month');
  // …and the density rule cannot buy the comb back — a BUSY year clears MIN_PER_BUCKET at
  // daily resolution, which is exactly why the ceiling has to exist independently of it.
  assert.equal(bucketize(axis(365, 10)).size, 'month');
  assert.ok(bucketize(axis(365, 10)).buckets.length <= MAX_BUCKETS);

  // A short range has no coarser unit to fall back on: three days is three buckets.
  assert.equal(bucketize(days(3)).buckets.length, 3);
  assert.equal(bucketize([]).buckets.length, 0);
  assert.ok(bucketNoun('week', 3) === 'weeks' && bucketNoun('day', 1) === 'day');
});

test('every day lands in exactly one bucket, and the newest day is always in the last one', () => {
  // The bug this catches: buckets anchored to the START of the range, which leaves the
  // reader's own day in a half bucket at the far right — or, worse, out of the chart.
  for (const n of [7, 30, 31, 32, 60, 180, 181, 400]) {
    const axis = days(n);
    const { buckets } = bucketize(axis);
    const seen = buckets.flatMap((b) => b.days);
    assert.equal(seen.length, n, `${n} days must all be bucketed`);
    assert.equal(new Set(seen).size, n, `${n} days: no day may be in two buckets`);
    assert.equal(
      buckets[buckets.length - 1].days[buckets[buckets.length - 1].days.length - 1],
      n - 1,
      `${n} days: the last bucket must END on the last day`,
    );
    assert.equal(buckets[buckets.length - 1].end, axis[n - 1].date);
    assert.equal(buckets[0].start, axis[0].date, `${n} days: the buckets must cover the whole range`);
  }
});

test('a type with nothing in a bucket is absent, not last', () => {
  const { buckets } = bucketize(days(2));
  const { lanes, perType } = rankByBucket(
    [type('Theft', { 0: 3, 1: 3 }), type('Robbery', { 0: 1 }), type('Fire Incident', { 1: 9 })],
    buckets,
  );

  const theft = perType.find((t) => t.type === 'Theft');
  const robbery = perType.find((t) => t.type === 'Robbery');
  const fire = perType.find((t) => t.type === 'Fire Incident');

  assert.equal(theft.ranks[0], 1);
  assert.equal(robbery.ranks[0], 2, 'day one: Theft 3, Robbery 1');
  assert.equal(robbery.ranks[1], null, 'Robbery had nothing on day two — absent, not second');
  assert.equal(fire.ranks[0], null, 'Fire had nothing on day one');
  assert.equal(fire.ranks[1], 1, 'and is first on day two: rank is about the bucket, not the range');
  assert.equal(lanes, 2, 'the deepest rank any bucket actually reached');
});

test('ties break by name, so the same two types never swap for no reason', () => {
  const axis = days(3);
  const { buckets } = bucketize(axis);
  const { perType } = rankByBucket(
    [type('Theft', { 0: 4, 1: 4, 2: 4 }), type('Robbery', { 0: 4, 1: 4, 2: 4 })],
    buckets,
  );
  const theft = perType.find((t) => t.type === 'Theft');
  const robbery = perType.find((t) => t.type === 'Robbery');
  // Equal counts, so the name decides — and it decides the SAME way in every bucket.
  assert.deepEqual(robbery.ranks, [1, 1, 1], 'Robbery sorts before Theft and holds rank 1');
  assert.deepEqual(theft.ranks, [2, 2, 2], 'Theft is second in every bucket, never swapping');
  for (const b of buckets) {
    assert.equal(theft.counts[b.days[0]], robbery.counts[b.days[0]], 'the tie is real');
  }
});

test('position is a fact about the whole register, not about the drawn types', () => {
  const { buckets } = bucketize(days(1));
  const { perType } = rankByBucket(
    [type('Theft', { 0: 9 }), type('Robbery', { 0: 5 }), type('Fire Incident', { 0: 3 }), type('Lost Property', { 0: 1 })],
    buckets,
  );
  const lost = perType.find((t) => t.type === 'Lost Property');
  assert.equal(lost.ranks[0], 4, 'the smallest type is ranked 4th of four, not 2nd of the two drawn');
});

test('a bucket with no reports at all ranks nobody, and does not crash the lanes', () => {
  const { buckets } = bucketize(days(3));
  const { lanes, perType } = rankByBucket([type('Theft', { 0: 1 })], buckets);
  assert.deepEqual(perType[0].ranks, [1, null, null]);
  assert.equal(lanes, 1, 'one lane is enough for a chart with one rank in it');
});

test('only the volume leaders are drawn, and a line needs two points', () => {
  const { buckets } = bucketize(days(4));
  const many = [
    type('A', { 0: 8, 1: 8, 2: 8, 3: 8 }),
    type('B', { 0: 7, 1: 7, 2: 7, 3: 7 }),
    type('C', { 0: 6, 1: 6, 2: 6, 3: 6 }),
    type('D', { 0: 5, 1: 5, 2: 5, 3: 5 }),
    type('E', { 0: 4, 1: 4, 2: 4, 3: 4 }),
    type('F', { 0: 3, 1: 3, 2: 3, 3: 3 }),
    type('One-off', { 2: 40 }),
  ];
  const { perType } = rankByBucket(many, buckets);
  const { drawn, omitted } = chooseDrawn(perType);
  assert.equal(drawn.length, 6);
  assert.equal(omitted, 1, 'the type with a single bucket is counted, not drawn as a dot');
  // Volume order from the server is kept, so a type's colour cannot change between loads.
  assert.deepEqual(drawn.map((t) => t.type), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('a line breaks where its type had nothing, instead of drawing through the gap', () => {
  const { buckets } = bucketize(days(5));
  const { perType } = rankByBucket([type('Theft', { 0: 5, 1: 5, 2: 0, 3: 5, 4: 5 }), type('Robbery', { 0: 1, 1: 1, 2: 9, 3: 1, 4: 1 })], buckets);
  const [theft] = rankGeometry([perType[0]], { lanes: 2, width: 300, height: 100, pad: { l: 0, r: 0, t: 0, b: 0 } });
  assert.equal(theft.points.length, 4, 'four ranked buckets, five buckets in the range');
  assert.equal(theft.segments.length, 2, 'the gap splits the line in two');
  assert.deepEqual(theft.segments.map((s) => s.length), [2, 2]);
  // Rank 1 is the TOP of the plot, because a higher line must mean a better position.
  const rankedFirst = theft.points.filter((p) => p.y === 0);
  assert.equal(rankedFirst.length, 4, 'theft is rank 1 in all four of its buckets');
});

test('geometry survives the degenerate shapes a real payload produces', () => {
  const pad = { l: 10, r: 10, t: 5, b: 5 };
  const { buckets } = bucketize(days(1));
  const { perType } = rankByBucket([type('Theft', { 0: 1 })], buckets);
  const [only] = rankGeometry([perType[0]], { lanes: 1, width: 200, height: 80, pad });
  assert.equal(only.points.length, 1, 'one bucket, one point');
  assert.equal(only.segments.length, 1, 'a single point is still a segment, drawn as a dot');
  assert.equal(only.end.index, 0);
  assert.ok(Number.isFinite(only.points[0].x) && Number.isFinite(only.points[0].y), 'no NaN in a viewBox');
  assert.deepEqual(rankGeometry([], { lanes: 3, width: 200, height: 80, pad }), []);
});

test('the axis is labelled at both ends, with something in between', () => {
  const { buckets } = bucketize(days(30));
  const ticks = axisTicks(buckets, 5);
  assert.equal(ticks.length, 5);
  assert.equal(ticks[0].index, 0);
  assert.equal(ticks[ticks.length - 1].index, buckets.length - 1, 'the newest day must be labelled');
  assert.deepEqual(axisTicks(buckets.slice(0, 3), 5).map((t) => t.index), [0, 1, 2], 'few buckets, few ticks');
});

test('the headline is a rank a reader can check at the ends of a line', () => {
  const { buckets } = bucketize(days(4));
  const { perType } = rankByBucket(
    [type('Theft', { 0: 2, 1: 2, 2: 5, 3: 9 }), type('Robbery', { 0: 9, 1: 9, 2: 5, 3: 2 })],
    buckets,
  );
  const head = rankHeadline(perType, buckets);
  assert.equal(head.kind, 'climb');
  assert.equal(head.type, 'Theft', 'the type that gained the most places leads the sentence');
  assert.equal(head.gain, 1);
  // Both quoted numbers are positions the line itself crosses, and the count comes with
  // them because rank without magnitude is this chart's one way to mislead.
  assert.match(head.text, /^Theft climbed from rank 2 to rank 1 since 09-19 \(18 reports over the range\)$/);
});

test('a tie in improvement goes to the type carrying more reports', () => {
  // Both types climb one place between the two buckets; B is the one with the volume, so
  // B leads the sentence. Without the volume tiebreak this would fall to payload order,
  // i.e. to whichever type the server happened to list first.
  const { buckets } = bucketize(days(2));
  const fixture = [type('A', { 0: 1, 1: 8 }), type('B', { 0: 2, 1: 9 }), type('C', { 0: 3, 1: 1 })];
  const { perType } = rankByBucket(fixture, buckets);
  const a = perType.find((t) => t.type === 'A');
  const b = perType.find((t) => t.type === 'B');
  assert.deepEqual([a.ranks, a.total], [[3, 2], 9]);
  assert.deepEqual([b.ranks, b.total], [[2, 1], 11]);
  assert.equal(rankHeadline(perType, buckets).type, 'B');

  // …and the sentence is the same whichever order the payload lists them in.
  const flipped = rankByBucket([...fixture].reverse(), buckets);
  assert.equal(rankHeadline(perType, buckets).text, rankHeadline(flipped.perType, buckets).text);
});

test('with nothing climbing, the sentence says who is on top instead of saying nothing', () => {
  const { buckets } = bucketize(days(3));
  const { perType } = rankByBucket([type('Theft', { 0: 5, 1: 5, 2: 5 }), type('Robbery', { 0: 2, 1: 2, 2: 2 })], buckets);
  const head = rankHeadline(perType, buckets);
  assert.equal(head.kind, 'holds');
  assert.equal(head.type, 'Theft');
  assert.match(head.text, /Theft is the most reported type in the latest bucket/);
});

test('a reading carries the count with the position, and survives a payload without deltas', () => {
  const { buckets } = bucketize(days(4));
  const { perType } = rankByBucket([type('Theft', { 0: 2, 1: 2, 2: 5, 3: 9 }), type('Robbery', { 0: 9, 1: 9, 2: 5, 3: 2 })], buckets);
  const reading = typeReading(perType[0], { deltas: { Theft: { current: 18, previous: 12 } }, rangeTotal: 30 });
  assert.equal(reading.total, 18);
  assert.equal(reading.share, 60);
  assert.equal(reading.deltaPct, 50);
  assert.equal(reading.firstRank, 2);
  assert.equal(reading.lastRank, 1);
  assert.equal(reading.climbed, 1);
  assert.equal(reading.rankedIn, 4);
  assert.equal(reading.bucketCount, 4);

  // No previous period to compare with (the server sends 0), and no range total: the
  // reading must say "no comparison" rather than "0%".
  const bare = typeReading(perType[0], { deltas: { Theft: { current: 18, previous: 0 } }, rangeTotal: 0 });
  assert.equal(bare.deltaPct, null);
  assert.equal(bare.share, null);
  assert.equal(typeReading(null), null);
});
