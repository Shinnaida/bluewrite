// BlueWrite — the incident-category rank chart's arithmetic, and nothing else.
//
// WHY THIS IS A MODULE OF ITS OWN. "Which incident type is getting higher?" is a
// question about RANK over time, and rank is where a chart lies most easily: a type can
// climb because it grew, because a rival fell, or because both were tiny. Those are
// three different stories with one identical picture. So the rules live here, stated
// once and tested headlessly (tests/rules/categoryRank.test.mjs), rather than being
// implied by the drawing code in Dashboard.jsx.
//
// The rules, in full:
//
//  1. Time is bucketed — a day, a week or a month, chosen from what the range HOLDS
//     rather than from how long it is (MIN_PER_BUCKET, MAX_BUCKETS). A 200-day range at
//     daily resolution is a comb nobody can read, so it is drawn in weeks or months
//     whatever the range says.
//  2. A bucket's rank compares the types that HAVE reports in that bucket. A type with
//     nothing that day is not "last" — it is absent, and its line breaks. Ranking an
//     absent type last would say it was the least frequent of the day's incidents,
//     which is a different and false claim.
//  3. Ties break by type name, not by chance. Two types on four reports must keep the
//     same up/down order in every bucket or their lines cross for no reason.
//  4. Only the volume leaders are drawn, and a type needs at least two buckets with a
//     rank to be one of them: a line needs two points to be a line.
//  5. Rank ignores magnitude — that is what it is for, and it is also its trap, which
//     is why every reading here carries the count beside the position.

/**
 * How many buckets a range must produce before "movement" means anything.
 *
 * A rank chart drawn in two or three slices is a slope chart with a story missing: with
 * two buckets every line can only rise, fall or stay flat, and "is it getting higher"
 * deserves better than a yes/no.
 */
export const MIN_BUCKETS = 4;

/**
 * …and how many reports a bucket needs before a rank inside it is worth reading.
 *
 * This is the rule that decides day vs week vs month, and it exists because of a real
 * chart: at daily buckets a 30-day range holds about three or four reports a day across
 * a dozen types, so almost every type is absent from almost every column and the panel
 * becomes a long ruler with one line lying flat across it. A bucket should have enough
 * reports in it that several types are present in the same slice — otherwise there is
 * nothing to compare the rank against.
 */
export const MIN_PER_BUCKET = 8;

/**
 * …and how many buckets a range may ever be cut into.
 *
 * The density rule alone is not enough: a year of ten reports a day would clear
 * MIN_PER_BUCKET at daily resolution and draw 365 columns two pixels apart — the comb the
 * module notes warn about, arrived at from the other direction. So a bucket count above
 * this is not a candidate, whatever its density, and the range steps up to the next unit.
 * Thirty-two is where a column still has room to be a column on a dashboard-wide plot.
 */
export const MAX_BUCKETS = 32;

/** How many types the chart draws as lines. The rest are counted, not drawn. */
export const DRAWN_TYPES = 6;

/** How many buckets a type must appear in to earn a line. */
export const MIN_PRESENCE = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** MM-DD, in the local calendar the payload's dates are already in. */
function shortDate(iso) {
  return iso.slice(5);
}

/** The plural noun for a bucket size, for sentences: "the last 3 weeks". */
export function bucketNoun(size, n = 2) {
  const word = size === 'day' ? 'day' : size === 'week' ? 'week' : 'month';
  return n === 1 ? word : `${word}s`;
}

/** One bucket per day. */
function byDay(days) {
  return days.map((point, i) => ({
    label: shortDate(point.date),
    start: point.date,
    end: point.date,
    days: [i],
  }));
}

/** One bucket per week, anchored to the END of the range (see bucketize). */
function byWeek(days) {
  const buckets = [];
  for (let end = days.length - 1; end >= 0; end -= 7) {
    const start = Math.max(0, end - 6);
    const indexes = [];
    for (let i = start; i <= end; i += 1) indexes.push(i);
    buckets.unshift({
      label: shortDate(days[end].date),
      start: days[start].date,
      end: days[end].date,
      days: indexes,
    });
  }
  return buckets;
}

/** One bucket per calendar month, also end-anchored. */
function byMonth(days) {
  const buckets = [];
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const key = days[i].date.slice(0, 7);
    const open = buckets[0];
    if (open && open.key === key) {
      open.days.unshift(i);
      open.start = days[i].date;
    } else {
      buckets.unshift({
        key,
        label: MONTHS[Number(key.slice(5, 7)) - 1] ?? key,
        start: days[i].date,
        end: days[i].date,
        days: [i],
      });
    }
  }
  return buckets.map(({ key, ...b }) => b);
}

/**
 * Group the day axis into the buckets ranks are computed over.
 *
 * Groups run BACKWARDS from the end of the range, so the last bucket always ends on the
 * range's last day. A 30-day range drawn weekly is therefore whole weeks with a short one
 * at the START, where a partial bucket is the oldest news rather than a half-finished
 * week sitting under the reader's eye.
 *
 * THE SIZE IS CHOSEN BY THE DATA, not by the range alone: the finest unit whose buckets
 * still hold MIN_PER_BUCKET reports each and number no more than MAX_BUCKETS, never finer
 * than MIN_BUCKETS buckets. A quiet fortnight therefore stays daily while a typical month
 * lands on weeks — which is the only way one set of rules serves a station that files
 * four reports a day and one that files forty.
 *
 * @param {{date: string, count: number}[]} series the zero-filled day axis
 * @returns {{size: 'day'|'week'|'month', buckets: {label: string, start: string, end: string, days: number[]}[]}}
 */
export function bucketize(series, { minBuckets = MIN_BUCKETS, minPerBucket = MIN_PER_BUCKET, maxBuckets = MAX_BUCKETS } = {}) {
  const days = series ?? [];
  if (!days.length) return { size: 'day', buckets: [] };

  const total = days.reduce((sum, point) => sum + (point.count ?? 0), 0);
  const sizes = [
    ['day', byDay(days)],
    ['week', byWeek(days)],
    ['month', byMonth(days)],
  ];

  // The finest unit that holds enough reports per bucket, and few enough buckets to draw…
  for (const [size, buckets] of sizes) {
    if (buckets.length >= minBuckets && buckets.length <= maxBuckets && total / buckets.length >= minPerBucket) {
      return { size, buckets };
    }
  }
  // …and when no unit can (a short range, or a very quiet one), the finest one that still
  // shows movement, even if its buckets are thin. Daily is the floor: it is the reader's
  // own unit of a day, and a chart with one bucket in it has no lines to draw.
  for (const [size, buckets] of sizes) {
    if (buckets.length >= minBuckets && buckets.length <= maxBuckets) return { size, buckets };
  }
  return { size: 'day', buckets: sizes[0][1] };
}

/**
 * The rank of every type in every bucket.
 *
 * @returns {{lanes: number, perType: {type: string, total: number, counts: number[], ranks: (number|null)[]}[]}}
 *   `counts[i]` are the type's reports in bucket i and `ranks[i]` is its position among
 *   the types present in bucket i, or null where it had none. Ranks are computed over
 *   EVERY type in the payload, not just the drawn ones: a drawn type's true position is
 *   a fact about the whole register, and hiding the types below it would move it up.
 */
export function rankByBucket(seriesByType, buckets) {
  const types = seriesByType ?? [];
  const perType = types.map((t) => {
    const counts = buckets.map((b) => b.days.reduce((sum, i) => sum + (t.counts?.[i] ?? 0), 0));
    return {
      type: t.type,
      total: counts.reduce((sum, c) => sum + c, 0),
      counts,
      ranks: counts.map(() => null),
    };
  });

  let lanes = 0;
  buckets.forEach((_, i) => {
    // Present = has a report in this bucket. Sorted by volume, then by name so a tie
    // keeps one order in every bucket (rule 3).
    const present = perType
      .filter((t) => t.counts[i] > 0)
      // Code-point comparison rather than localeCompare: a station PC in another locale
      // must not draw a different chart from the same payload.
      .sort((a, b) => b.counts[i] - a.counts[i] || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    present.forEach((t, idx) => {
      t.ranks[i] = idx + 1;
      if (t.ranks[i] > lanes) lanes = t.ranks[i];
    });
  });

  return { lanes, perType };
}

/**
 * Which types earn a line, and which are only counted.
 *
 * Volume order comes from the server (totals descending, then name), and that order is
 * kept: the ramp's colour for a type is its position in this list, so re-sorting here
 * would repaint the chart between one load and the next.
 */
export function chooseDrawn(perType, { limit = DRAWN_TYPES, minPresence = MIN_PRESENCE } = {}) {
  const drawn = [];
  let omitted = 0;
  for (const t of perType) {
    const bucketsRanked = t.ranks.filter((r) => r !== null).length;
    if (drawn.length < limit && bucketsRanked >= minPresence) drawn.push(t);
    else omitted += 1;
  }
  return { drawn, omitted };
}

/**
 * Where each drawn line goes, in the plot's own pixel space.
 *
 * Rank 1 is at the TOP — the axis is inverted because the story is position, and a
 * higher line has to mean a better position or the whole chart reads backwards.
 *
 * A line is returned as SEGMENTS, not as one path: where a type had no reports in a
 * bucket there is no point to draw, and joining across the gap would draw a fall and a
 * recovery that never happened (rule 2).
 */
export function rankGeometry(drawn, { lanes, width, height, pad }) {
  const innerW = Math.max(1, width - pad.l - pad.r);
  const innerH = Math.max(1, height - pad.t - pad.b);
  const span = Math.max(1, lanes - 1);

  return drawn.map((t) => {
    const points = [];
    t.ranks.forEach((rank, i) => {
      if (rank === null) return;
      points.push({
        index: i,
        x: pad.l + (t.ranks.length === 1 ? innerW / 2 : (i / (t.ranks.length - 1)) * innerW),
        y: pad.t + ((rank - 1) / span) * innerH,
      });
    });
    const segments = [];
    let run = [];
    points.forEach((p, idx) => {
      if (idx > 0 && p.index !== points[idx - 1].index + 1) {
        segments.push(run);
        run = [];
      }
      run.push(p);
    });
    if (run.length) segments.push(run);

    return { ...t, points, segments, end: points.length ? points[points.length - 1] : null };
  });
}

/**
 * A handful of buckets to label on the axis — including the first and the last, which
 * are the two a reader needs to bracket everything in between.
 */
export function axisTicks(buckets, count = 5) {
  if (buckets.length <= count) return buckets.map((b, i) => ({ index: i, label: b.label }));
  const picked = new Map();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i / (count - 1)) * (buckets.length - 1));
    picked.set(index, buckets[index].label);
  }
  return [...picked.entries()].map(([index, label]) => ({ index, label }));
}

/**
 * THE SENTENCE THE PANEL IS FOR: which type climbed, and how far.
 *
 * Computed, never generated: every number in it is one the reader can check against the
 * chart, and the same range always produces the same sentence. A type "climbed" from its
 * FIRST ranked bucket to its LAST, which is a weaker claim than week-by-week movement on
 * purpose — the rank the reader can see at each end of a line is exactly the two numbers
 * quoted, and a sentence that claimed the path between them would be inventing detail
 * the chart does not show.
 */
export function rankHeadline(perType, buckets) {
  const movers = (perType ?? [])
    .map((t) => {
      const ranked = t.ranks.map((r, i) => (r === null ? null : { r, i })).filter(Boolean);
      if (ranked.length < MIN_PRESENCE) return null;
      const first = ranked[0];
      const last = ranked[ranked.length - 1];
      return { type: t.type, first, last, gain: first.r - last.r, total: t.total };
    })
    .filter(Boolean)
    .filter((m) => m.gain > 0)
    // The biggest climb, and among equals the type carrying more reports — a jump on 31
    // reports is the story; the same jump on 3 is the trap this chart warns about.
    .sort((a, b) => b.gain - a.gain || b.total - a.total);

  if (movers.length) {
    const m = movers[0];
    return {
      kind: 'climb',
      type: m.type,
      gain: m.gain,
      text: `${m.type} climbed from rank ${m.first.r} to rank ${m.last.r} since ${buckets[m.first.i].label} (${m.total} report${m.total === 1 ? '' : 's'} over the range)`,
    };
  }

  // Nobody climbed: say who is on top of the last bucket, which is the other thing the
  // reader is looking for when a rank chart appears to do nothing.
  const leader = (perType ?? []).find((t) => t.ranks[t.ranks.length - 1] === 1);
  if (leader) {
    return {
      kind: 'holds',
      type: leader.type,
      gain: 0,
      text: `${leader.type} is the most reported type in the latest bucket (${leader.total} report${leader.total === 1 ? '' : 's'} over the range)`,
    };
  }

  return { kind: 'none', type: null, gain: 0, text: 'No type kept a rank across this range.' };
}

/**
 * Everything the panel says about ONE type when it is picked: the count, its share of
 * the range, how it moved against the previous period, and how often it ranked at all.
 *
 * The count travels with the rank in every line of it, because rank without magnitude is
 * the chart's one real way to mislead (rule 5).
 */
export function typeReading(entry, { deltas, rangeTotal } = {}) {
  if (!entry) return null;
  const d = deltas?.[entry.type];
  const ranked = entry.ranks.filter((r) => r !== null);
  return {
    type: entry.type,
    total: entry.total,
    share: rangeTotal > 0 ? Math.round((entry.total / rangeTotal) * 100) : null,
    deltaPct: d && d.previous > 0 ? Math.round(((d.current - d.previous) / d.previous) * 100) : null,
    // How often it was on the chart at all — the number that tells the reader whether a
    // climb happened over six buckets or over two of them.
    rankedIn: ranked.length,
    bucketCount: entry.ranks.length,
    firstRank: ranked.length ? ranked[0] : null,
    lastRank: ranked.length ? ranked[ranked.length - 1] : null,
    climbed: ranked.length ? ranked[0] - ranked[ranked.length - 1] : 0,
  };
}
