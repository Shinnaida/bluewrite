// BlueWrite — THE REPORT, ON A SCREEN OF ITS OWN.
//
// The AI assistance card draws the officer's draft as REAL paper — an 8.5 × 11in
// leaf — inside a column. In that column the page can only ever be a preview of
// a page: it is fitted down to the width or the height the card happens to have
// (see aiSheetFit.test.mjs), so the type is small and the leaf is surrounded by
// the form, the card and the review row. The owner asked for a way to read it as
// the document it is (2026-10-05): a Preview control on the page, opening the
// same sheet full screen with nothing else in the picture.
//
// What can part company here, and what each assertion below is guarding:
//
//   1. WHERE THE CONTROL IS — on the page it enlarges, above the leaf in the
//      assistant's card, and only while that page is up. Not in the card's head
//      (which is chrome for the whole assistant) and not in the review row
//      (which arrives after the typing and sits below a full page of paper).
//   2. WHAT THE SCREEN CONTAINS — the SAME sheet the card draws, from the same
//      host payload and the same live draft, portaled to document.body so it is
//      a screen rather than a box in the card. NO second drawing, no second
//      copy of the facts, and no Print: the only control on the screen is the
//      way out, because "the report and nothing else" is the feature.
//   3. HOW IT IS SIZED — the whole leaf fitted to the screen by ONE measured
//      factor, against the paper's own size, on a page drawn at that size. A
//      percentage here would compound with the zoom, exactly as it would in the
//      card (see aiSheetFit.test.mjs, which guards the same rule next door).
//   4. HOW IT CLOSES — ✕, Escape and a click on the desk around the paper — and
//      Escape peels THIS layer first, so one press never puts away both the
//      screen and the card the officer was reading it from.
//   5. WHAT IT DOES NOT DO — write, accept, apply, or print. Nothing on this
//      screen reaches the report; Accept in the card is still the only action
//      that moves a draft into it.
//   6. HOW BIG THE PAGE IS DRAWN — the SCREEN's page is fitted to it when it
//      opens, and the size ladder beside the way out is how the officer asks
//      for a page they can read (100% is the sheet at the size it prints). The
//      screen writes ONE custom property, and a size the officer picked stands
//      the fit down rather than fighting it. The CARD's page is a fixed 50%
//      with no controls at all (owner request, 2026-10-05), so its row holds
//      Preview and nothing else.
//
// Read from source and stylesheet, like the rest of this directory: there is no
// DOM harness in this project, and what is being guarded is which element draws
// what, which is exactly what a screenshot throws away.

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

const AT = (needle) => {
  const i = SRC.indexOf(needle);
  assert.ok(i >= 0, `${needle} is gone from the panel`);
  return i;
};

/** The card's page frame — one class, since the size it draws is fixed and the
 *  marker that used to join it (`--zoomed`, for a size the officer picked) left
 *  with the card's steppers. */
const FRAME = 'className="ai-sheet-preview"';

/** The Preview control, as written: from its row in the card to the page. */
const CONTROL = SRC.slice(AT('className="ai-sheet-bar"'), AT(FRAME));
/** The fullscreen screen: from the overlay's own class to the portal's target. */
const OVERLAY = SRC.slice(
  AT('className="sheet-fullscreen"'),
  SRC.indexOf('document.body,', AT('className="sheet-fullscreen"')),
);

test('the size ladder belongs to the full-screen frame alone', () => {
  // ONE mount, in the screen's corner. The card's page is a FIXED 50% with no
  // controls (owner request, 2026-10-05), which is why its sheet row holds the
  // Preview button and nothing else — a stepper beside a size nobody can change
  // would be a control that only pretends to size the page.
  const mounts = SRC.match(/<ZoomControls/g) ?? [];
  assert.equal(mounts.length, 1, 'the size controls are drawn somewhere other than the screen alone');
  assert.match(OVERLAY, /<ZoomControls/, 'the full-screen page has lost its size controls');
  assert.doesNotMatch(CONTROL, /ZoomControls|ai-zoom/, 'size controls are back in the card');
  assert.doesNotMatch(SRC, /setSheetZoom|sheetZoom/, 'the card has a size state again');

  // The ladder itself, and the three things it has to be: coarse enough that a
  // press is a size you can see, reaching the paper's OWN size (1) — the stop
  // the officer who found the fitted view too small is actually after — and
  // starting there, because the whole-leaf FIT is the bottom of it. A stop UNDER
  // the fit would be a smaller page with no more of it visible, which is what
  // the overview already is.
  const ladder = SRC.match(/const ZOOM_STEPS = \[([^\]]*)\]/);
  assert.ok(ladder, 'the size ladder is gone');
  const steps = ladder[1].split(',').map((s) => Number(s.trim()));
  assert.deepEqual(steps, [1, 1.25, 1.5, 2, 2.5, 3], 'the ladder changed');
  assert.equal(steps[0], 1, 'the ladder no longer starts at the sheet\'s own size');
  assert.ok(steps.filter((s) => s >= 2).length >= 3, 'there is nothing to read a page from across the room with');

  // The next stop is read from the size ON SCREEN — in the card that is the
  // measured fit (about 0.6 in a column, 0.45 in a narrow one), so the FIRST
  // press lands on the sheet at 100% rather than crawling up from the fit.
  assert.match(SRC, /function stepZoom\(current, direction\)/, 'the stepper no longer reads the size on screen');
  assert.match(SRC, /return ZOOM_STEPS\.find\(\(z\) => z > current \+ 0\.001\)/, 'the ladder is no longer climbed upwards from the page');
  assert.match(SRC, /reverse\(\)\.find\(\(z\) => z < current - 0\.001\)/, 'the ladder is no longer climbed downwards from the page');
  // ...and stepping down past the bottom stop is the way BACK to the overview.
  assert.match(SRC, /\?\? FIT;/, 'the bottom of the ladder no longer leads back to the fitted view');
  assert.match(SRC, /disabled=\{atFit\}/, 'the smaller stepper is offered where there is nothing smaller to show');
  assert.match(OVERLAY, /setScreenZoom\(stepZoom\(fullZoom\.current, direction\)\)/, 'the screen stepped from something other than the size it is drawing');
});

test('the fitted view is the state the screen opens in, and it goes back to it', () => {
  // Fit is the overview the screen opens with — a fresh look at the document
  // rather than a continuation of whatever the officer last did to it.
  assert.match(SRC, /const \[screenZoom, setScreenZoom\] = useState\(FIT\)/, 'the screen no longer opens fitted');
  assert.match(CONTROL, /setScreenZoom\(FIT\);[\s\S]*?setSheetFull\(true\)/, 'the screen no longer opens fitted wherever it was left');

  // ...and the officer can always get back: the Fit button is offered only when
  // there is a size to go back FROM (a control that cannot change anything is
  // not drawn), and it returns the frame to the fit it was measured at.
  assert.match(SRC, /\{!atFit && \(/, 'the way back to Fit is drawn in every state');
  assert.match(SRC, /onFit=\{\(\) => setScreenZoom\(FIT\)\}/, 'the screen cannot return to Fit');
});

test('a size the officer picked stands the fit down — and the screen writes ONE property', () => {
  // One size, written to the one custom property that frame's stylesheet rule
  // reads: a second property would be a page drawn from two numbers, and the
  // fit (which re-measures on every box change) would fight the stepper for the
  // page. The CARD has no such property at all — its page is a fixed 50% stated
  // once in the stylesheet, so nothing here may reach it.
  const screenFit = SRC.slice(AT('if (!el || !sheetFull || typeof ResizeObserver'), AT('}, [sheetFull, screenZoom]);'));
  assert.match(screenFit, /if \(screenZoom !== FIT\) return;/, 'the screen\'s fit no longer stands down for a size the officer picked');
  const screenSet = SRC.slice(AT('if (!el || !sheetFull || screenZoom === FIT) return;'), AT('}, [screenZoom, sheetFull]);'));
  assert.match(screenSet, /el\.style\.setProperty\('--sheet-full-zoom', String\(screenZoom\)\)/, 'the screen\'s own size never reaches the page');
  assert.match(screenSet, /fullZoom\.current = screenZoom;/, 'the screen no longer remembers the size it is drawing');
  assert.doesNotMatch(SRC, /--ai-sheet-zoom/, 'the card\'s page is being sized from JavaScript again');
});

test('the card\'s fixed page is reachable in every direction', () => {
  // The card's frame is the only thing that can reach a page at a fixed size
  // (its own rules are guarded next door in aiSheetFit.test.mjs), and the screen's
  // desk scrolls for the same reason. A state class for "the officer enlarged it"
  // is gone with the steppers — the size never changes now, so the frame always
  // carries both bars.
  assert.equal((SRC.match(/ai-sheet-preview--/g) ?? []).length, 0, 'a card-size state came back');
  const frame = rule(SHEET, '.ai-sheet-preview');
  assert.match(frame, /overflow-x:\s*auto/, 'the card\'s page cannot be scrolled sideways');
  assert.match(frame, /overflow-y:\s*auto/, 'the card\'s page cannot be scrolled to its foot');
  assert.match(rule(SHEET, '.sheet-fullscreen-desk'), /overflow:\s*auto/, 'the screen\'s desk no longer scrolls at all');
});

test('the control sits ON the page it enlarges, and only while that page is up', () => {
  // The card's own page — the leaf — is what it opens. The row is in the sheet
  // branch of the card (`sheeted`), so a panel with no draft has no control to
  // open a page with.
  assert.match(
    SRC,
    /\{sheeted && \(\s*<div className="ai-sheet-bar">/,
    'the Preview control is no longer bound to the page being up',
  );
  assert.ok(
    SRC.indexOf('className="ai-sheet-bar"') < SRC.indexOf(FRAME),
    'the control has drifted below the paper it opens',
  );
  assert.equal(
    (SRC.match(/ai-sheet-preview--/g) ?? []).length,
    0,
    'the card frame carries a size state again',
  );

  // ...AND IT FLOATS (owner request, 2026-10-05): out of the card's flow,
  // anchored to a corner, above the paper, with a surface of its own. It was a
  // ROW above the frame — one control's height of the card's budget, spent on
  // every draft, which on a short panel is a line of the letter the officer
  // cannot read. Anything that puts it back in the flow costs that line again,
  // and anything that drops its surface makes it a word printed on the report.
  const bar = rule(SHEET, '.ai-sheet-bar');
  assert.match(bar, /position:\s*absolute/, 'the Preview row is back in the card\'s flow, taking a line of the page');
  assert.match(bar, /margin:\s*0\b/, 'the floating control still reserves a gap under itself');
  assert.match(bar, /z-index:/, 'the floating control can end up under the paper');
  assert.match(bar, /top:\s*[0-9.]+rem/, 'the chip is not pinned to a corner of the card');
  assert.match(bar, /right:\s*[0-9.]+rem/, 'the chip has no inset from the card\'s right edge');
  // The anchor is the CARD, and it has to be positioned for the chip to sit
  // against it; the frame cannot be the anchor, because a positioned child of a
  // scroller rides away with the letter.
  assert.match(rule(SHEET, '.ai-inline'), /position:\s*relative/, 'the chip has no positioned ancestor to float against');
  // DRAWN FOR THE PAPER: the leaf is white with dark ink in both themes (see
  // dark-theme.css, which does not touch the print sheet), so the chip takes
  // that ink rather than the panel's steel.
  const chip = rule(SHEET, '.ai-sheet-full');
  assert.match(chip, /background:\s*#fff/, 'the floating control has no surface — it reads as printed on the report');
  assert.match(chip, /color:\s*#111/, 'the chip no longer wears the sheet\'s own ink');
  assert.match(chip, /box-shadow:/, 'the chip does not read as floating over the paper');

  // ONE control — the size ladder left with the card's fixed page (see below)
  // — labelled with the word for what it does, wearing the expand mark the rest
  // of the document's glyphs are drawn with.
  const buttons = CONTROL.match(/<button/g) ?? [];
  assert.equal(buttons.length, 1, 'the sheet bar is growing controls of its own');
  assert.match(CONTROL, /className="ai-sheet-full"/, 'the control lost its own class');
  assert.match(CONTROL, /<SheetGlyph paths=\{PREVIEW_GLYPH\} \/>/, 'the control lost its drawing');
  assert.match(CONTROL, />\s*Preview\s*</, 'the control no longer says what it is');
  assert.match(
    CONTROL,
    /className="ai-sheet-full"[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setScreenZoom\(FIT\);[\s\S]*?setSheetFull\(true\);/,
    'the control no longer opens the fullscreen page (fitted, whatever the card was left at)',
  );
});

test('the screen holds the SAME sheet the card draws — same page, same draft', () => {
  // Portaled to the body: a fixed overlay left inside the card would still be
  // the card's descendant on screen — clipped by any ancestor overflow and
  // scrolling with the page behind it.
  assert.match(
    SRC,
    /\{sheetFull && sheet && createPortal\(/,
    'the screen is no longer mounted only with a page to draw and only when asked for',
  );
  assert.match(SRC, /createPortal\([\s\S]*?\n\s*document\.body,/, 'the screen no longer leaves the card tree');
  assert.match(OVERLAY, /role="dialog"/, 'the screen is not a dialog to assistive tech');
  assert.match(OVERLAY, /aria-modal="true"/, 'the screen does not suspend the shell shortcuts behind it');

  // ONE drawing of one document: the shared sheet body, the card's own host
  // payload, and the LIVE draft (the same object the card types into), so a
  // correction in the card's boxes is on this screen too and no fact can differ
  // between the two.
  assert.match(OVERLAY, /className="print-sheet"/, 'the paper is gone from the screen');
  assert.match(OVERLAY, /<ReportSheetBody/, 'the screen draws something other than the sheet the card draws');
  assert.match(OVERLAY, /report=\{sheet\.report\}/, 'the screen no longer draws the report the card was handed');
  assert.match(OVERLAY, /ts=\{sheet\.ts\}/, 'the screen no longer draws the same per-type facts');
  assert.match(OVERLAY, /pending=\{sheetPending\}/, 'the screen no longer draws the live draft');

  // ...and it arrives WHOLE. The typing is the card's own performance; the
  // officer who enlarged the page asked to read the sheet, not to watch the
  // sequence again in a second tree — and a second onRevealComplete would be a
  // second thing claiming to know when the draft had landed.
  assert.match(OVERLAY, /revealPending=\{false\}/, 'the fullscreen page replays the typing sequence');
  assert.doesNotMatch(OVERLAY, /onRevealComplete/, 'the fullscreen page reports the reveal to the card');
});

test('the report is the ONLY thing on the screen', () => {
  // The TWO controls a document viewer has, and no more: the size ladder and the
  // way out. No Print — paper goes through the print portal, which prints the
  // record's own copy rather than an unaccepted draft — and no Close of the card
  // behind it.
  const controls = OVERLAY.match(/<button/g) ?? [];
  assert.equal(controls.length, 1, 'the fullscreen screen grew a control of its own beside the way out');
  assert.match(OVERLAY, /className="sheet-fullscreen-close"/, 'the way out is gone');
  assert.match(OVERLAY, /Close preview/, 'the one control no longer says what it does');
  assert.doesNotMatch(OVERLAY, /window\.print\(\)/, 'the preview screen prints');
  assert.doesNotMatch(OVERLAY, />\s*Print\s*</, 'a Print control came back onto the preview screen');

  // The app is BEHIND it, not part of it: no top bar, no card, no review row
  // are rendered in the overlay — whatever is on the screen is the document.
  assert.doesNotMatch(OVERLAY, /ai-panel|ir-card|app-top-bar|AppTopBar/, 'app chrome is rendered inside the screen');
});

test('nothing on the preview screen reaches the report', () => {
  // Accept is the one action that moves a draft into the report, and it is not
  // on this screen: the overlay offers no apply path and makes no request.
  assert.doesNotMatch(OVERLAY, /acceptDraft|onAccept|onApply|api\(/, 'the preview screen can write');
});

test('the whole leaf is fitted to the screen by ONE measured factor', () => {
  const fit = SRC.slice(AT('const el = sheetFullRef.current;'), AT('}, [sheetFull, screenZoom]);'));
  assert.ok(fit.includes('--sheet-full-zoom'), 'the fullscreen fit is gone');

  // Only while the screen is up, and against the desktop frame's own box: the
  // card's measurement must not be doing this screen's arithmetic.
  assert.match(
    fit,
    /if \(!el \|\| !sheetFull \|\| typeof ResizeObserver !== 'function'\) return;/,
    'the fullscreen fit runs while no screen is up',
  );
  assert.match(fit, /if \(screenZoom !== FIT\) return;/, 'the fitting screen fights a size the officer picked');
  assert.match(fit, /const byWidth = availW \/ SHEET_PX\.width;/, 'the page is no longer fitted to the screen width');
  assert.match(fit, /const naturalH = page\s*\n\s*\? Math\.max\(SHEET_PX\.height/, 'the page no longer takes the paper a long letter needs');
  assert.match(fit, /const byHeight = availH \/ naturalH;/, 'the page is no longer fitted to the screen height');
  // The SMALLER of the two, floored for a degenerate screen and capped at 1: a
  // preview enlarges nothing, it shows the station's paper.
  assert.match(fit, /Math\.max\(0\.3, Math\.min\(1, byWidth, byHeight\)\)\.toFixed\(4\)/, 'the fullscreen fit lost its floor or its cap');

  // Handed to the stylesheet once, and only when it changed — the observer
  // re-enters on every box change, and a redundant write would loop.
  assert.match(fit, /el\.style\.setProperty\('--sheet-full-zoom', next\)/, 'the measured size never reaches the stylesheet');
  assert.match(fit, /if \(el\.style\.getPropertyValue\('--sheet-full-zoom'\) !== next\)/, 'the size is rewritten on every observation');

  // Measured on the screen's resize AND on the page's growth (a letter that
  // needs more paper shrinks the factor instead of being clipped), and the
  // observer is torn down with the screen.
  assert.match(fit, /new ResizeObserver\(sizeLeaf\)/, 'the fullscreen fit no longer follows its boxes');
  assert.match(fit, /ro\.observe\(el\)/, 'the desk is not observed');
  assert.match(fit, /ro\.observe\(el\.firstElementChild\)/, 'the page is not observed');
  assert.match(fit, /return \(\) => ro\.disconnect\(\);/, 'the observer outlives the screen');
});

test('the stylesheet draws the paper at its own size and nothing around it', () => {
  const screen = rule(SHEET, '.sheet-fullscreen');
  assert.match(screen, /position:\s*fixed/, 'the screen is no longer a screen');
  assert.match(screen, /inset:\s*0/, 'the screen no longer covers the window');
  assert.match(screen, /background:\s*var\(--overlay-deep\)/, 'the screen no longer uses the app\'s own scrim');
  // Above the print portal (200), which is the highest thing the app docks: a
  // screen asked for on top of everything, or it is not full screen.
  assert.ok(Number(value(screen, 'z-index')) > 200, 'the screen can be covered by the app it sits on');

  // The desk scrolls, and only for a letter past even the fit's floor.
  const desk = rule(SHEET, '.sheet-fullscreen-desk');
  assert.match(desk, /overflow:\s*auto/, 'a letter that needs more paper than one leaf has no way to be reached');

  // The leaf: the paper's own width, its own floor, and the ONE measured zoom.
  // `width: 8.5in` rather than a percentage, for the reason the card states —
  // the percentage and the zoom would each take a bite of the same scaling.
  const page = rule(SHEET, '.sheet-fullscreen-desk .print-sheet');
  assert.match(page, /width:\s*8\.5in/, 'the fullscreen page is not drawn at the paper\'s width');
  assert.match(page, /min-height:\s*11in/, 'the fullscreen page is not one short bond leaf');
  assert.doesNotMatch(page, /min\(100%/, 'the width is a percentage again, so the zoom compounds');
  assert.match(page, /zoom:\s*var\(--sheet-full-zoom, 0\.62\)/, 'the fullscreen page lost its measured size');

  // The controls read on the scrim and on the paper, because on a narrow screen
  // there is no scrim left beside the leaf — and they hold the corner rather
  // than scrolling away with the letter.
  const corner = rule(SHEET, '.sheet-fullscreen-controls');
  assert.match(corner, /position:\s*fixed/, 'the controls scroll away with the letter');
  assert.match(corner, /z-index/, 'the controls can be covered by the page');
  assert.match(OVERLAY, /className="sheet-fullscreen-controls"/, 'the corner is gone from the screen');
});

test('Escape peels the preview FIRST, and the preview never reaches paper', () => {
  const esc = SRC.slice(
    AT("if (e.key !== 'Escape') return;"),
    SRC.indexOf('}, [panelOpen, sheetFull]);'),
  );
  assert.ok(
    esc.indexOf('if (sheetFull)') >= 0 && esc.indexOf('if (sheetFull)') < esc.indexOf('if (panelOpen)'),
    'one Escape now closes the screen AND the card the officer was reading',
  );

  // The desk around the paper is a way out too — and a click ON the paper is
  // not, nor is one on the controls: the document and the size ladder are the
  // things on that screen that are not a way out. Without the controls' own
  // stopPropagation a press of a stepper bubbles to the dismiss handler and
  // closes the screen it was resizing.
  assert.match(OVERLAY, /onClick=\{\(\) => setSheetFull\(false\)\}/, 'the desk around the paper no longer dismisses');
  const stops = OVERLAY.match(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/g) ?? [];
  assert.equal(stops.length, 2, 'a click on the document or on the controls now dismisses the screen');
  assert.match(
    OVERLAY,
    /className="sheet-fullscreen-controls"[\s\S]*?onClick=\{\(e\) => e\.stopPropagation\(\)\}/,
    'the size controls no longer keep their own presses',
  );

  // A screen, not a sheet of paper: printing is the print portal's job, so the
  // preview is not in the printout at all rather than replacing the record.
  assert.match(
    SHEET,
    /@media print\s*\{[\s\S]*?\.sheet-fullscreen\s*\{\s*display:\s*none\s*!important/,
    'the preview screen can be printed in place of the record',
  );
});
