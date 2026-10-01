// BlueWrite — HOME FITS THE PANEL: the page does not scroll, and the band meets
// the top bar with nothing between them.
//
// WHY THIS FILE EXISTS. Both of the things it guards are CASCADE questions rather
// than drawing questions, and neither was visible in any browser test or render
// test the project had:
//
//   1. THE PANEL'S PADDING. Shell.jsx writes `class="main ir-body"` on one node,
//      and styles.css has a `.main` rule carrying its own padding. Both selectors
//      are ONE class, so the later sheet wins — and in the built bundle
//      incident-report.css lands before styles.css (Vite follows the import
//      graph, and main.jsx imports App.jsx ahead of its stylesheets). So `.main`
//      was really padding the panel 30px all round while the gutter tokens said
//      26.25px and 37.5px. Home's band bleeds up by exactly the gutter, which left
//      a 3.75px strip of page background between the top bar and the band — the
//      line across the screen this file is named after — and at the foot the
//      signature band was pushed 7.5px past the panel's own bottom edge. Nobody
//      reading either sheet can see that; only the ORDER in the built file can.
//
//   2. THE HEIGHT CONTRACT. Home is a dashboard, not a document: it is meant to be
//      taken in at a glance, and a page that scrolls to reach its own signature
//      has already failed at that. So the column is pinned to the panel (`height`,
//      not `min-height`), the body takes the slack, and the DRAFT LIST is the one
//      thing allowed to run over. The chain is asserted link by link below,
//      because a single missing `min-height: 0` anywhere in it silently restores
//      the page scrollbar.
//
// Read from source and stylesheet, like the rest of this directory: the harness
// these render is a page of markup with no shell around it (see
// tests/rules/renderHarness.mjs), which is exactly why neither failure could be
// seen there. The DRAWING is guarded by homeWelcome.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** Source with comments taken out — the prose in this file names every one of
 *  these identifiers and every one of these numbers. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SHEET = code(CSS);

/** One rule, by selector. */
const rule = (selector) => {
  const hit = SHEET.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`));
  assert.ok(hit, `${selector} is gone from the stylesheet`);
  return hit[0];
};

test('the page panel is padded by the GUTTER TOKENS, whichever sheet the bundle puts first', () => {
  // `.main.ir-body` and not `.ir-body`: two classes is what settles the tie with
  // styles.css's own `.main` rule in either order. One class relies on a build
  // order that the import graph, not this file, decides.
  const panel = rule('.main.ir-body');
  assert.match(panel, /--ir-gutter-top:/, 'the panel no longer declares the page gutter');
  assert.match(panel, /--ir-gutter-x:/);
  assert.match(panel, /--ir-gutter-bottom:/);
  assert.match(
    panel,
    /padding:\s*var\(--ir-gutter-top\)\s+var\(--ir-gutter-x\)\s+var\(--ir-gutter-bottom\)/,
    'the padding is no longer the gutter, so Home’s bleed stops cancelling it',
  );

  // AND THE OTHER SHEET STILL HAS ITS `.main` RULE. This is not a fix that removes
  // the problem's cause; it is a fix that out-specifies it, and deleting `.main`'s
  // padding instead would take the padding away from every other screen's panel.
  const other = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const main = other.match(/\.main\s*\{[^}]*\}/);
  assert.ok(main, 'styles.css no longer styles .main at all');
  assert.match(main[0], /padding:/, 'the specificity guard is now guarding nothing');
});

test('Home is pinned to the panel, so the page itself does not scroll', () => {
  const home = rule('.ir-home');
  assert.match(home, /flex-direction:\s*column/, 'the page is no longer a column');
  assert.match(
    home,
    /height:\s*100%/,
    'the column is content-height again, so the panel grows a scrollbar instead of the draft list',
  );
  // ...and NOT the old contract: `min-height: 100%` is a FLOOR, not a height, and
  // a floor is free to be exceeded.
  assert.doesNotMatch(home, /min-height:\s*100%/, 'the column is still a floor rather than a height');
  assert.match(home, /min-height:\s*0/, 'the flex child has no shrink floor to fall to');
});

test('the slack runs down to the draft list, and stops there', () => {
  // The body takes what the band and the signature leave...
  const body = rule('.ir-home-body');
  assert.match(body, /grid-template-rows:\s*minmax\(0,\s*1fr\)/, 'the body no longer takes the slack');
  assert.match(body, /flex:\s*1 1 auto/);
  assert.match(body, /min-height:\s*0/);

  // ...the work column fills the row it is in, with the reminder left at its own
  // height beside it...
  const main = rule('.ir-home-main');
  assert.match(main, /align-self:\s*stretch/, 'the work column no longer fills the row');
  assert.match(main, /display:\s*flex/, 'the work column is not a column to hand the slack down');
  assert.match(main, /min-height:\s*0/);

  const aside = rule('.ir-remember');
  assert.match(aside, /align-self:\s*start/, 'the reminder is stretched to the row height');
  assert.match(aside, /max-height:\s*100%/, 'the reminder may run past the panel');
  assert.match(aside, /overflow-y:\s*auto/);

  // ...the drafts section passes the rest to its list...
  const drafts = rule('.ir-home-drafts');
  assert.match(drafts, /flex:\s*1 1 auto/);
  assert.match(drafts, /min-height:\s*0/);

  // ...and the LIST is the one thing that may run over. Without the `auto` the
  // overflow escapes to the panel and the whole page scrolls again; without the
  // `align-content` the rows stretch down a tall screen instead.
  const list = rule('.ir-home-list');
  assert.match(list, /overflow-y:\s*auto/, 'the draft list no longer scrolls itself');
  assert.match(list, /align-content:\s*start/, 'the rows stretch to fill a tall panel');
  assert.match(list, /flex:\s*1 1 auto/);
  // ONE ROW IS THE FLOOR, not zero: a panel too short for even one draft hands the
  // overflow back to the page (the one case Home is allowed to scroll) rather than
  // squeezing the list out of existence.
  const floor = list.match(/min-height:\s*([0-9.]+)rem/);
  assert.ok(floor, 'the list has no floor, so a short panel can hide it entirely');
  assert.ok(Number(floor[1]) >= 5.5, `the floor is under one row: ${floor[1]}rem`);
});

test('the page compresses with the window — the AIR gives way, never the type', () => {
  // THE SHORTFALL. One value, declared once, that every vertical step on Home is
  // written against: zero on a window tall enough for the whole page, and the
  // number of pixels it falls short by below that. It is what makes the page fit a
  // laptop as well as a workstation without a second design.
  const home = rule('.ir-home');
  const short = home.match(/--ir-home-short:\s*([^;]+)/);
  assert.ok(short, 'Home no longer measures how short the window is');
  assert.match(short[1], /max\(0px,/, 'the shortfall can go negative, which no length may be');
  assert.match(short[1], /100vh/, 'the shortfall is not measured against the window height');

  // AT A TALL WINDOW IT IS ZERO, so the drawn proportions are what ships there.
  // The reference height, read out of `max(0px, <n>px - 100vh)` — the `0px` is
  // the floor, the other is the height at which the shortfall reaches nothing.
  const floorAndThreshold = [...short[1].matchAll(/([0-9.]+)px/g)].map((m) => Number(m[1]));
  assert.equal(floorAndThreshold[0], 0, 'the shortfall does not start at zero');
  const threshold = floorAndThreshold[1];
  assert.ok(threshold >= 800 && threshold <= 900, `the reference height is now ${threshold}px`);

  // THE BAND AND THE ACTION GIVE WAY; so do the gaps and the signature's padding.
  // Each is its drawn length MINUS a share of the shortfall, with a floor under it
  // (a length reduced past nothing is not a length).
  for (const selector of [
    '.ir-home-hero',
    '.ir-home-hero-lead',
    '.ir-home-banner',
    '.ir-home-body',
    '.ir-home-drafts',
    '.ir-home-footer',
    '.ir-draft-row',
    // …and the ADVICE CARD, which is the one block here that is not a row of
    // the page but a card with an inside: its gutter, the band's margins, the
    // gaps between the panels and the panels' own padding all give way, because
    // at a short panel the card is the block that would otherwise put a
    // scrollbar through the station's own sentence.
    '.ir-remember',
    '.ir-remember-title',
    '.ir-remember-list',
    '.ir-remember-list li',
    '.ir-remember-quote',
  ]) {
    const body = rule(selector);
    assert.match(body, /var\(--ir-home-short\)/, `${selector} does not compress at all`);
    assert.match(body, /max\(\s*[0-9.]+rem,/, `${selector} has no floor under its compressed length`);
  }

  // AND THE TYPE DOES NOT. This is the invariant the whole scheme rests on: a
  // dashboard that shrinks its own type to fit is a page that becomes unreadable
  // on exactly the screen where reading it matters most. Anything that sets how
  // large a letter is must not know how short the window is.
  for (const selector of [
    '.ir-home-hero-wordmark',
    '.ir-home-hero-sub',
    '.ir-hero-clock-time',
    '.ir-home-banner-title',
    '.ir-home-banner-note',
    '.ir-draft-no',
    '.ir-draft-type',
    '.ir-remember-title',
  ]) {
    const body = rule(selector);
    assert.match(body, /font-size:/, `${selector} no longer states a size — did the guard move?`);
    // THE SIZE, not the whole rule. A rule may give way in its own AIR while its
    // type stays fixed — the reminder's head band is exactly that: its padding
    // and the margin under it are drawn against the shortfall and its 0.82rem
    // title is not — so the assertion reads the size DECLARATION rather than
    // every length in the block. What it still catches is what it was written
    // for: a size that knows how short the window is.
    const size = body.match(/font-size:\s*([^;]+);/);
    assert.ok(size, `${selector} states no size for a reader to check`);
    assert.doesNotMatch(size[1], /var\(|--ir-home-short/, `${selector} shrinks its own type to fit`);
  }
});

test('the blocks that hold words are never the ones that give way', () => {
  // `overflow: hidden` drops an element's automatic minimum size to zero, so in a
  // flex column that runs out of room these are the elements a browser will
  // happily shrink — clips and all. The band and the action board were both
  // shrunk by this exact page while it was being rebuilt, which is how the rule
  // below came to exist.
  for (const selector of ['.ir-home-hero', '.ir-home-banner', '.ir-home-drafts-head', '.ir-home-footer']) {
    assert.match(rule(selector), /flex:\s*none/, `${selector} can be shrunk, and its content clipped`);
  }
});

test('the list scrolls in the column the register scrolls in, not in a box of its own', () => {
  // The list's scrollbar belongs to the page's own column: no `position: fixed`,
  // no `max-height` in viewport units, and no second scroll container invented
  // around it. Anything of the sort would put the rows in a scroller that does
  // not follow the panel when the window is resized.
  const list = rule('.ir-home-list');
  assert.doesNotMatch(list, /position:\s*(fixed|absolute)/, 'the list is taken out of the page flow');
  assert.doesNotMatch(list, /max-height/, 'the list states a height instead of taking one');
  assert.doesNotMatch(list, /(vh|vw)\)/, 'the list is sized against the window, not the panel');
});
