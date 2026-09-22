// BlueWrite — the status breakdown, as an extruded 3D pie.
//
// Hand-drawn SVG for the same reason the trend chart is (see Dashboard.jsx): the
// station's client PCs have no internet, so a chart library from a CDN would
// silently fail on the one machine that needs it. The geometry is here rather than
// in the component because paths are the part that can be wrong without looking
// wrong — a wall drawn one slice too far, or a sector that overlaps its neighbour,
// still renders as a pie.
//
// THE 3D HERE IS AN AXONOMETRIC EXTRUSION, not a drop shadow and not a duplicated
// copy behind the real one. The top face is an ellipse — a circle seen from above
// at a tilt — and the visible half of its rim is pulled straight down by `depth`
// to give the pie a thickness. Three consequences, each of them load-bearing:
//
//   - ONLY THE FRONT HALF OF THE RIM SHOWS THICKNESS. The back half of the wall is
//     hidden behind the pie's own body; drawing it would paint a rim across the top
//     face. "Front" is where the rim is below the centre, i.e. cos(angle) < 0, with
//     0 at 12 o'clock going clockwise — the same angle convention the whole file
//     uses, because a second convention is how a chart ends up mirrored.
//
//   - THE FRONT BANDS CANNOT OVERLAP, WHICH IS WHY DRAW ORDER DOES NOT MATTER.
//     Each slice's wall hangs beneath its OWN arc, and each angle maps to exactly
//     one x, so the front arcs of different slices occupy disjoint x-ranges. Still
//     asserted in the tests: "it looks right in this order" is a bug that waits for
//     the next slice count.
//
//   - THE SHAPE IS FORESHORTENED, SO IT IS NOT A MEASURING INSTRUMENT ANY MORE. A
//     sector of an ellipse still has area proportional to its angle (an ellipse is
//     an affine image of a circle, and affine maps preserve area ratios), but the
//     WALL adds area to whichever slices face the reader, and the eye reads the
//     tilted face as smaller than it is. That is the price of the request, and it
//     is paid for by the legend and the hover caption printing exact counts and
//     shares, which are the numbers anyone would actually quote.

/**
 * Radii and thickness of the pie, in user units (the viewBox is drawn 1:1 with
 * these, so one unit is one pixel at the size styles.css gives it).
 *
 * The tilt — ry / rx — is 0.5, which reads as a pie on a table seen from roughly
 * 30° above. Much shallower flattens the sectors until their shares stop being
 * comparable at all; much deeper reads as a cylinder rather than a pie.
 *
 * EVERY dimension here is one scale factor, kept in proportion: at 100/50/38 the
 * pie is 200px across against the donut's 124, and the pop and the margin grew with
 * it rather than staying the pixel sizes they were at half this radius. Mixing the
 * two would be a lift that is invisible on a big chart and a margin that clips on a
 * small one. Everything below derives from these, so the drawing, the box and the
 * pop cannot drift out of step.
 */
export const PIE_RX = 100;
export const PIE_RY = 50;
/**
 * The extrusion's thickness. 38 rather than the 29 this shipped at: the wall is
 * the whole of a pie's third dimension, and at 29 it read as a thick sticker —
 * at 38 the rim has enough side to catch the curvature shading the wall wears
 * (see the wall-shade in Dashboard.jsx) and the thing reads as a solid.
 */
export const PIE_DEPTH = 38;

/**
 * How far a slice travels when the pointer picks it, along its own bisector.
 *
 * Enough to read as lifted out of the pie rather than as a rendering wobble, and
 * short of the margin the box holds around the rim — a slice that pops must not be
 * clipped by the viewBox it lives in. Asserted against that margin in the tests.
 */
export const PIE_POP = 14;

/**
 * How much bigger a picked slice grows as well as popping out.
 *
 * The hover scales the wedge about the PIE'S CENTRE (the slice groups live in the
 * translated group, so a CSS scale with its SVG origin takes the centre as its
 * fixed point), which is the slice coming toward the reader rather than swelling
 * in place — the far edge of the slice travels further than the near one, the way
 * a lifted wedge does in a photograph.
 *
 * The margin below is solved against THIS as well as the pop: a scaled front slice
 * reaches (ry + depth) · scale + pop below the centre, and that product is what
 * the box has to hold.
 */
export const PIE_LIFT_SCALE = 1.05;

/**
 * Breathing room inside the viewBox, for the popped-and-scaled slice and the rim.
 *
 * 22 rather than 16 because the hover GROWTH arrived: the pop alone fitted in 16,
 * but the scaled wall bottom lands at (ry + depth) · PIE_LIFT_SCALE + PIE_POP
 * below the centre now, and a lifted wedge clipped by its own viewBox reads as a
 * rendering glitch rather than as a lift.
 */
export const PIE_MARGIN = 22;

export const PIE_BOX = {
  w: 2 * PIE_RX + 2 * PIE_MARGIN,
  h: 2 * PIE_RY + PIE_DEPTH + 2 * PIE_MARGIN,
};

/** Where the top face's centre sits in the viewBox. */
export const PIE_CENTER = { x: PIE_MARGIN + PIE_RX, y: PIE_MARGIN + PIE_RY };

const RAD = Math.PI / 180;

/** Trim a coordinate to two decimals: sub-pixel precision, halved path size. */
const n = (v) => Math.round(v * 100) / 100;

/** A point on the ellipse, relative to its centre, at `t` degrees clockwise from 12. */
function rim(t, rx, ry) {
  return { x: rx * Math.sin(t * RAD), y: -ry * Math.cos(t * RAD) };
}

/**
 * The shortest valid arc commands to sweep the rim from `from` to `to` degrees.
 *
 * Split at 180°, because an SVG arc whose endpoints are diametrically opposite has
 * no single correct rendering: the flags cannot express which of the two halves was
 * meant, and renderers resolve it differently. Any slice can produce exactly that
 * case, so the sweep is emitted in segments no wider than 179°.
 *
 * `dy` drops the whole arc by the pie's thickness, which is how the underside of a
 * wall is drawn from the same function as its top.
 */
function rimArc(from, to, rx, ry, dy = 0) {
  const span = to - from;
  if (span === 0) return '';
  const steps = Math.max(1, Math.ceil(Math.abs(span) / 179));
  const parts = [];
  for (let i = 1; i <= steps; i++) {
    const t = from + (span * i) / steps;
    const p = rim(t, rx, ry);
    // Sweep flag 1 is clockwise in SVG's (y-down) space, which is the direction
    // this file's angles run; a reversed sweep is the arc run backwards.
    parts.push(`A ${rx} ${ry} 0 0 ${span > 0 ? 1 : 0} ${n(p.x)} ${n(p.y + dy)}`);
  }
  return parts.join(' ');
}

/** One slice of the top face: the centre, the radius to the start, and the rim. */
function sectorPath(from, to, rx, ry) {
  const start = rim(from, rx, ry);
  return `M 0 0 L ${n(start.x)} ${n(start.y)} ${rimArc(from, to, rx, ry)} Z`;
}

/**
 * The thickness of a slice, as one closed path per visible arc span.
 *
 * The wall is the band between the rim and the rim dropped by `depth`: out along
 * the top arc, down the slice's end, back along the dropped arc, and up the start.
 * When a slice's rim crosses the front/back line, the arc is cut there and closed
 * with a straight vertical edge, which is what a real cut plane looks like
 * edge-on — and it keeps each slice's wall under its own arc.
 */
function wallPath(spans, rx, ry, depth) {
  return spans
    .map(([from, to]) => {
      const a = rim(from, rx, ry);
      const b = rim(to, rx, ry);
      return (
        `M ${n(a.x)} ${n(a.y)} ` +
        `${rimArc(from, to, rx, ry)} ` +
        `L ${n(b.x)} ${n(b.y + depth)} ` +
        `${rimArc(to, from, rx, ry, depth)} Z`
      );
    })
    .join(' ');
}

/**
 * The arcs of [from, to] that lie in the front half, where the rim faces us.
 *
 * ONE half-turn is enough, and that is a property of the input rather than a
 * shortcut: the wedge list starts at 12 o'clock and covers exactly 360°, so every
 * slice's span lies inside [0, 360] and none of them crosses the top of the pie.
 * (Asserted in the tests, because it is what keeps this a single intersection
 * instead of a wrap-around loop.) Measured in degrees clockwise from 12.
 */
function frontSpans(from, to) {
  const s = Math.max(from, 90);
  const e = Math.min(to, 270);
  return e > s ? [[s, e]] : [];
}

/**
 * The direction a slice should pop, and how far.
 *
 * Along the slice's bisector, in the ellipse's OWN plane and then projected: the
 * outward direction of an ellipse is not the outward direction of its circle, so
 * a bisector pointing straight down the screen would slide a bottom slice rather
 * than lifting it out. Scaling the vertical component by ry/rx and re-normalising
 * gives the direction the slice would travel on the table.
 */
function popVector(midAngle, rx, ry, distance) {
  const rawX = Math.sin(midAngle * RAD);
  const rawY = -Math.cos(midAngle * RAD) * (ry / rx);
  const len = Math.hypot(rawX, rawY) || 1;
  return { dx: (rawX / len) * distance, dy: (rawY / len) * distance };
}

/**
 * The pie, as data.
 *
 * @param {Array<{key: string, label?: string, value: number}>} items slices in
 *        DRAWING order, clockwise from 12 o'clock. Nothing here re-sorts: the
 *        panel's order is the workflow's order (final → submitted → draft), the
 *        same order the legend reads in, and a pie that listed them differently
 *        would make the legend's Nth row identify a different colour.
 * @returns {{total: number, wedges: Array<object>}} each wedge carrying its value,
 *          rounded share, angles, the two paths, whether it has a wall, and the
 *          offset to apply when it is picked. A zero-value slice is DROPPED
 *          rather than drawn: it would be a wedge of no angle taking a hover.
 */
export function pieWedges(items, { rx = PIE_RX, ry = PIE_RY, depth = PIE_DEPTH, pop = PIE_POP } = {}) {
  const list = Array.isArray(items) ? items : [];
  const count = (v) => {
    const num = Number(v);
    return Number.isFinite(num) && num > 0 ? num : 0;
  };
  const total = list.reduce((sum, item) => sum + count(item?.value), 0);
  if (total <= 0) return { total: 0, wedges: [] };

  let acc = 0;
  const wedges = [];
  for (const item of list) {
    const value = count(item?.value);
    if (value === 0) continue;
    const start = acc;
    const end = acc + (value / total) * 360;
    acc = end;
    const spans = frontSpans(start, end);
    const mid = (start + end) / 2;
    wedges.push({
      key: item?.key,
      label: item?.label ?? item?.key,
      value,
      pct: Math.round((value / total) * 100),
      startAngle: start,
      endAngle: end,
      midAngle: mid,
      topPath: sectorPath(start, end, rx, ry),
      // null rather than '' when nothing of this slice faces the reader: the
      // component skips the element entirely, and an empty `d` is an error in
      // some renderers.
      sidePath: spans.length ? wallPath(spans, rx, ry, depth) : null,
      front: spans.length > 0,
      spanFront: spans.reduce((sum, [s, e]) => sum + (e - s), 0),
      pop: popVector(mid, rx, ry, pop),
    });
  }
  return { total, wedges };
}

// ============================================================================
// The slice menu — the same shape as dashboardChart.js's chartMenuItems.
//
// Keys rather than callbacks, so the labels, their order and WHICH of them apply
// stay a pure function of the slice under the pointer: they are the user-visible
// part, and the part that breaks silently — an entry that should have been there,
// or a label that no longer matches what the entry does. Dashboard.jsx dispatches
// by key through the same RowMenu the register's rows and the trend chart use.
// ============================================================================

/** The menu's entries, as stable keys the component switches on. */
export const PIE_MENU = {
  openReports: 'open-reports',
  copyFigures: 'copy-figures',
  pinSlice: 'pin-slice',
};

/**
 * The pie's slice keys to the REGISTER's own status filter values.
 *
 * They are not the same words and pretending they are would produce a filter that
 * matches nothing: the server derives a report's status as `finalized`, and the
 * dashboard payload abbreviates the bucket to `final`. One map, here, so the menu
 * entry cannot send the register a value its select does not contain.
 */
export const REGISTER_STATUS = { final: 'finalized', submitted: 'submitted', draft: 'draft' };

/**
 * The breakdown as plain text, for the clipboard.
 *
 * Same motive as dayBreakdownText: a pasted line has lost the range, the scope and
 * the type filter above it, so the header has to carry them or the numbers read as
 * the whole register. Rows stay in the WORKFLOW's order (final → submitted →
 * draft), deliberately unlike the day's by-count order: this breakdown is read as
 * a pipeline's state, and "most frequent first" would shuffle the stages of it.
 *
 * Returns '' rather than a bare header for an empty breakdown, so a caller can
 * treat an empty string as "nothing to copy".
 */
export function statusBreakdownText(wedges, { total = 0, scope = 'all', type = '' } = {}) {
  const rows = (Array.isArray(wedges) ? wedges : []).filter((w) => w && w.label && Number(w.value) > 0);
  if (rows.length === 0 || !(Number(total) > 0)) return '';
  const whose = scope === 'mine' ? 'my reports only' : 'station-wide';
  const what = type ? `${type} reports` : 'reports';
  return [
    `Status breakdown \u2014 ${total} ${what} (${whose})`,
    ...rows.map((w) => `${w.label}: ${w.value} (${w.pct}%)`),
  ].join('\n');
}

/**
 * The actions one slice offers on right-click, as data.
 *
 * @param {object} ctx
 * @param {string} ctx.label    the slice's name, as the legend prints it
 * @param {string} ctx.status   the slice key (final / submitted / draft)
 * @param {number} ctx.value    reports in that slice
 * @param {number} ctx.pct      its rounded share of the range
 * @param {boolean} ctx.pinned  whether this slice is the pinned readout
 * @param {string} ctx.scope    'all' (station-wide) or 'mine'
 */
export function pieMenuItems({ label, status, value = 0, pct = 0, pinned = false, scope = 'all' } = {}) {
  if (!label || !status) return [];
  const n = Number(value) > 0 ? Number(value) : 0;
  const name = label.toLowerCase();
  return [
    {
      key: PIE_MENU.openReports,
      label: `Open the ${name} reports`,
      // The same caveat the chart's entry carries: the register has no scope of its
      // own, so an Admin reading "My reports" still opens the station's list.
      hint:
        `${n} ${name} ${n === 1 ? 'report' : 'reports'} (${pct}%) in range, in All Reports.` +
        (scope === 'mine' ? ' That list is the station\u2019s, not only your own reports.' : ''),
      // A slice with nothing in it has no register to open, and an entry that
      // navigates to an empty filter is a dead end dressed as an action.
      disabled: n === 0,
    },
    {
      key: PIE_MENU.copyFigures,
      label: 'Copy the breakdown',
      hint: 'Every status with its count and share, as text.',
    },
    {
      key: PIE_MENU.pinSlice,
      label: pinned ? 'Unpin this slice' : 'Pin this slice open',
      hint: pinned
        ? 'Releases the pinned readout.'
        : 'Keeps this slice in the readout while you look elsewhere.',
    },
  ];
}
