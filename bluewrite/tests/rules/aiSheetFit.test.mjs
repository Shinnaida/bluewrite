// BlueWrite — HOW BIG THE BONDPAPER IS IN THE AI ASSISTANCE CARD.
//
// The leaf in the assistant's card is 8.5 × 11in of paper, and the card is
// whatever room it has. THE WHOLE LEAF IS FITTED TO THAT ROOM (owner request,
// 2026-10-04): the sheet is one page of paper and it is read as the page it is
// — top to bottom, in the assistant's own card, with no second box around it
// and no scrollbar inside one. Two ways to reconcile paper and card are in the
// record, and the trade between them was made deliberately:
//
//   * SIZE IT TO THE CARD'S WIDTH ALONE — the page fills the column it was
//     asked for and the card keeps a scrollbar to reach the foot of the letter.
//     That is the version this file used to guard. It shows a letterhead, not a
//     page: the officer asked to see the sheet, top to bottom.
//   * SIZE IT TO BOTH AXES — the whole leaf at once, at the largest scale the
//     card can show it. The factor is the SMALLER of the two fits, so width and
//     height both hold; a letter that runs past its leaf still reaches its tail
//     through the frame's own scrollbar, which is the fallback, not the
//     normal case.
//
// The second is only honest while the page is allowed to take the paper the
// letter needs: the stylesheet gives it the leaf's 11in as a FLOOR, never a
// cap, so a long letter GROWS the page and the fit shrinks with it instead of
// the signature block being clipped away. That is part of the contract below.
//
// Three parts of it can part company, and each is asserted here:
//
//   1. WHICH MEASUREMENT — the card's content WIDTH and HEIGHT against the
//      page's own width and its measured natural height;
//   2. HOW OFTEN — whenever the card is resized AND whenever the PAGE changes
//      size (the reveal grows it), from the moment the page is up rather than
//      only after the typing lands, so the size never jumps;
//   3. WHAT THE STYLESHEET DOES WITH IT — one measured zoom on a page drawn at
//      its own 8.5in, inside a frame that draws no box of its own.
//
// Read from source and stylesheet, like aiDraftLetter.test.mjs: there is no DOM
// harness in this project, and what is being guarded is which box is measured
// and which rule reads the result.

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

/** A rule's body, looked up by an exact selector line. */
const rule = (css, selector) => {
  const found = [...css.matchAll(/(^|\n)([^\n{}]*?)\s*\{([^}]*)\}/g)]
    .filter((m) => m[2].trim() === selector);
  assert.ok(found.length > 0, `${selector} is gone from the stylesheet`);
  return found[0][3];
};

/** A declaration's value, or undefined. */
const value = (body, property) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : undefined;
};

/** Every `.ai-sheet-preview… .print-sheet` rule, with its class count. */
const sheetRules = () =>
  (SHEET.match(/\.ai-sheet-preview[^{]*\.print-sheet\s*\{[^}]*\}/g) ?? []).map((r) => {
    const selector = r.slice(0, r.indexOf('{'));
    return { selector, body: r, classes: (selector.match(/\./g) ?? []).length };
  });

test('the WHOLE leaf is fitted to the card — width and height together', () => {
  // The page's own width is the leaf's, and its height is measured rather than
  // assumed: the letter grows it, so it is read back through the zoom in force
  // (`zoom` scales the rect the DOM reports — see `leafZoom`).
  assert.match(SRC, /const byWidth = availW \/ SHEET_PX\.width;/, 'the page is no longer fitted to the card\'s width');
  assert.match(
    SRC,
    /const naturalH = page\s*\n\s*\? Math\.max\(SHEET_PX\.height, Math\.round\(page\.getBoundingClientRect\(\)\.height \/ leafZoom\.current\)\)/,
    'the page\'s own height is no longer measured back through the zoom in force',
  );
  // Quantized to the CSS pixel: the observer re-enters on every box change, and
  // a subpixel figure would let two adjacent factors trade places forever.
  assert.match(SRC, /Math\.round\(page\.getBoundingClientRect\(\)\.height/, 'the measured height can drift on subpixels, so the observer can ping-pong');
  assert.match(SRC, /const byHeight = availH \/ naturalH;/, 'the page is no longer fitted to the card\'s height');
  // The SMALLER of the two: fitting only the larger leaves the page past one
  // edge of the card, which is the scrolling window the owner asked away.
  assert.match(
    SRC,
    /Math\.max\(0\.3, Math\.min\(1, byWidth, byHeight\)\)/,
    'the fit is no longer the smaller of the two axes — one of them can overflow',
  );

  // The card's own padding is not room for the page, on EITHER axis.
  assert.match(SRC, /const padX = parseFloat\(cs\.paddingLeft\) \+ parseFloat\(cs\.paddingRight\);/, 'the card\'s horizontal padding is not allowed for');
  assert.match(SRC, /const padY = parseFloat\(cs\.paddingTop\) \+ parseFloat\(cs\.paddingBottom\);/, 'the card\'s vertical padding is not allowed for');
  assert.match(SRC, /if \(!\(availW > 0\) \|\| !\(availH > 0\)\) return;/, 'a degenerate box is no longer refused');

  // A floor for a degenerate box, and a cap that keeps a wide card from
  // MAGNIFYING the page past its own size: a preview enlarges nothing.
  assert.match(SRC, /const next = Math\.max\(0\.3, Math\.min\(1, byWidth, byHeight\)\)\.toFixed\(4\);/, 'the size lost its floor or its cap');
});

test('the frame draws no box of its own — the card is the one box', () => {
  const body = rule(SHEET, '.ai-sheet-preview');
  // No surface, no edge, no rounding, no reserved gutter: the page's own paper
  // edge and shadow are the only box the officer sees.
  assert.equal(value(body, 'background'), undefined, 'the viewer frame paints a surface again');
  assert.equal(value(body, 'border'), undefined, 'the viewer frame draws an edge again');
  assert.equal(value(body, 'border-radius'), undefined, 'the viewer frame is a rounded box again');
  assert.equal(value(body, 'scrollbar-gutter'), undefined, 'the viewer frame reserves a scrollbar gutter again');
  // A letter that runs past its leaf keeps its tail: the scrollbar is the
  // fallback for that one case, never the normal reading.
  assert.match(body, /overflow-y:\s*auto/, 'the frame no longer reaches the tail of a long letter');
  assert.match(body, /overflow-x:\s*hidden/, 'a page filling the width must not draw a horizontal bar');
  // The room the frame offers is the card's — near the whole window where the
  // panel is its own card — and it is a real viewing window, not a letterhead.
  const height = body.match(/height:\s*clamp\(\s*([\d.]+)rem,\s*([\d.]+)dvh,\s*([\d.]+)rem\s*\)/);
  assert.ok(height, `the frame height is no longer a rem/dvh clamp: ${body}`);
  assert.ok(Number(height[1]) >= 20, `the floor is too short to show the sheet whole: ${height[1]}rem`);
  assert.ok(Number(height[3]) >= 60, `the cap is too short to show the sheet whole: ${height[3]}rem`);
  assert.equal(value(body, 'max-height'), undefined, 'a maximum height is back, so the fit stops owning the height');
  // The fitted (whole-leaf) state this file once banned is the state now: there
  // must be exactly ONE behaviour, so no second state is hiding anywhere.
  assert.equal(
    (SHEET.match(/ai-sheet-preview--fitted/g) ?? []).length,
    0,
    'a second, fitted state is back beside the measured one',
  );
  assert.equal(
    (SRC.match(/ai-sheet-preview--fitted/g) ?? []).length,
    0,
    'a second, fitted state is back in the component',
  );
});

test('one measured zoom, on a page drawn at its own size', () => {
  const rules = sheetRules();
  const measured = rules.filter((r) => r.body.includes('var(--ai-sheet-zoom'));
  assert.equal(measured.length, 1, 'the preview must be scaled by exactly one measured rule');
  assert.match(measured[0].body, /width:\s*8\.5in/, 'the page is not drawn at the paper\'s width');
  // `min(100%, 8.5in)` would make the percentage and the zoom each take a bite
  // of the same scaling, and the page would come out smaller than the card.
  assert.doesNotMatch(measured[0].body, /min\(100%/, 'the width is a percentage again, so the zoom compounds');
  assert.match(measured[0].body, /zoom:\s*var\(--ai-sheet-zoom, 0\.62\)/, 'the fallback size before the measurement is gone');

  // The small-frame media queries used to state their own zooms. They are gone:
  // the measurement covers every width, and a hardcoded zoom would overrule it
  // for the narrow frames where it matters most.
  const hardcoded = rules.filter((r) => !r.body.includes('var(--ai-sheet-zoom'));
  assert.equal(hardcoded.length, 0, `a rule still hardcodes a preview zoom: ${hardcoded.map((r) => r.selector.trim()).join(', ')}`);
});

test('measured on card resize AND on page growth, from the moment the page is up', () => {
  // From the moment it is up, NOT only after the typing lands: the reveal grows
  // the page a line at a time, and each line that adds paper has to shrink the
  // factor in the same frame — or the page silently grows past the card.
  assert.match(
    SRC,
    /if \(!el \|\| !sheeted \|\| typeof ResizeObserver !== 'function'\) return;/,
    'the size is no longer applied until the typing finishes, so the page jumps at the end of the reveal',
  );
  assert.match(SRC, /new ResizeObserver\(sizeLeaf\)/, 'the size no longer follows its boxes');
  assert.match(SRC, /ro\.observe\(el\);/, 'the card is not observed');
  assert.match(
    SRC,
    /if \(el\.firstElementChild\) ro\.observe\(el\.firstElementChild\);/,
    'the page is not observed, so a letter that grows beyond its leaf stops being re-fitted',
  );
  assert.match(SRC, /return \(\) => ro\.disconnect\(\);/, 'the observer is never disconnected');

  // One custom property, written only when it changed: the observer re-enters on
  // every box change, and a redundant write would loop.
  assert.match(SRC, /el\.style\.setProperty\('--ai-sheet-zoom', next\)/, 'the measured size is not handed to the stylesheet');
  assert.match(
    SRC,
    /if \(el\.style\.getPropertyValue\('--ai-sheet-zoom'\) !== next\)/,
    'the size is rewritten on every observation',
  );
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
  // a letter that runs a few lines past its leaf grows the page (the fit shrinks
  // with it, and the frame scrolls to the tail) instead of the signature block
  // being clipped away.
  const preview = sheetRules()[0];
  assert.match(preview.body, /min-height:\s*11in/, 'the previewed leaf is no longer one short bond page');
  assert.doesNotMatch(preview.body, /(^|[^-])height:\s*11in/, 'the previewed leaf is pinned at one page again');
  assert.doesNotMatch(preview.body, /max-height/, 'the previewed leaf can no longer take the paper a long letter needs');
  assert.doesNotMatch(preview.body, /overflow:\s*hidden/, 'the tail of the letter — the signature block — is clipped away again');
});
