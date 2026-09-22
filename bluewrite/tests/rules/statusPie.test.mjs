// BlueWrite — the status breakdown's 3D pie, as geometry.
//
// A pie is the one chart whose arithmetic is invisible when it is wrong: sectors of
// the wrong size still make a full circle, a wall drawn on the wrong half still
// reads as thickness, and a slice that pops in the wrong direction still moves.
// None of that throws, and none of it is noticeable by eye at 140px. So the
// shares, the wall's half, the pop's direction and the box's margins are asserted
// here.
//
// The ANGULAR shares are also where the 3D's cost is worth restating: a sector of
// an ellipse still has area proportional to its angle — an ellipse is an affine
// image of a circle, and affine maps preserve area ratios — but the extruded wall
// adds area to whichever slices face the reader, so the drawn shape is not a
// measuring instrument. What the panel measures with is the legend and the hover
// caption, which print exact counts and shares.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PIE_BOX,
  PIE_CENTER,
  PIE_DEPTH,
  PIE_LIFT_SCALE,
  PIE_MARGIN,
  PIE_MENU,
  PIE_POP,
  PIE_RX,
  PIE_RY,
  REGISTER_STATUS,
  pieMenuItems,
  pieWedges,
  statusBreakdownText,
} from '../../src/lib/statusPie.js';

/** The panel's real shape, so the assertions below are about real numbers. */
const STATUS = [
  { key: 'final', label: 'Final', value: 34 },
  { key: 'submitted', label: 'Submitted', value: 27 },
  { key: 'draft', label: 'Draft', value: 47 },
];

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('the slices divide the circle in proportion to their counts', () => {
  const { total, wedges } = pieWedges(STATUS);
  assert.equal(total, 108);
  assert.equal(wedges.length, 3);
  assert.deepEqual(wedges.map((w) => w.pct), [31, 25, 44]);
  // 34/108 of a turn, and so on — in order, from 12 o'clock clockwise.
  close(wedges[0].startAngle, 0);
  close(wedges[0].endAngle, (34 / 108) * 360);
  close(wedges[1].startAngle, wedges[0].endAngle);
  close(wedges[2].endAngle, 360);
  // Contiguous and complete: no slice may start anywhere but where the last ended,
  // or the pie has a gap in it and still looks like a pie.
  for (let i = 1; i < wedges.length; i++) close(wedges[i].startAngle, wedges[i - 1].endAngle);
  const drawn = wedges.reduce((sum, w) => sum + (w.endAngle - w.startAngle), 0);
  close(drawn, 360, 1e-9);
});

test('no slice crosses 12 o’clock, which is what the wall clip relies on', () => {
  // frontSpans intersects ONE half-turn instead of looping over turns. That is only
  // correct while every slice lies inside [0, 360], which holds because the list
  // starts at 12 and covers exactly a turn — so if that ever stops being true, this
  // is the test that says so rather than a wall on the wrong side of the pie.
  for (const values of [[34, 27, 47], [1, 1, 1], [1000, 1], [1], [5, 0, 3]]) {
    const { wedges } = pieWedges(values.map((value, i) => ({ key: `k${i}`, value })));
    close(wedges[0].startAngle, 0);
    close(wedges[wedges.length - 1].endAngle, 360, 1e-9);
    for (const w of wedges) {
      assert.ok(w.startAngle >= 0 && w.endAngle <= 360 + 1e-9, `slice ${w.key} escaped the turn`);
    }
  }
});

test('only the slices facing the reader get a wall', () => {
  // Four equal quarters, which is the clearest case: the quarter from 12 to 3
  // o'clock is entirely behind the pie's own body, and the quarter from 3 to 6 is
  // the first that faces the reader.
  const { wedges } = pieWedges(
    ['a', 'b', 'c', 'd'].map((key) => ({ key, value: 1 })),
  );
  const [a, b, c, d] = wedges;
  close(a.endAngle, 90);
  assert.equal(a.sidePath, null, '0-90 is behind the body: a wall there would paint a rim across the top face');
  assert.equal(a.front, false);
  assert.equal(d.sidePath, null, '270-360 is behind the body too');
  for (const w of [b, c]) {
    assert.equal(w.front, true);
    assert.match(w.sidePath, /^M /);
    assert.match(w.sidePath, / Z$/);
    close(w.spanFront, 90, 1e-9);
  }
  // The visible wall is exactly the front half-turn, no more and no less: this is
  // what stops a wall being drawn under the back of the pie.
  close(wedges.reduce((sum, w) => sum + w.spanFront, 0), 180, 1e-9);
});

test('a wall’s arc is cut at the front/back line, never wrapped further', () => {
  // Two slices split at 3 o'clock: the second one faces the reader from 90 to 270.
  const { wedges } = pieWedges([
    { key: 'back', value: 1 },
    { key: 'front', value: 3 },
  ]);
  close(wedges[0].endAngle, 90);
  assert.equal(wedges[0].sidePath, null);
  close(wedges[1].spanFront, 180, 1e-9);
  // A 180° span cannot be one SVG arc — its endpoints are diametrically opposite,
  // and the flags cannot say which half was meant — so it must be emitted in two.
  const arcs = wedges[1].sidePath.match(/A /g) ?? [];
  assert.ok(arcs.length >= 4, `expected the wall to be cut at 90 and 270 and split in halves, got ${arcs.length} arcs`);
});

test('every path is a closed, finite path', () => {
  const { wedges } = pieWedges(STATUS);
  for (const w of wedges) {
    assert.match(w.topPath, /^M 0 0 L /, 'the top face starts at the centre');
    assert.match(w.topPath, / Z$/);
    for (const d of [w.topPath, w.sidePath]) {
      assert.doesNotMatch(d, /NaN|Infinity|undefined/, `slice ${w.key} produced a broken path`);
    }
  }
  // A slice of more than half the pie spans more than 180° and has to be split.
  const big = pieWedges([{ key: 'x', value: 9 }, { key: 'y', value: 1 }]).wedges[0];
  assert.equal((big.topPath.match(/A /g) ?? []).length, 2, '324° of top face needs two arcs');
});

test('a slice pops along its own bisector, foreshortened like the pie', () => {
  const single = pieWedges([{ key: 'all', value: 1 }]).wedges[0];
  // One slice covers the whole turn; its bisector points at 6 o'clock, which is
  // straight down — not sideways, and not up.
  close(single.midAngle, 180);
  close(single.pop.dx, 0, 1e-9);
  close(single.pop.dy, PIE_POP, 1e-9);

  const [first, , third] = pieWedges(STATUS).wedges;
  // Final's bisector sits in the upper right, so it pops up and to the right, and
  // Draft's — 281.7°, which is past 9 o'clock and before 12 — goes up and to the
  // left. Named cases because "outward" is easy to get inverted, and a slice that
  // pops INTO the pie is the one thing that reads as a glitch.
  assert.ok(first.pop.dx > 0, 'final pops right, not left');
  assert.ok(first.pop.dy < 0, 'final pops upward, out of the pie');
  assert.ok(third.pop.dx < 0 && third.pop.dy < 0, 'draft pops up and to the left');

  for (const w of pieWedges(STATUS).wedges) {
    close(Math.hypot(w.pop.dx, w.pop.dy), PIE_POP, 1e-9, 'every slice travels the same distance');
    // ...and every one of them points AWAY from the centre. Checked against the
    // projected bisector rather than by naming a quadrant: the direction is right
    // when it is parallel to that vector and on the same side of the centre, for
    // any slice count, without this test having to know which way is which.
    const rad = (w.midAngle * Math.PI) / 180;
    const out = { x: Math.sin(rad), y: -Math.cos(rad) * (PIE_RY / PIE_RX) };
    assert.ok(
      w.pop.dx * out.x + w.pop.dy * out.y > 0,
      `${w.key} pops into the pie instead of out of it`,
    );
    close(w.pop.dx * out.y - w.pop.dy * out.x, 0, 1e-9);
  }
  // The projection, not the raw angle: a bisector 45° off vertical would move
  // equally in x and y if this were a circle. On a 0.5 tilt it must move less
  // vertically, or the slice slides along the rim instead of lifting out of it.
  const diag = pieWedges([
    { key: 'a', value: 25 },
    { key: 'b', value: 75 },
  ]).wedges[0];
  close(diag.midAngle, 45);
  assert.ok(Math.abs(diag.pop.dy) < Math.abs(diag.pop.dx), 'the pop must be foreshortened with the pie');
});

test('the box holds the rim AND the popped slice', () => {
  // The one failure mode of a lift: the lifted slice is clipped by the viewBox it
  // lives in, so the margin has to cover the travel in every direction.
  assert.ok(PIE_POP <= PIE_MARGIN, `pop ${PIE_POP} must fit the ${PIE_MARGIN}px margin`);
  close(PIE_BOX.w, 2 * (PIE_RX + PIE_MARGIN));
  close(PIE_BOX.h, 2 * PIE_RY + PIE_DEPTH + 2 * PIE_MARGIN);
  close(PIE_CENTER.x, PIE_MARGIN + PIE_RX);
  close(PIE_CENTER.y, PIE_MARGIN + PIE_RY);
  // The four extremes of the drawing, each against its own edge of the box.
  assert.ok(PIE_CENTER.x - PIE_RX - PIE_POP >= 0, 'a popped left-hand slice would be clipped');
  assert.ok(PIE_CENTER.x + PIE_RX + PIE_POP <= PIE_BOX.w, 'a popped right-hand slice would be clipped');
  assert.ok(PIE_CENTER.y - PIE_RY - PIE_POP >= 0, 'a popped top slice would be clipped');
  assert.ok(PIE_CENTER.y + PIE_RY + PIE_DEPTH + PIE_POP <= PIE_BOX.h, 'the wall or a popped front slice would be clipped');
});

test('a slice with no reports is dropped, not drawn', () => {
  const { total, wedges } = pieWedges([
    { key: 'final', value: 4 },
    { key: 'submitted', value: 0 },
    { key: 'draft', value: 6 },
  ]);
  assert.equal(total, 10);
  assert.deepEqual(wedges.map((w) => w.key), ['final', 'draft'], 'a zero slice would be a wedge of no angle taking a hover');
  close(wedges[1].startAngle, (4 / 10) * 360);
  close(wedges[1].endAngle, 360);
});

test('nothing to report is no pie, and bad numbers are not a crash', () => {
  assert.deepEqual(pieWedges([]), { total: 0, wedges: [] });
  assert.deepEqual(pieWedges(null), { total: 0, wedges: [] });
  assert.deepEqual(pieWedges([{ key: 'a', value: 0 }]), { total: 0, wedges: [] });
  // The same rule the trend chart uses: a value that is not a real positive number
  // counts as nothing, and never as NaN degrees.
  const { total, wedges } = pieWedges([
    { key: 'a', value: null },
    { key: 'b', value: 'nonsense' },
    { key: 'c', value: -5 },
    { key: 'd', value: 2 },
  ]);
  assert.equal(total, 2);
  assert.deepEqual(wedges.map((w) => w.key), ['d']);
  close(wedges[0].endAngle, 360);
  assert.doesNotMatch(wedges[0].topPath, /NaN/);
});

test('the walls add up to the band a front half actually sweeps', () => {
  // The wall is the rim translated straight down by `depth`, so its area is exactly
  // depth times the width of the rim it hangs under — the region between a curve
  // and that curve translated vertically is a shear. Across the front half those
  // widths have to sum to the full diameter, which makes the total independent of
  // how the pie happens to be sliced.
  //
  // This is not a restatement of spanFront: it pins the CONSEQUENCE, and it is what
  // the rendered pixels were checked against at 3x — 5796.69 measured against
  // 5800.00 predicted at the current radius. A wall drawn on the back half, or
  // clipped at the wrong angle, changes this number while still looking like
  // thickness.
  const bandArea = (w) => {
    const s = Math.max(w.startAngle, 90);
    const e = Math.min(w.endAngle, 270);
    if (e <= s) return 0;
    const rad = Math.PI / 180;
    return (PIE_RX * (Math.sin(s * rad) - Math.sin(e * rad))) * PIE_DEPTH;
  };
  const { wedges } = pieWedges(STATUS);
  const total = wedges.reduce((sum, w) => sum + bandArea(w), 0);
  close(total, 2 * PIE_RX * PIE_DEPTH, 1e-9);
  // Per slice too, so one slice's wall cannot be right while another's cancels it.
  // As SHARES of the band rather than in user units, so resizing the pie does not
  // invalidate the test — the proportions are what carry the meaning, and they are
  // the same at any radius. Rendered at 3x these came back 4.09 / 65.72 / 30.19%.
  const band = 2 * PIE_RX * PIE_DEPTH;
  close(bandArea(wedges[0]) / band, 0.040892, 1e-5);
  close(bandArea(wedges[1]) / band, 0.657148, 1e-5);
  close(bandArea(wedges[2]) / band, 0.30196, 1e-5);
  // ...and every slice that has a wall is a slice with front span, and vice versa.
  for (const w of wedges) assert.equal(w.sidePath !== null, bandArea(w) > 0);
});

test('every drawn point is inside the shape that claims to contain it', () => {
  // The one mistake no area check catches: a wall on the BACK half. It adds the
  // same area as the front wall it should have been, so every total above stays
  // correct while the pie renders as a rim painted across its own top face. So the
  // coordinates are read back out of the path strings and held to their bounds:
  // the top face inside the ellipse, the wall in the front half only — never above
  // the centre line, never deeper than `depth` below the front rim.
  // Read command by command, NOT by finding pairs of numbers: an arc carries its
  // radii and three flags before its endpoint, so `A 62 31 0 0 1 30.5 30.5` used to
  // hand back (62, 31) — the ellipse's own radii — as a point, and the first
  // version of this test then failed on its own parser.
  const points = (d) => {
    const out = [];
    for (const [, cmd, args] of d.matchAll(/([MLA])([^MLA]*)/g)) {
      const nums = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      if (cmd === 'A') {
        if (nums.length >= 7) out.push([nums[nums.length - 2], nums[nums.length - 1]]);
      } else {
        for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
      }
    }
    return out;
  };

  for (const values of [[34, 27, 47], [1, 1, 1], [9, 1], [1, 2, 3, 4], [5, 0, 5]]) {
    const { wedges } = pieWedges(values.map((value, i) => ({ key: `k${i}`, value })));
    for (const w of wedges) {
      const top = points(w.topPath);
      assert.deepEqual(top[0], [0, 0], 'the top face starts at the centre');
      for (const [x, y] of top) {
        assert.ok(Math.abs(x) <= PIE_RX + 1e-6, `${w.key} top face outside rx: ${x}`);
        assert.ok(Math.abs(y) <= PIE_RY + 1e-6, `${w.key} top face outside ry: ${y}`);
      }
      if (!w.sidePath) continue;
      for (const [x, y] of points(w.sidePath)) {
        assert.ok(Math.abs(x) <= PIE_RX + 1e-6, `${w.key} wall outside rx: ${x}`);
        assert.ok(y >= -1e-6, `${w.key} wall above the centre line (${y}): that is the back half`);
        assert.ok(y <= PIE_RY + PIE_DEPTH + 1e-6, `${w.key} wall below the extrusion: ${y}`);
      }
    }
  }
});

// ---- The two halves of the drawing, which live in two files --------------------

// Comments out of the way FIRST. One of them in this sheet contains braces, and a
// comment with a brace in it splits a rule in half — which made the first version
// of this matcher report that rules it could plainly see were not declared at all.
const styles = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const component = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');

/**
 * The body of one rule, [] when that rule is not declared at all.
 *
 * Matched on the WHOLE selector text, so a rule that styles two things at once is
 * asked for by the pair it declares rather than by either half of it — and an entry
 * missing from that pair is a missing rule, not a match.
 */
function bodies(selector) {
  const target = selector.replace(/\s+/g, ' ').trim();
  const out = [];
  for (const [, sel, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.replace(/\s+/g, ' ').trim() === target) out.push(body);
  }
  return out;
}

/**
 * Every declaration made under one selector, joined.
 *
 * Joined rather than required to be a single rule because a selector legitimately
 * acquires a second one in the motion query (`.dash-pie__top { transition: … }`),
 * and a test that demanded exactly one would be a test that breaks the next time
 * a transition is added.
 */
const rule = (selector) => {
  const found = bodies(selector);
  assert.ok(found.length >= 1, `${selector} is not declared at all`);
  return found.join('; ');
};

test('every class the pie is drawn with is declared, and nothing else is', () => {
  for (const sel of ['.dash-pie', '.dash-pie__stage', '.dash-pie__top', '.dash-pie__wall', '.dash-pie__caption']) {
    rule(sel);
  }
  // The stage's size is NOT here on purpose: it comes from PIE_BOX, which the pop
  // is solved against. A width repeated in the sheet is a width that can disagree.
  assert.doesNotMatch(rule('.dash-pie__stage'), /width\s*:/);

  // One fill rule per status, and the component's key list is the list they cover.
  const keys = [...component.matchAll(/\{ key: '(\w+)', label: '/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['final', 'submitted', 'draft']);
  for (const key of keys) {
    const fill = rule(`.dash-pie__slice--${key} .dash-pie__top, .dash-pie__slice--${key} .dash-pie__wall`);
    assert.match(fill, /fill:\s*var\(--/);
    assert.equal(component.includes(`dash-pie__slice--${'{'}w.key`), false, 'key must come from the data, not a literal');
  }
  // A class the stylesheet styles but the component never emits is a rule that can
  // only be dead, and the other way round it is a chart drawn with the browser's
  // defaults — which for a path is solid black.
  for (const cls of ['dash-pie__top', 'dash-pie__wall', 'dash-pie__stage', 'dash-pie__caption']) {
    assert.ok(component.includes(cls), `Dashboard.jsx must use ${cls}`);
  }
});

test('the wall is shaded by darkening, never by brightening', () => {
  // MEASURED, and the reason the hover below is a stroke: Blink runs the filter of
  // an SVG element through its SVG filter pipeline, which clamps a brightening to
  // nothing. `filter: brightness(1.16)` on one of these paths — in a rule that is
  // loaded and whose selector matches — computes to `brightness(1)`. Darkening is
  // not affected, which is what the extrusion needs.
  const factor = Number(rule('.dash-pie__wall').match(/brightness\(([\d.]+)\)/)?.[1]);
  assert.ok(Number.isFinite(factor), '.dash-pie__wall must darken the wedge with a brightness filter');
  assert.ok(factor > 0.5 && factor < 0.85, `the wall's shade is ${factor}; below 0.5 it is a hole, above 0.85 it is not an extrusion`);
  // The rendered check, for the record: on the dark panel, --cyan #6FA8FF through
  // brightness(0.66) saturate(1.08) measures #476fad, against #476fad predicted.
  for (const [, value] of styles.matchAll(/brightness\(([\d.]+)\)/g)) {
    assert.ok(Number(value) <= 1, `brightness(${value}) on an SVG element is clamped to a no-op — use a stroke or a fill instead`);
  }
});

test('a hover states the line it is on, and cannot state it on every wedge at once', () => {
  // A stroke: see the clamp above. 1.5px over the 1px seam it replaces, in --paper,
  // which is #1F2733 on the light panel and #E6EAF0 on the dark one.
  const active = rule('.dash-pie__slice.is-active .dash-pie__top');
  assert.match(active, /stroke:\s*var\(--paper\)/);
  assert.doesNotMatch(active, /filter\s*:/);
  const width = Number(active.match(/stroke-width:\s*([\d.]+)/)?.[1]);
  assert.ok(width > 1, `the outline must out-weigh the ${1}px seam it replaces, got ${width}`);

  // THE BUG THIS TEST EXISTS FOR. The pop is the offset to apply WHEN A WEDGE IS
  // PICKED. Applying it to every wedge pulls all three apart at rest and leaves a
  // three-pointed hole of page background around the centre — which is what the
  // first version did, and the geometry tests could not see it because the paths
  // were all correct. Measured at 3x before the fix: 19px of background across the
  // middle of the pie. After it: zero background samples inside the ellipse.
  assert.match(component, /const lifted = focus\?\.key === w\.key;/, 'the lift must be decided per wedge');
  assert.match(
    component,
    /style=\{lifted \? \{ transform: `translate\(\$\{w\.pop\.dx\}px, \$\{w\.pop\.dy\}px\) scale\(\$\{PIE_LIFT_SCALE\}\)` \} : undefined\}/,
    'the pop must be applied only to the lifted wedge, and by a CSS transform rather than an attribute so it can transition',
  );

  // The legend and the wedges share one piece of state, so pointing at either
  // lights the same status — two states would let them disagree.
  const pie = component.slice(component.indexOf('function StatusPie('), component.indexOf('// ---- Hour-of-day'));
  assert.ok(pie.length > 500, 'could not find StatusPie in Dashboard.jsx');
  // One surface, one enter and one leave — and exactly THREE pieces of state: the
  // hovered slice, the pinned slice, and the menu. The pointer's lean is NOT one
  // of them (it writes CSS variables straight onto the stage — asserted below),
  // so a mousemove cannot re-render the wedges.
  assert.equal((pie.match(/setActive\(/g) ?? []).length, 2, 'one enter and one leave on the wedges');
  assert.equal((pie.match(/useState\(/g) ?? []).length, 3, 'the pie keeps exactly three pieces of state');
  // The hover has to show up in BOTH the shape and the text, because the text is the
  // only place the number is written down since the key under the pie was removed.
  assert.match(pie, /const lifted = focus\?\.key === w\.key;/);
  assert.match(pie, /const caption = focus \? \(/);
  // The legend was removed from the panel on request. Guarded because the chart's
  // OWN key still uses .dash-legend, so the class surviving in the sheet proves
  // nothing about the panel — and because re-adding a list under this pie is the
  // one change that could quietly go back to printing the numbers twice.
  assert.ok(!pie.includes('dash-legend'), 'the status panel must not carry a key; the caption is the readout');
  assert.equal(bodies('.dash-status-wide').length, 0, '.dash-status-wide only existed to spread pie and key');
  assert.ok(!pie.includes('dash-pie-wrap'), 'the wrapper only existed to lay the pie out beside a key');
  // What replaced it: a caption that names the hovered wedge, and a label that states
  // all three counts for anyone not using a pointer.
  assert.match(pie, /aria-label=\{`Reports by status: \$\{wedges/);
  assert.match(pie, /<strong>\{focus\.label\}<\/strong>/);
  assert.match(pie, /<strong>\{fmt\.format\(total\)\}<\/strong> reports/);
});

test('the hover is a state and its motion is optional', () => {
  const block = styles.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(block, /\.dash-pie__slice \{ transition: transform/);
  assert.match(block, /\.dash-pie__top \{ transition: stroke/);
  // The outline and the lift are inside the no-preference block ONLY as
  // transitions: a reader who has asked for less motion still gets the state, it
  // just arrives instantly. So neither may be gated on the media query itself.
  for (const decl of ['stroke: var(--paper)', 'stroke-width: 1.5']) {
    assert.ok(styles.split('prefers-reduced-motion').some((part) => part.includes(decl)), 'unreachable');
  }
  for (const [, selector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.includes('dash-pie__slice.is-active')) continue;
    assert.doesNotMatch(body, /transition/, 'the state belongs outside the motion query; only its transition belongs inside');
  }
});

test('the lifted slice grows into its margin as well as popping out of it', () => {
  // The hover scales the wedge about the pie's centre AS WELL AS translating it
  // along its bisector, so the box has to hold the scaled extremes — and none of
  // the margins above sees the scale, because it lives in CSS rather than in the
  // paths. These four lines are the whole difference between a wedge lifting and
  // a wedge lifting into the edge of its own viewBox.
  assert.ok(PIE_LIFT_SCALE >= 1, 'the lift must grow the slice, not shrink it');
  assert.ok(PIE_CENTER.y + (PIE_RY + PIE_DEPTH) * PIE_LIFT_SCALE + PIE_POP <= PIE_BOX.h, 'a grown front slice would be clipped at the bottom');
  assert.ok(PIE_CENTER.x + PIE_RX * PIE_LIFT_SCALE + PIE_POP <= PIE_BOX.w, 'a grown right-hand slice would be clipped');
  assert.ok(PIE_CENTER.y - PIE_RY * PIE_LIFT_SCALE - PIE_POP >= 0, 'a grown top slice would be clipped');
  assert.ok(PIE_CENTER.x - PIE_RX * PIE_LIFT_SCALE - PIE_POP >= 0, 'a grown left-hand slice would be clipped');
});

test('the slice menu speaks the register’s own filter values', () => {
  // The pie's slice keys and the register's status filter are NOT the same words:
  // the server derives `finalized`, the dashboard payload says `final`. The map is
  // what stops the menu sending the register a value its select does not contain.
  assert.deepEqual(REGISTER_STATUS, { final: 'finalized', submitted: 'submitted', draft: 'draft' });

  const items = pieMenuItems({ label: 'Final', status: 'final', value: 34, pct: 31 });
  assert.deepEqual(items.map((i) => i.key), [PIE_MENU.openReports, PIE_MENU.copyFigures, PIE_MENU.pinSlice]);
  assert.equal(items[0].label, 'Open the final reports');
  assert.equal(items[0].disabled, false);
  // An empty slice has no register to open: an entry that navigates to an empty
  // filter is a dead end dressed as an action.
  assert.equal(pieMenuItems({ label: 'Draft', status: 'draft', value: 0, pct: 0 })[0].disabled, true);
  // The pin entry names the way OUT as well as the way in.
  assert.equal(pieMenuItems({ label: 'Draft', status: 'draft', value: 2, pinned: false })[2].label, 'Pin this slice open');
  assert.equal(pieMenuItems({ label: 'Draft', status: 'draft', value: 2, pinned: true })[2].label, 'Unpin this slice');
  // No slice under the pointer, no menu.
  assert.deepEqual(pieMenuItems({}), []);
  // The scope caveat the chart's own entry carries: the register has no scope of
  // its own, so "My reports" still opens the station's list.
  assert.match(pieMenuItems({ label: 'Draft', status: 'draft', value: 2, scope: 'mine' })[0].hint, /station\u2019s/);
});

test('the copied breakdown cannot be read as the whole register', () => {
  const { total, wedges } = pieWedges(STATUS);
  // A pasted line has lost the range, the scope and the type filter above it, so
  // the header has to carry them — the same motive as dayBreakdownText.
  const text = statusBreakdownText(wedges, { total, scope: 'mine', type: 'Theft' });
  assert.equal(
    text,
    [
      'Status breakdown \u2014 108 Theft reports (my reports only)',
      'Final: 34 (31%)',
      'Submitted: 27 (25%)',
      'Draft: 47 (44%)',
    ].join('\n'),
  );
  // The rows stay in the WORKFLOW's order — final, submitted, draft — rather than
  // by count: this breakdown is a pipeline's state, and shuffling its stages by
  // size pastes a different sentence than the panel reads.
  assert.ok(text.indexOf('Final') < text.indexOf('Draft'));
  assert.match(statusBreakdownText(wedges, { total }), /^Status breakdown \u2014 108 reports \(station-wide\)$/m);
  // Nothing to say is '', so the caller can treat it as "nothing to copy".
  assert.equal(statusBreakdownText([], { total: 0 }), '');
  assert.equal(statusBreakdownText(null), '');
});

test('the lean is pointer-driven without a render, and the menu is the register’s', () => {
  const pie = component.slice(component.indexOf('function StatusPie('), component.indexOf('// ---- Hour-of-day'));
  // The tilt writes two custom properties straight onto the stage — no state, so
  // a mousemove cannot re-render the wedges at pointer speed.
  assert.match(pie, /setProperty\('--pie-tilt-x'/);
  assert.match(pie, /setProperty\('--pie-tilt-y'/);
  // …and the reader who asked for less motion gets no lean at all, while the
  // states (lift, dim, outline) stay.
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.dash-pie__stage \{ transform: none; \}/);
  // The menu is RowMenu — the register's own — with this chart's items, dispatched
  // by KEY so the entries stay data (pieMenuItems above).
  assert.ok(pie.includes('<RowMenu'), 'the pie must offer its actions through the register’s own menu');
  assert.match(pie, /pieMenuItems\(\{/);
  assert.match(pie, /runMenuAction\(item\.key, menu\)/);
  assert.match(pie, /onContextMenu=\{\(e\) => \{/);
  // Shift+F10 / the Menu key is the only way to reach a context menu without a
  // pointer, and the chart beside it has the same route.
  assert.match(pie, /shiftKey && e\.key === 'F10'/);
  // What the entries do: navigate with the REGISTER's status values, write the
  // clipboard (reported either way), and toggle the pin.
  assert.match(pie, /REGISTER_STATUS\[ctx\.status\]/);
  assert.match(pie, /navigator\.clipboard\.writeText/);
  assert.match(pie, /setPinned\(\(cur\) => \(cur === ctx\.status \? null : ctx\.status\)\)/);
});
