// BlueWrite — HOW BIG THE BONDPAPER IS IN THE AI ASSISTANCE FIELD.
//
// The leaf in the assistant's card is 8.5 × 11in of paper drawn inside a frame
// that is whatever the card has left. Two ways to reconcile that are in the
// record, and the trade between them is deliberate:
//
//   * SIZE IT TO THE FRAME'S WIDTH (in place) — the page fills the column it was
//     asked for, and the frame keeps its own scrollbar to reach the foot of the
//     letter — the Recorded by / IOC lines and the NOTED BY block — the way any
//     long page is read.
//   * SIZE IT TO THE HEIGHT TOO — the whole leaf at once, print-preview style,
//     with the Noted by block on screen; at about 0.38 of the page's own size,
//     which is a page glanced at rather than read.
//
// The first is only honest while the leaf may take the paper the letter needs.
// A page pinned at one leaf and clipped at its own edge has no foot for the
// frame's scrollbar to reach, and the NOTED BY name — the last line of the
// signature block, under the Recorded by and IOC lines — is the first thing it
// loses. That is part of the contract below, not a detail of the stylesheet.
//
// This file guards the first. Three parts of it can part company:
//
//   1. WHICH MEASUREMENT — the frame's content width against the page's own
//      width, and nothing else;
//   2. HOW OFTEN — whenever the frame is resized, and from the moment the page
//      is up rather than only after the reveal, so the size never jumps;
//   3. WHAT THE STYLESHEET DOES WITH IT — one measured zoom on a page drawn at
//      its own 8.5in, inside a frame that still scrolls.
//
// Read from source and stylesheet, like aiDraftLetter.test.mjs: there is no DOM
// harness in this project, and what is being guarded is which box is measured and
// which rule reads the result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(
  new URL('../../src/components/AiNarrativePanel.jsx', import.meta.url),
  'utf8',
);
const CSS = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(PANEL);
const SHEET = code(CSS);

/** Every `.ai-sheet-preview… .print-sheet` rule, with its class count. */
const sheetRules = () =>
  (SHEET.match(/\.ai-sheet-preview[^{]*\.print-sheet\s*\{[^}]*\}/g) ?? []).map((r) => {
    const selector = r.slice(0, r.indexOf('{'));
    return { selector, body: r, classes: (selector.match(/\./g) ?? []).length };
  });

test('the page is sized to the frame WIDTH, and the frame scrolls to the rest', () => {
  // The width is the whole rule...
  assert.match(SRC, /const scale = availW \/ SHEET_PX\.width;/, 'the page is no longer sized to the frame\'s width');
  // ...and the height is not measured at all: a page fitted to a short frame is
  // the print-preview reading, at about 0.38 of the page's size.
  assert.doesNotMatch(SRC, /availH/, 'the frame\'s height is being measured again');
  assert.doesNotMatch(
    SRC,
    /Math\.min\(\s*availW[^)]*availH/,
    'the page is fitted to both axes again — that is the unreadable version',
  );

  // The frame keeps the scrollbar its base rule gives it (no state hides it),
  // and there is no second, fitted state anywhere in the stylesheet.
  const frame = SHEET.match(/^\.ai-sheet-preview\s*\{[^}]*\}/m);
  assert.ok(frame, '.ai-sheet-preview is gone from the stylesheet');
  assert.match(frame[0], /overflow-y:\s*auto/, 'the frame no longer scrolls, so the foot of the letter is unreachable');
  assert.match(frame[0], /overflow-x:\s*hidden/, 'a page filling the width must not draw a horizontal bar');
  assert.equal(
    (SHEET.match(/ai-sheet-preview--fitted/g) ?? []).length,
    0,
    'the fitted (whole-leaf, no scrolling) state is back',
  );
  assert.equal(
    (SRC.match(/ai-sheet-preview--fitted/g) ?? []).length,
    0,
    'the fitted state is back in the component',
  );
});

test('one measured zoom, on a page drawn at its own size', () => {
  const rules = sheetRules();
  const measured = rules.filter((r) => r.body.includes('var(--ai-sheet-zoom'));
  assert.equal(measured.length, 1, 'the preview must be scaled by exactly one measured rule');
  assert.match(measured[0].body, /width:\s*8\.5in/, 'the page is not drawn at the paper\'s width');
  // `min(100%, 8.5in)` would make the percentage and the zoom each take a bite
  // of the same scaling, and the page would come out smaller than the field.
  assert.doesNotMatch(measured[0].body, /min\(100%/, 'the width is a percentage again, so the zoom compounds');
  assert.match(measured[0].body, /zoom:\s*var\(--ai-sheet-zoom, 0\.62\)/, 'the fallback size before the measurement is gone');

  // The small-frame media queries used to state their own zooms. They are gone:
  // the measurement covers every width, and a hardcoded zoom would overrule it
  // for the narrow frames where it matters most.
  const hardcoded = rules.filter((r) => !r.body.includes('var(--ai-sheet-zoom'));
  assert.equal(hardcoded.length, 0, `a rule still hardcodes a preview zoom: ${hardcoded.map((r) => r.selector.trim()).join(', ')}`);

  // The frame's own padding is not room for the page.
  assert.match(SRC, /const padX = parseFloat\(cs\.paddingLeft\) \+ parseFloat\(cs\.paddingRight\);/, 'the frame\'s horizontal padding is not allowed for');
  assert.match(SRC, /const availW = el\.clientWidth - padX;/, 'the width is not measured off the frame\'s content box');
});

test('measured on resize, and from the moment the page is up', () => {
  // From the moment it is up, NOT only after the typing lands: the officer reads
  // the draft at the size they will go on reading it at, and the reveal is
  // followed on a page that is already its final size.
  assert.match(
    SRC,
    /if \(!el \|\| !sheeted \|\| typeof ResizeObserver !== 'function'\) return;/,
    'the size is no longer applied until the typing finishes, so the page jumps at the end of the reveal',
  );
  assert.match(SRC, /new ResizeObserver\(sizeLeaf\)/, 'the size no longer follows the frame');
  assert.match(SRC, /ro\.observe\(el\)/, 'the frame is not observed');
  assert.match(SRC, /return \(\) => ro\.disconnect\(\);/, 'the observer is never disconnected');

  // One custom property, written only when it changed: the observer re-enters on
  // every frame change, and a redundant write would loop.
  assert.match(SRC, /el\.style\.setProperty\('--ai-sheet-zoom', next\)/, 'the measured size is not handed to the stylesheet');
  assert.match(
    SRC,
    /if \(el\.style\.getPropertyValue\('--ai-sheet-zoom'\) !== next\)/,
    'the size is rewritten on every observation',
  );
  // A floor for a degenerate box, and a cap that keeps a wide frame from
  // MAGNIFYING the page: a preview enlarges nothing.
  assert.match(SRC, /Math\.max\(0\.3, Math\.min\(1, scale\)\)/, 'the size lost its floor or its cap');
});

test('the paper the page is sized against is the paper the sheet prints on', () => {
  // 8.5 × 11in at 96 CSS px to the inch — the leaf's own size, stated beside the
  // rule that draws it. These two must move together, or the page is sized
  // against a page that no longer exists.
  assert.match(SRC, /const SHEET_PX = \{ width: 8\.5 \* 96, height: 11 \* 96 \};/, 'the leaf\'s size is gone');
  const sheet = SHEET.match(/^\.print-sheet\s*\{[^}]*\}/m);
  assert.ok(sheet, '.print-sheet is gone from the stylesheet');
  assert.match(sheet[0], /max-width:\s*8\.5in/, 'the sheet is no longer US Letter wide');
  assert.match(sheet[0], /min-height:\s*11in/, 'the sheet is no longer short bond tall');
  // ...and the preview draws the leaf at exactly that — as a FLOOR, never a cap:
  // a letter that runs a few lines past its leaf keeps its tail (the frame
  // scrolls to it) instead of having the signature block clipped away.
  const preview = sheetRules()[0];
  assert.match(preview.body, /min-height:\s*11in/, 'the previewed leaf is no longer one short bond page');
  assert.doesNotMatch(preview.body, /(^|[^-])height:\s*11in/, 'the previewed leaf is pinned at one page again');
  assert.doesNotMatch(preview.body, /max-height/, 'the previewed leaf can no longer take the paper a long letter needs');
  assert.doesNotMatch(preview.body, /overflow:\s*hidden/, 'the tail of the letter — the signature block — is clipped away again');
});
