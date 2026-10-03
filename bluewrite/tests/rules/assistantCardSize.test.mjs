// BlueWrite — the report head as a flush band, and the assistant's card as ONE
// size. Two layout rules, both asked for in the same breath, and both of the
// kind that fail silently: neither throws, neither changes a control, and a
// reader of the diff sees a couple of declarations rather than the reason.
//
//   1. THE HEAD IS FLUSH — 0 top, 0 left, 0 right. The case bar reaches the
//      page's own edges instead of sitting inside the document gutter, so the
//      title, the case line and the officer's actions open the screen directly
//      under the navy top bar. The failure this guards is the natural one: the
//      page margin is retuned (it is three fluid clamps on `.ir-body`) and the
//      cancellation, written as a second copy of those clamps, stays where it
//      was — so the band drifts a few pixels inwards again and nobody can say
//      why. The head must cancel the gutter's OWN custom properties.
//
//   2. THE CARD IS ONE SIZE. The assistant's card took the column height only
//      until its contents ran out, so the empty state (voice orb + the two
//      actions) was shorter than the state that draws the bondpaper and the
//      block resized under the officer the moment a draft arrived. The bound it
//      could always grow into is now stated as its height as well as its
//      maximum, and the two states fill that box — the letter's viewer taking
//      whatever the review text below it does not need.
//
// Read from the source (like reportTopBar.test.mjs and dashboardLayout.test.mjs)
// rather than measured in a browser: the assertions are about which declaration
// is doing the work, which is exactly what a computed style throws away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Comments go first: a selector is whatever sits between the previous `}` and
 *  the next `{`, so an explanatory comment would be read as part of it. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = strip(readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8'));
const SHARED = strip(readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8'));

/** Every `selector { body }` pair in a sheet, as { selector, body }. Nested
 *  at-rules are skipped as preambles, so the rules INSIDE a media query are
 *  returned with their own plain selectors. */
function rules(sheet) {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }));
}

/** Every rule with this exact selector. A selector restated inside a media
 *  query is a second rule, not a second declaration of the first — which is
 *  why the assertions below read the BASE rule (the first one) rather than
 *  whatever the last breakpoint happened to say. */
function rulesWith(sheet, selector) {
  return rules(sheet).filter((r) => r.selector === selector);
}

/** The base rule with this exact selector. */
function rule(sheet, selector) {
  const found = rulesWith(sheet, selector);
  assert.ok(found.length >= 1, `no \`${selector}\` rule in the sheet`);
  return found[0].body;
}

/** A declaration's value, or undefined. */
function value(body, property) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : undefined;
}

const HEAD_BAND = '.ir-case-panel > .ir-page-head';
// The gradient-blob frame (GradientBlobCard) wraps the whole assistant card,
// so the FRAME is the workspace's grid item and carries the ONE-SIZE bound; the
// card fills it and keeps the inner scroll.
const ACCENT_FRAME = '.ir-form:not(.ir-form--stepped):not(.ir-form--sheet) > .ir-ai-frame';
const ACCENT_CARD = `${ACCENT_FRAME} .ir-card--accent`;
const ACCENT_BODY = `${ACCENT_CARD} > .ir-card-body`;
const ACCENT_PANEL = `${ACCENT_CARD} .ai-panel`;
const ACCENT_SHEET = `${ACCENT_CARD} .ai-inline--sheet`;
const ACCENT_VIEWER = `${ACCENT_SHEET} > .ai-sheet-preview`;

test('the head is flush: it cancels the page gutter on the top, left and right', () => {
  const body = rule(CSS, HEAD_BAND);

  // The gutter it is undoing has to still be named. It is declared on the
  // shell's scroll panel — written as `.main.ir-body`, two classes, so that
  // styles.css's own `.main` rule cannot win the tie and re-pad the panel — and
  // inherited from there; if that ever stops being true, the negative margins
  // below resolve to nothing and the band silently falls back inside the page
  // margin. (Home's band cancels the same two tokens for the same reason, and
  // got this wrong: see homeFit.test.mjs.)
  const page = rule(CSS, '.main.ir-body');
  for (const token of ['--ir-gutter-top', '--ir-gutter-x']) {
    assert.ok(
      value(page, token) !== undefined,
      `.ir-body no longer declares ${token} — the cancellation would resolve to nothing`,
    );
  }

  assert.equal(
    value(body, 'margin-top'),
    'calc(-1 * var(--ir-gutter-top))',
    'the top gutter is no longer cancelled by the gutter\'s own value',
  );
  for (const side of ['margin-left', 'margin-right']) {
    assert.equal(
      value(body, side),
      'calc(-1 * var(--ir-gutter-x))',
      `${side} is no longer cancelled by the gutter's own value`,
    );
  }

  // THE BAND UNDOES THE GUTTER, NEVER THE HEAD'S OWN PADDING — and it never
  // did, which is what lets the sides be flush without putting "Submit Official
  // Record" against the wall. Those four are the officer's clearance from the
  // edge of the window; the band states none of them itself.
  for (const kept of ['padding', 'padding-left', 'padding-right', 'padding-top']) {
    assert.equal(
      value(body, kept),
      undefined,
      `the band sets \`${kept}\`: the gutter is what it cancels, not the head's padding`,
    );
  }
  const headPadding = value(rule(CSS, '.ir-page-head'), 'padding');
  assert.ok(headPadding, 'the head lost its own padding — its contents would sit on the page edge');
  assert.doesNotMatch(headPadding, /^0(\s|$)/, `the head's padding starts at zero: ${headPadding}`);

  // …and the band's GROUND is the artwork now (see .ir-head-backdrop): the head
  // paints no fill of its own, because an opaque gradient here would sit over
  // the backdrop <img> inside it and hide the station's banner for good. The
  // navy lives on the artwork itself.
  assert.equal(
    value(body, 'background'),
    'none',
    'the head paints its own ground over the backdrop artwork',
  );
  const backdrop = rule(CSS, '.ir-head-backdrop');
  assert.match(value(backdrop, 'object-fit') || '', /cover/, 'the backdrop does not fill the band');

  // THE SURFACE, NOT THE BOX. What the station asked off this head was the CARD
  // around it — so the three declarations that made it one must stay off. A
  // radius and a shadow are how a band quietly becomes a card again.
  assert.equal(value(body, 'border'), '0', 'the head is drawing a border again');
  assert.equal(value(body, 'border-radius'), '0', 'the head is drawing a radius again');
  assert.equal(value(body, 'box-shadow'), 'none', 'the head is drawing a shadow again');
});

test('the assistant card states its height, not only its maximum', () => {
  // ONE rule owns the card's box. Two rules setting its height is how the two
  // states drift apart again: one of them wins by source order and nobody meant
  // either to.
  assert.equal(
    rulesWith(CSS, ACCENT_FRAME).length,
    1,
    'the assistant frame draws its box in more than one rule',
  );
  const body = rule(CSS, ACCENT_FRAME);

  const height = value(body, 'height');
  const max = value(body, 'max-height');
  assert.ok(height, 'the card no longer states a height: its two states would differ again');
  assert.ok(max, 'the card lost the maximum that keeps it inside the viewport');
  assert.equal(height, max, `height (${height}) and max-height (${max}) have drifted apart`);

  // The bound is the COLUMN, not a magic pixel count: the card is sized from the
  // viewport, and it stops 20% short of the column's foot. Both terms are scaled
  // — 80% of `calc(100dvh - 2rem)` is `calc(80dvh - 1.6rem)` — so the 1rem the
  // card keeps above itself and the 1rem it stops short of stay proportional.
  const bound = height.match(/^calc\(\s*([\d.]+)dvh\s*-\s*([\d.]+)rem\s*\)$/);
  assert.ok(bound, `the card's height is no longer a dvh-minus-rem bound: ${height}`);
  assert.equal(Number(bound[1]), 80, `the card no longer stops 20% short of the column: ${height}`);
  assert.equal(
    Number(bound[2]),
    (Number(bound[1]) / 100) * 2,
    `the ${bound[1]}dvh is not being applied to the column's own 2rem: ${height}`,
  );

  // Taller content still scrolls rather than spilling: the empty state's box is
  // now taller than its contents, and a long draft's is taller than the box.
  // The scroll lives on the CARD inside the frame (the frame's glass plate must
  // stay open for the blob's travel), so it is read there.
  assert.match(value(rule(CSS, ACCENT_CARD), 'overflow-y') || '', /auto/, 'a taller panel would spill instead of scrolling');
});

test('both states fill the card, and the viewer gives up its own window', () => {
  // The card is a flex column so the body can take the remainder of the fixed
  // box; without this the fixed height would only add blank space at the foot.
  const card = rule(CSS, ACCENT_CARD);
  assert.match(value(card, 'display') || '', /flex/, 'the card is no longer a flex column');
  assert.match(value(card, 'flex-direction') || '', /column/, 'the card is no longer a flex column');

  // The card head is furniture: it keeps its height and the body absorbs the rest.
  assert.equal(value(rule(CSS, `${ACCENT_CARD} > .ir-card-head`), 'flex'), 'none');
  assert.equal(value(rule(CSS, ACCENT_BODY), 'flex'), '1 1 auto');
  assert.equal(value(rule(CSS, ACCENT_PANEL), 'flex'), '1 1 auto');
  assert.equal(value(rule(CSS, ACCENT_SHEET), 'flex'), '1 1 auto');

  // THE STATE WITH SLACK TO GIVE SITS AT THE TOP OF THE BOX: a fixed height
  // plus content at the start is what the two states shared before, and the
  // panel deliberately states no `justify-content` of its own — the draft
  // states fill the box (see the `flex: 1 1 auto` rules above and below), so
  // there is nothing for a distribution to move.

  // THE VIEWER. The base rule sizes it as a fixed window (a clamp), which is
  // right for a panel that is a normal card; inside the fixed box it takes the
  // leftover height instead, or the space under the review row stays empty.
  const baseViewer = rule(SHARED, '.ai-sheet-preview');
  assert.match(
    value(baseViewer, 'height') || '',
    /clamp\(/,
    'the base viewer no longer sizes itself — this override would be dead CSS',
  );

  const viewer = rule(CSS, ACCENT_VIEWER);
  assert.equal(value(viewer, 'flex'), '1 1 auto');
  assert.equal(value(viewer, 'height'), 'auto', 'the viewer still holds its own fixed window inside the fixed card');
  assert.equal(value(viewer, 'max-height'), 'none', 'a maximum here would cap the leftover height the viewer is taking');
  const floor = value(viewer, 'min-height');
  assert.ok(floor, 'the viewer has no floor: a tall review body could squeeze the page to nothing');
  assert.notEqual(floor, '0', 'a floor of zero is no floor');
});
