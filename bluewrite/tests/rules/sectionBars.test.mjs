// BlueWrite — the five section bars, and the numbering that makes them a RUN.
//
// A section bar is not decoration: it is the numbered marker of one part of an
// official document, and there are five of them down the Write Report screen.
// Two failures here are silent — neither throws, neither moves a control, and a
// reader of the diff sees a couple of declarations rather than the reason.
//
//   1. THE NUMBERS DO NOT LINE UP. The numeral was bare text set at the title's
//      own size, so "I." and "III." measured different widths and the five
//      titles began at as many x positions as there are sections. Markers that
//      do not line up read as unrelated headings rather than as I–V of one
//      document. The numeral is a fixed-width plate now, and the ordinal's dot
//      belongs to the sheet, where the box is gone and cannot separate it.
//
//   2. THE POSITION IS INVISIBLE. `--current` is how the editor says which card
//      the officer's step owns, and it reached assistive tech only: five
//      identical navy bars, with the rail saying "Step 4" and nothing in the
//      body agreeing. The current card wears the app's own "you are here" — the
//      raised navy plate and the amber rule the top bar's active tab has always
//      worn — so the two positions on one screen are the same two words.
//
// Read from the source (like sectionStatus.test.mjs and reportTopBar.test.mjs):
// both rules are about WHICH declaration is doing the work, which is exactly
// what a computed style throws away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out — a comment explaining a rule must not read
 *  as the rule itself, and one of the assertions below is an indexOf. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

// Comments go first: a selector is whatever sits between the previous `}` and the
// next `{`, so an explanatory comment would be read as part of it — and both
// sheets are read through `rule()` below.
const SHEET = strip(CSS);

/** Every `selector { body }` pair in a sheet, as { selector, body }. */
function rules(sheet) {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }));
}

/** The base rule with this exact selector — the first one, so a restatement
 *  inside a media query or a sheet override never answers for it. */
function rule(sheet, selector) {
  const found = rules(sheet).filter((r) => r.selector === selector);
  assert.ok(found.length >= 1, `no \`${selector}\` rule in the sheet`);
  return found[0].body;
}

/** A declaration's value, or undefined. */
function value(body, property) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : undefined;
}

test('every section number is a plate of one width, so the titles share a spine', () => {
  const src = code(REPORTS);

  // The marker's order on the bar: the seal amber dot opens it, the number
  // follows, the title follows that. The plate only works as a spine if the
  // number is in the same slot on every bar.
  const dotAt = src.indexOf('ir-card-dot');
  const numAt = src.indexOf('className="ir-card-num"');
  const titleAt = src.indexOf('{title && <span>');
  assert.ok(dotAt !== -1 && numAt !== -1 && titleAt !== -1, 'a part of the bar is gone');
  assert.ok(dotAt < numAt && numAt < titleAt, 'the bar no longer runs dot, number, title');

  // The numeral is passed bare. The dot that used to follow it in the markup
  // would sit inside the box and break the centring — the BOX is what separates
  // the number from the title now, and the sheet restores the dot (below).
  assert.match(
    src,
    /\{num && <span className="ir-card-num">\{num\}<\/span>\}/,
    'the numeral is no longer the bare number in its own box',
  );

  const plate = rule(SHEET, '.ir-card-head .ir-card-num');

  // A FIXED BOX, and it may not be squeezed: a long title must wrap or shrink
  // the bar, never the marker every other title lines up against.
  assert.equal(value(plate, 'flex'), 'none', 'the plate can be squeezed by a long title');
  const width = value(plate, 'width');
  assert.ok(width && !/auto|max-content|fit-content/.test(width), `the plate has no fixed width: ${width}`);
  assert.ok(value(plate, 'height'), 'the plate lost its height, so bars of one run differ');
  assert.match(value(plate, 'display') || '', /grid/, 'the numeral is not laid out in its box');
  assert.match(value(plate, 'place-items') || '', /center/, 'the numeral is not centred in its box');

  // The ring is a hairline BOUNDARY, never a second fill: no plate background,
  // and the numeral keeps the bar's own ink — a step lighter by weight, not by
  // a faded white (0.72 alpha measured 3.4:1 on this fill, under AA).
  assert.equal(value(plate, 'background'), undefined, 'the plate grew a fill: it is a marker, not a chip');
  assert.match(value(plate, 'box-shadow') || '', /inset/, 'the plate lost the ring that draws its edge');
  assert.match(value(plate, 'box-shadow') || '', /rgba\(255,\s*255,\s*255/, 'the ring is no longer the bar white');
  assert.equal(value(plate, 'color'), 'var(--on-accent)', 'the numeral left the bar ink');

  // ON PAPER THE PLATE GOES — the box, the ring and the fixed width — because a
  // page numbers its sections with a bare ordinal.
  const sheetPlate = rule(SHEET, '.ir-form--sheet .ir-card-head .ir-card-num');
  assert.equal(value(sheetPlate, 'box-shadow'), 'none', 'the ring prints: a page has no boxes on its numbers');
  assert.equal(value(sheetPlate, 'width'), 'auto', 'the plate keeps its fixed width on paper');
  assert.match(value(sheetPlate, 'display') || '', /inline/, 'the numeral is still a box on paper');

  // …and the ordinal's DOT comes back with it. On screen the plate is the
  // separator; on paper the heading is one line of prose again, so "I" needs
  // the dot it has always been printed with.
  const dot = rule(SHEET, '.ir-form--sheet .ir-card-head .ir-card-num::after');
  assert.equal(value(dot, 'content'), "'.'", 'the printed ordinal lost its dot');
});

test('the section the officer is on wears the app\u2019s own "you are here"', () => {
  // THE SAME PAIR THE TOP BAR USES for its active tab: the raised navy plate and
  // the amber rule. Asserted against that rule rather than against two literals,
  // so the two positions on one screen cannot drift into two conventions.
  const tab = rule(SHEET, ".ir-nav-link[aria-current='page']");
  assert.equal(value(tab, 'background'), 'var(--ir-navy-hi)', 'the active tab no longer uses the raised navy');
  assert.equal(value(tab, 'border-bottom-color'), 'var(--ir-bar-accent)', 'the active tab lost its amber rule');

  // The card wears the amber rule down its LEFT EDGE, inset, so it brackets the
  // whole section instead of cutting across the bar — and costs the layout
  // nothing (a real border would move every field in the card).
  const card = rule(SHEET, '.ir-card--current');
  const edge = value(card, 'box-shadow') || '';
  assert.match(edge, /inset/, 'the current card\u2019s rule is no longer inset: it moves the card\u2019s fields');
  assert.match(edge, /var\(--ir-bar-accent\)/, 'the amber edge is gone: the current card is unmarked again');
  assert.match(edge, /var\(--shadow-xs\)/, 'the current card gave up the lift every other card has');

  // The BAR is the direct child, never a descendant: a RepeatableGroup draws its
  // own header INSIDE a current card, and those may not be repainted with it.
  const bar = rule(SHEET, '.ir-card--current > .ir-card-head');
  assert.equal(value(bar, 'background'), 'var(--ir-navy-hi)', 'the current bar is the same navy as the rest again');
  assert.equal(
    value(bar, 'border-bottom-color'),
    'var(--ir-navy-hi)',
    'the current bar keeps a hairline in the wrong fill',
  );

  // NOTHING OF IT PRINTS. The sheet clears a card's shadow (which is what the
  // edge IS) and every section bar's fill, so the marking cannot reach paper —
  // a page has no current position, you are wherever you are reading.
  const sheetCard = rule(SHEET, '.ir-form--sheet .ir-card');
  assert.equal(value(sheetCard, 'box-shadow'), 'none', 'the amber edge reaches the printed page');
  assert.equal(value(sheetCard, 'background'), 'none', 'a printed card kept a fill');
  assert.equal(
    value(rule(SHEET, '.ir-form--sheet .ir-card-head'), 'background'),
    'none',
    'a printed section bar kept a fill',
  );
});

test('the state chip is a stamp in the bar\u2019s own type, and the label is not', () => {
  // The chip DEPARTS from the shared slot it sits in: the slot sets sentence
  // case for the descriptive label, and a state stamped on a bar belongs in the
  // bar's own micro-caps and tracking.
  const slot = rule(SHEET, '.ir-card-context, .ir-card-status');
  assert.equal(
    value(slot, 'text-transform'),
    'none',
    'the descriptive label lost the sentence case that keeps it from reading as a second title',
  );

  const chip = rule(SHEET, '.ir-card-status');
  assert.equal(value(chip, 'text-transform'), 'uppercase', 'the chip is running text beside a caps title again');
  assert.match(value(chip, 'letter-spacing') || '', /^0\.0[5-9]em$/, 'the chip lost the bar\u2019s tracking');
  assert.equal(value(chip, 'font-weight'), '700', 'the chip is no longer set at the bar\u2019s weight');

  // The one state that gets a plate, and it stays a PLATE: white at low alpha,
  // never the palette green (under AA on this fill in both themes). The words
  // themselves still come from SECTION_STATE — see sectionStatus.test.mjs.
  const done = rule(SHEET, '.ir-card-status--done');
  assert.match(value(done, 'background') || '', /rgba\(255,\s*255,\s*255/, 'the complete chip left the bar white');
  assert.match(value(done, 'box-shadow') || '', /inset/, 'the complete chip lost its ring');
  assert.doesNotMatch(done, /--green/, 'the complete chip took the palette green: it is under AA on this fill');
});
