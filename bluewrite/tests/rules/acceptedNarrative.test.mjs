// BlueWrite — THE ACCEPTED NARRATIVE IS A FIELD, LIKE EVERY OTHER ONE.
//
// "Accept into report" used to swap the narrative field out for the bondpaper
// the report would print on: the accepted text appeared on a page, under an
// Edit / Regenerate strip, in place of the field the officer writes in. The
// findings and the status landed in their own fields; the narrative did not —
// so the one part the AI had rewritten was the one part of the form that no
// longer read as an ordinary field. The reveal is gone (owner request,
// 2026-10-06) and the text is what shows.
//
// Three things have to hold together, and each is asserted here:
//
//   1. ACCEPT WRITES THE FIELD — the accepted text lands in `draft.narrative`
//      through the same helper it always did, and the AI provenance tag the
//      RECORD carries (`narrative_source`) is untouched: that tag is the
//      record's, not a treatment of the screen's;
//   2. NOTHING REPLACES THE FIELD — no view state, no reveal markup, no bar,
//      and no rule for any of it in the stylesheet that carries the form;
//   3. THE BONDPAPER STILL APPEARS WHERE IT WAS ASKED FOR — the AI panel's own
//      card, while the draft is under review, and the print preview — so
//      "what will print" was not lost with the reveal.
//
// Read from source and stylesheet, like aiSheetFit.test.mjs: there is no DOM
// harness in this project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const PANEL = readFileSync(
  new URL('../../src/components/AiNarrativePanel.jsx', import.meta.url),
  'utf8',
);
const FORM_CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const SRC = code(REPORTS);
const PANEL_CODE = code(PANEL);
const STYLE = code(FORM_CSS);

/** The body of `function name(...) { … }`, up to the next top-level function. */
const bodyOf = (src, marker) => {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `${marker} is gone`);
  return src.slice(at, src.indexOf('\n  }', at + marker.length));
};

test('accept writes the narrative into its own field', () => {
  // The one press that moves a draft into the report hands the wording to the
  // helper that owns the write, exactly as it did before the reveal was
  // removed: the text is what Accept puts in the report.
  const accept = bodyOf(SRC, 'function applyAiDraft(');
  assert.match(
    accept,
    /applyAiNarrative\(narrative, sourceMeta\)/,
    'accept no longer writes the narrative into the report',
  );

  const write = bodyOf(SRC, 'function applyAiNarrative(');
  assert.match(write, /set\('narrative', narrative\)/, 'the accepted text no longer lands in the narrative field');
  // The record's provenance is not a screen treatment: it stays, because the
  // report has to keep knowing how its narrative was authored.
  assert.match(
    write,
    /narrativeSourceRef\.current = 'ai-assisted'/,
    'the AI provenance tag on the record is gone',
  );
});

test('nothing swaps the narrative field out for a page', () => {
  // The field is the officer's, and it is still a field: the textarea writes
  // through the same setter, in the same card, with no second view of it.
  assert.match(SRC, /id="r-narr"/, 'the narrative textarea is gone');
  assert.match(
    SRC,
    /onChange=\{\(e\) => setNarrative\(e\.target\.value\)\}/,
    'the narrative field is no longer the officer’s to edit',
  );
  const field = SRC.match(/<div className="ir-field ir-narrative"[^>]*>/);
  assert.ok(field, 'the narrative field is gone');
  assert.doesNotMatch(field[0], /hidden/, 'the narrative field can be hidden for a reveal again');

  // ...and nothing puts a page in its place.
  assert.doesNotMatch(SRC, /narrativeView/i, 'a narrative view state is back');
  assert.doesNotMatch(SRC, /ir-sheet-reveal/, 'the reveal markup is back in the form');
  assert.doesNotMatch(SRC, /this is what will print/, 'the reveal’s bar is back');
  assert.doesNotMatch(SRC, /ReportSheetBody/, 'the form renders the bondpaper itself again');

  // The stylesheet that carries the form has no rules for it either, including
  // the one that hid the field while the page was up.
  assert.doesNotMatch(STYLE, /ir-sheet-reveal/, 'the reveal’s styles are back');
  assert.doesNotMatch(STYLE, /\.ir-narrative\[hidden\]/, 'the rule that hid the field for the reveal is back');
});

test('the bondpaper still appears where the draft is read, and where it prints', () => {
  // The AI panel's own card is where Generate is pressed, and that is where the
  // page is drawn while the draft is under review.
  assert.match(PANEL_CODE, /const sheeted = !!draft && !!sheet;/, 'the page is no longer tied to the draft under review');
  assert.match(PANEL_CODE, /\{sheeted && \(\s*<div/, 'the bondpaper is no longer drawn in the assistant’s card');
  assert.match(SRC, /sheet=\{\{/, 'the form no longer hands the panel the sheet it draws');

  // And the page that will print is still the print portal's.
  assert.match(SRC, /<ReportPrint/, 'the print preview is gone from the form');
});
