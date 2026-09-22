// BlueWrite — the dashboard's stacked-column chart, as arithmetic.
//
// Kept out of the component for the same reason src/lib/notifications.js is: the
// stacking is pure, and the ways it goes wrong are not visual, so no amount of
// looking at the rendered chart tells you it is wrong.
//
// Three ways, specifically:
//
//   - a band stacked from the wrong base. Accumulating per TYPE instead of per
//     DAY still produces a column of the right total height, and the composition
//     inside it is nonsense. The chart looks fine and reads as fact.
//   - a zero-value band drawn anyway. It paints nothing, but it still takes a
//     hover row and tells the reader a type is present on a day it is not.
//   - a type ranked past the end of the ramp that WRAPS to step 1. It then wears
//     the busiest type's colour, which inverts the single thing the ramp means.
//
// The day order and the type order both come from the server
// (DashboardController::stats), and each type's `counts` is aligned
// index-for-index with `seriesOverTime`. Nothing here re-sorts: a client that
// disagreed with the server about order would paint a different chart from the
// same data, and the legend would stop matching the stack.

/**
 * Ramp steps the stylesheet defines (`--cat-1` .. `--cat-N`, styles.css).
 *
 * A type ranked past the end of the ramp reuses the last step rather than
 * inventing a near-identical hue: with more categories than the ramp can
 * separate, the tail is unreadable at any number of colours, and the legend is
 * what identifies it.
 */
export const CAT_RAMP_STEPS = 14;

/**
 * The ramp step for a zero-based volume rank. Rank 0 is the busiest type and
 * wears step 1.
 *
 * Clamped, never modulo: wrapping would hand a rare type the busiest type's
 * colour. A rank that is not a usable number falls to the last step, which reads
 * as "a tail entry" rather than as an accident at the head of the ramp.
 *
 * The type check is load-bearing and is not `Number(rank)`. EVERY unusable rank
 * has to leave the head of the ramp alone, and `Number(null)` is 0 — so coercing
 * would give a type whose rank went missing the colour of the BUSIEST incident
 * type, which is a false statement about the data rather than a styling slip.
 * Only a real finite number is accepted; everything else is the tail.
 */
export function rampStep(rank) {
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 0) return CAT_RAMP_STEPS;
  return Math.min(Math.trunc(rank) + 1, CAT_RAMP_STEPS);
}

/** The CSS value a legend swatch or a band should wear. */
export function rampColor(rank) {
  return `var(--cat-${rampStep(rank)})`;
}

/**
 * The station's catch-all incident type, matched by name.
 *
 * This is the one place the client looks at a type's LABEL rather than its
 * position, and it is a deliberate exception rather than a convention. A bucket
 * called "Other" is not an incident category the way Theft is; it is the residual
 * of the ones that had no category of their own, and it is read last for the same
 * reason it is written last on a paper form.
 *
 * The failure mode is chosen to be harmless: a station that has renamed the
 * catch-all (the type list is station-configurable) simply does not match, and the
 * chart falls back to pure volume order. Nothing is dropped or mislabelled — the
 * bucket just appears among the others.
 */
const CATCH_ALL_TYPE = /^other\b/i;

const isCatchAll = (entry) => CATCH_ALL_TYPE.test(String(entry?.type ?? '').trim());

/**
 * The order the chart draws in: the server's volume order, with the catch-all
 * bucket moved to the end.
 *
 * Applied to BOTH the stack and the key, from one list, because the two are read
 * against each other — the key's Nth row identifies the stack's Nth band — so an
 * order that differed between them would make the key lie.
 *
 * Note what this does to the ramp: steps are handed out by position here, so the
 * bucket takes the palest step regardless of its count. That is the intended
 * trade — the bucket is a tail value by nature (a handful of odds and ends), and
 * keeping position and colour locked together is worth more than ranking the one
 * entry nobody reads as a category. Returns a new array; the caller's is not
 * reordered.
 */
export function orderForDisplay(byType) {
  const list = Array.isArray(byType) ? byType.filter(Boolean) : [];
  const rest = list.filter((entry) => !isCatchAll(entry));
  if (rest.length === list.length) return list;
  return [...rest, ...list.filter(isCatchAll)];
}

/**
 * The stack, flattened into one entry per NON-EMPTY (day, type) pair.
 *
 * `from` and `to` are counts, not pixels — the caller scales them — and they are
 * that band's own slice of its day's column. The accumulation is across TYPES
 * within a single DAY, which is the part that is easy to get wrong and the
 * reason this function exists.
 *
 * `series` supplies the day order (and, when there is no type breakdown, the
 * values); `byType` supplies the type order and the counts. Both are the
 * server's.
 */
export function stackBands(series, byType) {
  const days = Array.isArray(series) ? series : [];
  const cats = Array.isArray(byType) && byType.length > 0 ? byType : null;
  const count = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  if (!cats) {
    // No per-type data for these days (an older payload, or half a response).
    // One band per day, so the column still shows its height instead of
    // disappearing, and the chart degrades to what it showed before.
    return days
      .map((point, day) => {
        const value = count(point?.count);
        return { day, type: 'all reports', rank: 0, value, from: 0, to: value };
      })
      .filter((band) => band.value > 0);
  }

  const bands = [];
  days.forEach((point, day) => {
    let acc = 0;
    cats.forEach((cat, rank) => {
      const value = count(cat?.counts?.[day]);
      // Zero-height bands are skipped rather than drawn: a 366-day range against
      // 14 types is 5,124 candidates and almost all of them are empty.
      if (value > 0) {
        bands.push({ day, type: cat.type, rank, value, from: acc, to: acc + value });
      }
      acc += value;
    });
  });
  return bands;
}

/**
 * Which day's column a pointer at `x` is over, or null when there is no day to
 * be over.
 *
 * `x` is in PLOT units (the viewBox is the measured pixel width, so one unit is
 * one pixel), and the days divide the inner width between the paddings equally —
 * the same division the columns are drawn with, which is why this takes the pads
 * rather than a column width. Reading a day from the pointer and drawing the
 * columns from two different sums is exactly how a right-click comes to act on
 * the day beside the one under the cursor.
 *
 * Clamped at both ends rather than returning null for the padding: a pointer in
 * the left margin is nearer the first day than no day at all, and the same for
 * the right. Nothing here rounds — `floor` puts the boundary exactly where the
 * drawn column boundary is.
 */
export function dayAtPointer(x, { width, padLeft, padRight, days }) {
  if (!Number.isFinite(x) || !Number.isFinite(width)) return null;
  const count = Number(days);
  if (!Number.isFinite(count) || count < 1) return null;
  const inner = width - padLeft - padRight;
  // Before the plot has been measured there is no column to be over.
  if (!(inner > 0)) return null;
  const idx = Math.floor((x - padLeft) / (inner / count));
  return Math.min(count - 1, Math.max(0, idx));
}

/**
 * The band a pointer at `y` is inside, or null for the plot background.
 *
 * The counterpart of dayAtPointer, and it exists for the same reason: the vertical
 * projection is where a band's slice of its column is decided, and a right-click
 * that assumed "the pointer is on a box because the pointer was on a box a moment
 * ago" offers a type filter for a band the cursor is not on. `y` is in plot units,
 * as `dayAtPointer`'s `x` is, and the projection is the one the columns are drawn
 * with — value 0 on the baseline, `axisMax` at the top of the inner height.
 *
 * Bands within a day do not overlap, so which one wins is only in question where
 * two share an edge — and there the 1px separator is drawn over both.
 *
 * A band whose drawn height is rounded up to the 1px floor (a 366-day range) is
 * thinner here than it looks: the floor is in the renderer, and this answers about
 * the DATA, which is the honest answer to "is a report of this type under the
 * cursor".
 */
export function bandAtPointer(y, bands, { axisMax, innerH, padTop }) {
  const list = Array.isArray(bands) ? bands : [];
  if (!Number.isFinite(y) || !Number.isFinite(axisMax) || !(axisMax > 0) || !(innerH > 0)) return null;
  const toY = (value) => padTop + innerH - (Number(value) / axisMax) * innerH;
  for (const band of list) {
    if (!band) continue;
    const top = toY(band.to);
    const bottom = toY(band.from);
    if (y >= top && y <= bottom) return band;
  }
  return null;
}

/**
 * One day's breakdown as plain text, for the clipboard.
 *
 * Written for somewhere this chart is NOT: a pasted line has lost the range
 * filter, the scope toggle and the incident-type filter above it, so the header
 * has to carry them or the numbers read as the whole register. "4 reports on
 * 2026-09-13 (station-wide)" cannot be mistaken for a station's weekly total the
 * way "4 reports" can.
 *
 * Rows are ordered by count, then by name — most frequent first, which is the
 * question the chart exists to answer, and name as the tiebreak so the same day
 * pastes the same way twice. That is deliberately NOT the chart's own order: the
 * ramp's order exists so the colours stay readable, and a reader pasting this
 * into a report has no ramp in front of them.
 *
 * Returns '' rather than a bare header for a day with nothing in it, so a caller
 * can treat an empty string as "nothing to copy".
 */
export function dayBreakdownText(date, bands, { scope = 'all', type = '' } = {}) {
  const rows = (Array.isArray(bands) ? bands : []).filter((b) => b && b.type && Number(b.value) > 0);
  if (!date || rows.length === 0) return '';
  const total = rows.reduce((n, b) => n + Number(b.value), 0);
  const ordered = [...rows].sort(
    (a, b) => Number(b.value) - Number(a.value) || String(a.type).localeCompare(String(b.type)),
  );
  const whose = scope === 'mine' ? 'my reports only' : 'station-wide';
  const what = type ? `${type} reports` : 'reports';
  return [
    `${total} ${what} on ${date} (${whose})`,
    ...ordered.map((b) => `${b.type}: ${b.value}`),
  ].join('\n');
}

/**
 * The actions the plot offers on right-click, as data.
 *
 * Keys rather than callbacks, so this stays a pure function of the context: the
 * labels, their order, and WHICH of them apply are the user-visible part, and
 * they are the part that breaks silently — an entry that should have been there
 * ("Show only" on the box the officer just right-clicked) or a label that no
 * longer matches what the entry does.
 */
export const CHART_MENU = {
  focusDay: 'focus-day',
  onlyType: 'only-type',
  openReports: 'open-reports',
  copyDay: 'copy-day',
  pinDay: 'pin-day',
};

/**
 * @param {object} ctx
 * @param {string} ctx.date        the day under the pointer (YYYY-MM-DD)
 * @param {string} ctx.type        the incident type under the pointer, or '' when
 *                                 the pointer is on the plot background rather
 *                                 than on a box. The type-specific entry is shown
 *                                 only for a real box: "show only this type" is
 *                                 meaningless over a day's colour stack.
 * @param {number} ctx.total       reports on that day
 * @param {string} ctx.activeType  the incident-type filter in force, if any
 * @param {string} ctx.activeDay   the day the range is already narrowed to, if it
 *                                 is narrowed to one
 * @param {boolean} ctx.pinned     whether that day's card is pinned open
 * @param {string} ctx.scope       'all' (station-wide) or 'mine'
 */
export function chartMenuItems({
  date,
  type = '',
  total = 0,
  activeType = '',
  activeDay = '',
  pinned = false,
  scope = 'all',
} = {}) {
  if (!date) return [];
  const n = Number.isFinite(Number(total)) ? Number(total) : 0;
  const items = [
    {
      key: CHART_MENU.focusDay,
      label: 'Filter the chart to this day',
      hint: `The chart and the figures above it become ${date} alone.`,
      disabled: activeDay === date,
    },
  ];
  if (type) {
    const on = type === activeType;
    items.push({
      key: CHART_MENU.onlyType,
      label: on ? 'Show every incident type' : `Show only ${type}`,
      hint: on ? `Removes the ${type} filter.` : `Charts ${type} across the whole range.`,
    });
  }
  items.push(
    {
      key: CHART_MENU.openReports,
      label: "Open that day's reports",
      // The register has no scope of its own: an officer's own list is already
      // theirs, but for an Admin who has the chart on "My reports" the register
      // would open on the whole station — more than the count this hint promises.
      // Said here rather than acted on, because closing that gap means a new
      // server-side filter, not a menu entry.
      hint:
        `${n} ${n === 1 ? 'report' : 'reports'} on ${date}${type ? ` of type ${type}` : ''}, in All Reports.` +
        (scope === 'mine' ? ' That list is the station\u2019s, not only your own reports.' : ''),
      disabled: n === 0,
    },
    {
      key: CHART_MENU.copyDay,
      label: "Copy the day's breakdown",
      hint: 'The date, the scope, and each incident type with its count, as text.',
    },
    {
      key: CHART_MENU.pinDay,
      label: pinned ? 'Unpin this day' : 'Pin this day open',
      hint: pinned
        ? 'Closes the pinned breakdown card.'
        : 'Keeps the breakdown card on screen while you look elsewhere.',
    },
  );
  return items;
}

/**
 * The coverage note a chart should carry when the payload's day count and its
 * per-type counts disagree, or '' when they line up.
 *
 * The server builds both from the same zero-filled day list, so a mismatch means
 * one of them changed shape without the other — worth saying out loud rather
 * than drawing a chart that is quietly short of a day.
 */
export function alignmentWarning(series, byType) {
  const days = Array.isArray(series) ? series.length : 0;
  const bad = (Array.isArray(byType) ? byType : []).filter(
    (cat) => !Array.isArray(cat?.counts) || cat.counts.length !== days,
  );
  if (days === 0 || bad.length === 0) return '';
  return bad.length === 1
    ? `1 incident type is charted without a full set of days.`
    : `${bad.length} incident types are charted without a full set of days.`;
}
