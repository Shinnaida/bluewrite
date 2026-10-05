// BlueWrite — A DRAFT UNDER REVIEW IS A PAGE, IN THE AI ASSISTANCE FIELD.
//
// The bondpaper is drawn in the assistant's own card, and it used to be the
// TRANSIENT `sheetDraft` payload that put it there — the three-part proposal set
// when a request lands and cleared by "Edit the draft" or by closing the card.
// So the officer's own letter could leave the AI assistance field while they were
// still working on it: corrected boxes and no page, or nothing at all for a draft
// restored from the tab's store after a reload. The page belongs to the DRAFT.
//
// Four things about that can part company, and each is asserted here:
//
//   1. WHAT PUTS IT UP — the draft (and the host's payload), not a remembered
//      request;
//   2. WHAT IT SHOWS — the values of the LIVE draft, so an edit made in a box
//      under the page is on the page by the next render;
//   3. WHAT IT DOES NOT DO — never put the page away (the boxes are added
//      under it), and never replay the typing for a draft restored in this tab;
//   4. WHAT IT IS MEASURED AGAINST — nothing here; see aiSheetFit.test.mjs for
//      the fit that sizes the leaf to the frame.
//
// Read from source and stylesheet, like aiSheetFit.test.mjs: there is no DOM
// harness in this project, and what is being guarded is which state draws the
// letter and which values are painted into it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(
  new URL('../../src/components/AiNarrativePanel.jsx', import.meta.url),
  'utf8',
);
const SHEET = readFileSync(new URL('../../src/components/ReportSheetBody.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(PANEL);
const LEAF = code(SHEET);
const STYLE = code(CSS);

/** The body of `function name(...) { … }`, up to the next top-level function. */
const bodyOf = (src, marker) => {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `${marker} is gone`);
  return src.slice(at, src.indexOf('\n  }', at + marker.length));
};

test('the letter is drawn for the draft, not for one remembered request', () => {
  // The draft AND the host's own payload: without `sheet` (the report, the
  // letterhead, the recording officer) there is no page to draw at all.
  assert.match(SRC, /const sheeted = !!draft && !!sheet;/, 'the page is no longer tied to the draft being reviewed');
  // ...and the page render is gated on it rather than on a stored proposal.
  assert.match(SRC, /\{sheeted && \(\s*<div/, 'the bondpaper is not drawn from the draft');
  // A second copy of the proposal beside the live draft is the defect this
  // guards: it is what let the two disagree, and what let the page disappear.
  assert.doesNotMatch(SRC, /useState\(null\);\s*\n\s*const \[[a-zA-Z]+Open/, 'the boxes state must not carry a draft payload');
  assert.doesNotMatch(SRC, /setSheetDraft/, 'the stored proposal payload is back');
});

test('the page paints the LIVE draft, so a correction in the boxes reaches it', () => {
  const pending = SRC.slice(SRC.indexOf('const sheetPending = draft'));
  assert.ok(pending.startsWith('const sheetPending = draft'), 'the page no longer takes its values from the draft');
  for (const field of ['narrative: draft.narrative']) {
    assert.ok(pending.includes(field), `the page no longer paints ${field}`);
  }
  // The two formalised fields belong to a GENERATED draft only: a tighten pass
  // rewrites the officer's prose and leaves their record standing.
  assert.match(pending, /findingsText: tightenDraft \? undefined : draftFindingsText,/, 'the findings are no longer scoped to a generated draft');
  assert.match(pending, /statusText: tightenDraft \? undefined : draftStatusText,/, 'the disposition is no longer scoped to a generated draft');
  assert.match(pending, /scope: tightenDraft \? 'tighten' : 'generate',/, 'the scope is no longer taken from the draft');
  // The facts block's Suspect row paints the model's OWN sheet sentence(s) too
  // (the response's suspectLines, [{ row, line }]), in place of the raw
  // recorded values — the record itself is never written from them.
  assert.match(pending, /suspectLines: tightenDraft \? undefined : draft\.suspectLines,/, 'the facts block no longer paints the model\'s own suspect lines');
  assert.match(LEAF, /suspectLines: pending && pending\.scope !== 'tighten' \? pending\.suspectLines : null,/, 'the sheet is no longer handed the draft\'s suspect lines');
  assert.match(LEAF, /buildTypeFacts\(report\.incident_type, \{\s*report,\s*ts,\s*suspectLines:/, 'the suspect lines no longer reach the fact builder');
  // And it is handed to the sheet, not to a stored copy.
  assert.match(SRC, /pending=\{sheetPending\}/, 'the sheet is not handed the live draft');
});

test('the draft has no second box or title of its own — the card is the one box', () => {
  // The "AI draft" title bar and the framed viewer it sat on were a SECOND box
  // inside the AI assistance card (owner request, 2026-10-04: one box, the
  // sheet whole). The card's own head names the assistant; nothing names a
  // draft again, and the viewer now draws no chrome of its own at all.
  assert.doesNotMatch(SRC, /ai-inline-head/, 'the "AI draft" title bar is back in the panel');
  assert.doesNotMatch(SRC, /draftHeadBar/, 'the draft head bar is back in the panel');
  assert.doesNotMatch(STYLE, /\.ai-inline-head\s*\{/, 'the title bar is back in the stylesheet');
  assert.doesNotMatch(STYLE, /\.ai-side-close/, 'the bar\'s dismiss control is back in the stylesheet');

  // The way out the bar carried is not gone with it, and it has MOVED: the
  // wait's own Hide button was removed (owner request, 2026-10-06), leaving the
  // KEYBOARD as the way out while a draft is being written, and the review row
  // under the page keeping Close. The removal is only safe while the key still
  // works, so the two are asserted together — the absence alone would pass just
  // as well on a panel where nothing closes.
  assert.doesNotMatch(SRC, /ai-hide-draft/, "the wait's Hide control is back");
  assert.doesNotMatch(STYLE, /\.ai-hide-draft\s*\{/, 'the Hide button came back in the stylesheet');
  const onKey = bodyOf(SRC, 'const onKey = (e) =>');
  assert.match(onKey, /e\.key !== 'Escape'/, 'the key the card answers to is no longer Escape');
  assert.match(onKey, /if \(panelOpen\) setPanelOpen\(false\)/, 'Escape no longer hides the draft body');
  assert.match(SRC, /<button type="button" onClick={closePanel}>Close<\/button>/, 'the review row lost Close');
});

test('the boxes are added UNDER the page — nothing puts the letter away', () => {
  // "Edit the draft" opens the boxes. It must not clear the draft the page is
  // drawn from, or pressing it would hide the officer's own page.
  const open = bodyOf(SRC, 'const openDraftBoxes = () =>');
  assert.match(open, /setBoxesOpen\(true\)/, '"Edit the draft" no longer opens the boxes');
  assert.doesNotMatch(open, /setSheetDraft|null/, '"Edit the draft" still drops the proposal');

  // Closing the card hides it; the draft — and therefore the page — is still
  // there, so "A draft is ready" must lead back to the letter.
  const close = bodyOf(SRC, 'const closePanel = () =>');
  assert.doesNotMatch(close, /setSheetDraft\(null\)/, 'closing the card still throws the page away');
  assert.match(close, /setPanelOpen\(false\)/, 'closing the card no longer closes it');

  // The boxes are shown when there is no page to draw, or when asked for.
  assert.match(SRC, /const boxesShown = !sheeted \|\| boxesOpen;/, 'the boxes are no longer added under the page');
  assert.match(SRC, /\{boxesShown && \(<>/, 'the boxes are not rendered from that rule');
  // The control that opens them is offered once, and not while they are open.
  assert.match(SRC, /\{sheeted && !boxesOpen && \(/, 'the "Edit the draft" control is offered in the wrong states');

  // A new draft is read before it is corrected.
  assert.equal(
    (SRC.match(/setBoxesOpen\(false\)/g) ?? []).length,
    2,
    'both results (a generated draft and a tightened one) must close the boxes again',
  );
});

test('a draft restored in this tab brings its page back whole, without replaying it', () => {
  // The restore path puts the draft back and nothing else: no stored proposal,
  // and no re-arming of the typing gate, because the sequence has already played
  // once for this officer.
  const restore = bodyOf(SRC, "const stored = loadStoredDraft(reportId);");
  assert.match(restore, /setDraft\(stored\)/, 'the restored draft is no longer restored');
  assert.doesNotMatch(restore, /setSheetTyped\(false\)/, 'a restored draft replays the typing from the start');
  assert.doesNotMatch(restore, /setSheetDraft/, 'the restored draft still needs a stored proposal');

  // The sheet is told, from the same flag that opens the gate: a session that is
  // still typing animates, a restored one does not.
  assert.match(SRC, /revealPending=\{!sheetTyped\}/, 'the sheet is not told whether to type');
  assert.match(LEAF, /revealPending = true,/, 'the sheet no longer takes the flag');
  assert.match(LEAF, /const animate = revealPending && pendingOn;/, 'the animation is no longer gated on the flag');
  assert.match(LEAF, /const typing = animate && totalChars > 0;/, 'the typing is no longer gated on the flag');
  // The cursor starts at the end for anything that must not animate — the
  // committed sheet, and a restored proposal.
  assert.match(
    LEAF,
    /useState\(\(\) => \(animate \? 0 : Number\.MAX_SAFE_INTEGER\)\)/,
    'a proposal that must not animate no longer draws whole',
  );
});
