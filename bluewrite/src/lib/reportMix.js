// BlueWrite — the report mix: every report on this desk, one square each.
//
// NOT RENDERED ANYWHERE RIGHT NOW. The card it was built for (Home ▸ "Reports by
// type") was removed on request, and no component imports this module, so nothing
// here reaches the bundle. It is kept, with its tests, the way LetterGlitch.jsx
// and the dashboard's own faces were kept: the arithmetic is the part that took
// the thinking, it is fully covered by tests/rules/reportMix.test.mjs, and a
// chart is the kind of thing that comes back in another shape. Delete it and
// that file together if that is not wanted.
//
// WHAT IT IS FOR. The register answers "what did I file" one row at a time, and a
// count answers "how many" as a single number. Neither shows the SHAPE of a
// caseload — which kinds of incident this desk actually takes, and how much of
// the work each kind is — which is the thing a station's own blotter makes
// visible by being a physical stack of forms. The mix is that stack drawn as
// squares: one square per report, the squares of one kind grouped together, so
// the eye reads the busiest kind before it reads any word.
//
// SEPARATE FROM THE COMPONENT because the arithmetic is where it goes wrong and
// none of the ways it goes wrong are visible: a row that wears another row's
// colour, a catch-all sorted into the middle, squares that stop at the cap and
// silently drop the remainder — every one of those still draws a tidy grid of
// squares. See tests/rules/reportMix.test.mjs.
//
// COLOUR COMES FROM THE DASHBOARD'S RAMP, not from a second palette. Ranks are
// handed out by position here exactly as the dashboard hands them out
// (lib/dashboardChart.js), so a kind's colour is the same statement on both
// screens: an officer who has seen "Traffic Accident is the deepest blue" on the
// station's dashboard reads the same thing on their own Home.

import { orderForDisplay, rampColor, rampStep } from './dashboardChart.js';

/**
 * The grid's target size: past this many reports a square stops standing for one
 * report (`perSquare` rises until the drawn grid is back around this size).
 *
 * Not a performance limit — a hundred squares is nothing to render. It is the
 * limit of what the picture can still be READ as: past this the squares are too
 * many to take in at a glance, which is the only reason the chart exists, and
 * the answer is to make each square worth more reports rather than to hand the
 * officer a texture. The register fetches at most 100 rows today (Shell's own
 * `per_page=100`), so this is headroom rather than a cap in force.
 *
 * A TARGET, NOT A CEILING ON THE DRAWN GRID. Each kind's run is rounded to its
 * nearest square and a kind with reports always keeps one, so the drawn total
 * can come out a square or so per kind over it — which is why the caption under
 * the chart says what a square stands for rather than claiming a square count.
 */
export const MIX_SQUARE_CAP = 120;

/** The kind a report belongs to, as text. Blank means none was recorded. */
const typeOf = (report) => String(report?.incident_type ?? '').trim();

/**
 * One report list → the rows the chart draws and the key it is read with.
 *
 * Returns `{ total, perSquare, rows }`:
 *   total      — reports counted (the ones with a kind to count)
 *   perSquare  — how many reports one square stands for; 1 until the cap applies
 *   rows       — `{ type, count, step, color, squares }`, busiest first
 *
 * A report with NO recorded kind is counted by nothing and drawn as nothing. It
 * is not an incident type, so a square would be a mark with no fact behind it
 * and a key row would have to invent a name ("Unspecified") the rest of the app
 * never uses — the register itself prints such a row with an empty type cell.
 * Dropping them silently would be worse, so `total` is what the chart DREW, and
 * the caption under it says the same number.
 */
export function reportMix(reports, { cap = MIX_SQUARE_CAP } = {}) {
  const counts = new Map();
  for (const report of Array.isArray(reports) ? reports : []) {
    const type = typeOf(report);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  if (total === 0) return { total: 0, perSquare: 1, rows: [] };

  // ORDER: busiest kind first, and the station's catch-all last.
  //
  // The sort is stable, and the Map above filled in the order the register
  // arrived (incident date, newest first) — so two kinds with the same count
  // stand in the order of their most recent report, which is the order the
  // officer's own list is in. `orderForDisplay` then moves the catch-all to the
  // end for the reason it does on the dashboard: "Other" is the residual of the
  // kinds that had none of their own, and it is read last because it is written
  // last on the paper form.
  const ordered = orderForDisplay(
    [...counts]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  );

  // A cap that is not a usable number falls back to the constant rather than
  // dividing by it: `total / 0` is Infinity and `total / undefined` is NaN, and
  // either one would come out of here as a row of NaN squares.
  const limit = Number.isFinite(cap) && cap >= 1 ? Math.trunc(cap) : MIX_SQUARE_CAP;
  const perSquare = Math.max(1, Math.ceil(total / limit));

  return {
    total,
    perSquare,
    rows: ordered.map((row, rank) => ({
      type: row.type,
      count: row.count,
      // The ramp step, so a caller can draw a swatch without re-deriving the
      // rank, and so the test can assert the two agree.
      step: rampStep(rank),
      color: rampColor(rank),
      // At least one square per kind that HAS reports: rounding a rare kind down
      // to nothing would erase it from the picture while its key row still named
      // it, and the key is read against the grid.
      squares: Math.max(1, Math.round(row.count / perSquare)),
    })),
  };
}
