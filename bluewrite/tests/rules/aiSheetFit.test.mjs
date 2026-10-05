// BlueWrite — HOW BIG THE BONDPAPER IS IN THE AI ASSISTANCE CARD.
//
// The leaf in the assistant's card is 8.5 × 11in of paper, and the card is
// whatever room it has. THE CARD'S PAGE IS A FLAT 50% (owner request,
// 2026-10-05), and the frame scrolls — both ways — to reach the rest of it.
//
// Two earlier answers are in the record. They are named here because each left
// behind the thing this file now guards against, and a diff that only shows
// `zoom: 0.5` does not say why the measurement went away:
//
//   * SIZE IT TO BOTH AXES — the whole leaf measured to fit the card, at the
//     largest scale the card could take, with a ResizeObserver re-measuring on
//     every box change. That was the rule until 2026-10-05 and it is a fine
//     PREVIEW of a page, which is why it lasted. It is gone because the card is
//     a narrow column in one format and a wide block in another, so the officer
//     met the same page at a different size in each; and once the page also had
//     a stepper ladder, TWO sources of size fought over it — the observer kept
//     re-fitting the page under a size the officer had picked.
//   * SIZE IT TO THE CARD'S WIDTH ALONE — the page fills the column, the frame
//     keeps a scrollbar. Same objection: the size changed with the card.
//
// ONE FIXED SIZE ends both, and that is the whole rule. What it still owes the
// document, and what is asserted below:
//
//   1. THE SIZE — a single declaration, 50% of the paper's own size, in exactly
//      one place, with NO second source of size anywhere in the component: no
//      custom property, no measured factor, no state class.
//   2. THE FRAME — no box of its own (the card is the one box), BOTH scrollbars,
//      and a height that is a real viewing window rather than a letterhead.
//   3. THE PAPER — the same 8.5 × 11in leaf the print portal draws, as a FLOOR
//      and never a cap, so a long letter keeps its signature block.
//   4. THE CENTRING — the page centres, and an overflowing one keeps its START
//      edge reachable, which is a real trap in a scrolling flex row.
//
// Read from source and stylesheet, like aiDraftLetter.test.mjs: there is no DOM
// harness in this project, and what is being guarded is which rule owns the
// size — exactly what a screenshot cannot tell you.

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

test('the card page is drawn at ONE fixed size — 50% of the paper', () => {
  // Exactly one rule states it, and it states a NUMBER: a `var()` would be a
  // second source of size by definition, wherever it was computed.
  const rules = sheetRules();
  assert.equal(rules.length, 1, `the preview page is sized by more than one rule: ${rules.length}`);
  const page = rules[0].body;
  assert.match(page, /width:\s*8\.5in/, 'the page is not drawn at the paper\'s width');
  assert.match(page, /zoom:\s*0\.5/, 'the card\'s page is no longer a flat 50%');
  assert.doesNotMatch(page, /var\(/, 'the size is computed again — one fixed number is the rule');
  // `min(100%, 8.5in)` would make a percentage and the zoom each take a bite of
  // the same scaling, and the page would come out at a fraction of its 50%.
  assert.doesNotMatch(page, /min\(100%/, 'the width is a percentage, so the zoom compounds');

  // NO SECOND SOURCE OF SIZE: the measured factor, its custom property and the
  // ref the observer kept are all gone from the component, and no state class
  // survives either (the file once banned `--fitted`; `--zoomed` followed it out
  // with the steppers, so the whole family is refused by name).
  assert.doesNotMatch(SRC, /--ai-sheet-zoom/, 'a measured size property is back in the card');
  assert.doesNotMatch(SRC, /leafZoom/, 'the card is measuring its page again');
  assert.doesNotMatch(SRC, /sheetZoom/, 'a card-size state is back beside a fixed size');
  assert.equal((SRC.match(/ai-sheet-preview--/g) ?? []).length, 0, 'a second card-size state is back');
  assert.equal((SHEET.match(/ai-sheet-preview--/g) ?? []).length, 0, 'a second card-size state is back in the stylesheet');
  // The one ResizeObserver left in the panel belongs to the FULL SCREEN fit
  // (`sheetFullRef`), and it must not be measuring the card's frame.
  assert.doesNotMatch(
    SRC,
    /ResizeObserver[\s\S]{0,400}sheetViewportRef/,
    'the card frame is observed again, so something is re-fitting its page',
  );
});

test('the frame draws no box of its own — the card is the one box', () => {
  const body = rule(SHEET, '.ai-sheet-preview');
  // No surface, no edge, no rounding, no reserved gutter: the page's own paper
  // edge and shadow are the only box the officer sees.
  assert.equal(value(body, 'background'), undefined, 'the viewer frame paints a surface again');
  assert.equal(value(body, 'border'), undefined, 'the viewer frame draws an edge again');
  assert.equal(value(body, 'border-radius'), undefined, 'the viewer frame is a rounded box again');
  assert.equal(value(body, 'scrollbar-gutter'), undefined, 'the viewer frame reserves a scrollbar gutter again');

  // BOTH BARS: the page's size is fixed and the frame does not own it, so the
  // frame is what reaches the rest of a 408 × 528px leaf in a smaller column.
  assert.match(body, /overflow-y:\s*auto/, 'the frame no longer reaches the foot of the letter');
  assert.match(body, /overflow-x:\s*auto/, 'a page wider than the column cannot be reached sideways');

  // The room the frame offers is the card's — near the whole window where the
  // panel is its own card — and it is a real viewing window, not a letterhead.
  const height = body.match(/height:\s*clamp\(\s*([\d.]+)rem,\s*([\d.]+)dvh,\s*([\d.]+)rem\s*\)/);
  assert.ok(height, `the frame height is no longer a rem/dvh clamp: ${body}`);
  assert.ok(Number(height[1]) >= 20, `the floor is too short to show the sheet: ${height[1]}rem`);
  assert.ok(Number(height[3]) >= 60, `the cap is too short to show the sheet: ${height[3]}rem`);
  assert.equal(value(body, 'max-height'), undefined, 'a maximum height is back, so the frame stops owning its window');
});

test('the frame centres the page WITHOUT putting its start edge out of reach', () => {
  // The trap this guards: a flex row that centres overflowing content leaves the
  // START of that content unscrollable — the left-hand column of a 50% leaf in a
  // narrower column could not be reached at all. Centring therefore belongs to
  // the PAPER's auto margins, which collapse to zero when there is no room.
  const frame = rule(SHEET, '.ai-sheet-preview');
  assert.equal(value(frame, 'justify-content'), 'flex-start', 'the frame centres overflowing content, so its start edge is unreachable');
  const page = sheetRules()[0].body;
  assert.match(page, /margin:\s*0 auto/, 'the page no longer centres itself, so it sits flush left on a wide card');
});

test('the paper the page is sized against is the paper the sheet prints on', () => {
  // 8.5 × 11in: the leaf's own size, stated on `.print-sheet` — the page the
  // print portal and the AI panel's own previews all draw.
  const sheet = SHEET.match(/^\.print-sheet\s*\{[^}]*\}/m);
  assert.ok(sheet, '.print-sheet is gone from the stylesheet');
  assert.match(sheet[0], /max-width:\s*8\.5in/, 'the sheet is no longer US Letter wide');
  assert.match(sheet[0], /min-height:\s*11in/, 'the sheet is no longer short bond tall');

  // ...and the card draws that leaf at its own width, as a FLOOR and never a
  // cap: a letter that runs a few lines past its leaf grows the page (the frame
  // scrolls to the tail) instead of the signature block being clipped away.
  const preview = sheetRules()[0];
  assert.match(preview.body, /min-height:\s*11in/, 'the previewed leaf is no longer one short bond page');
  assert.doesNotMatch(preview.body, /(^|[^-])height:\s*11in/, 'the previewed leaf is pinned at one page again');
  assert.doesNotMatch(preview.body, /max-height/, 'the previewed leaf can no longer take the paper a long letter needs');
  assert.doesNotMatch(preview.body, /overflow:\s*hidden/, 'the tail of the letter — the signature block — is clipped away again');
});
