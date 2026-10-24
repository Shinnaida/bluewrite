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
//   2. THE FIELD YIELDS ONLY TO A DRAFT UNDER REVIEW — on the sheet, a
//      generated letter reads on the paper mount in place of the paragraph
//      (owner request, 2026-10-26), scoped to a non-empty mount so Keep /
//      Discard / Close bring the writing area back; no view state, no reveal
//      markup, no bar, and no other rule for any of it in the form's
//      stylesheet;
//   3. THE BONDPAPER STILL APPEARS WHERE IT WAS ASKED FOR — the AI panel's own
//      card, while the draft is under review, and the print preview — so
//      "what will print" was not lost with the reveal.
//
// Read from source and stylesheet, like aiSheetFit.test.mjs: there is no DOM
// harness in this project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
const PANEL = readFileSync(
  new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url),
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

test('the narrative field yields to the generated letter only while it is under review', () => {
  // The field is the officer's, and it is still a field: the Word-like editor
  // writes through the same setter, in the same card, with no second view of
  // it. Plain text passes through untouched, so legacy rows and AI drafts
  // behave exactly as before.
  assert.match(SRC, /<RichTextArea[^>]*?id="r-narr"/, 'the narrative editor is gone');
  // The narrative carries its own strip on top (the blotter Upload rides
  // it — see BlotterCapture); the form's docked ribbon stays mounted but
  // hidden, serving nothing for now.
  assert.match(
    SRC,
    /<RichTextArea[^>]*?id="r-narr"[^>]*?toolbar="top"/,
    'the narrative field lost its own top strip',
  );
  assert.match(SRC, /<BlotterCapture/, 'the Upload button is missing from the narrative');
  assert.match(SRC, /mergeBlotterText\(draft\.narrative, text\)/, 'the capture bypasses the safe merge');
  assert.match(
    SRC,
    /<div className="sheet-ribbon-dock form-ribbon-dock no-print">/,
    'the form ribbon dock above the paper is gone',
  );
  assert.ok(
    SRC.indexOf('form-ribbon-dock') < SRC.indexOf('className="ir-sheet-head"'),
    'the ribbon is no longer docked above the paper',
  );
  // Between the band and the paper: the dock sits outside the form (which
  // IS the white sheet), on the page ground above it — never on the text.
  assert.ok(
    SRC.indexOf('form-ribbon-dock') < SRC.indexOf('onSubmit={(e) => e.preventDefault()}'),
    'the ribbon is still inside the paper instead of between band and sheet',
  );
  assert.match(
    SRC,
    /onChange={setNarrative}/,
    'the narrative field is no longer the officer’s to edit',
  );
  const field = SRC.match(/<div className="ir-field ir-narrative"[^>]*>/);
  assert.ok(field, 'the narrative field is gone');
  assert.doesNotMatch(field[0], /hidden/, 'the narrative field can be hidden for a reveal again');

  // ...and nothing else puts a page in its place.
  assert.doesNotMatch(SRC, /narrativeView/i, 'a narrative view state is back');
  assert.doesNotMatch(SRC, /ir-sheet-reveal/, 'the reveal markup is back in the form');
  assert.doesNotMatch(SRC, /this is what will print/, 'the reveal’s bar is back');
  assert.doesNotMatch(SRC, /ReportSheetBody/, 'the form renders the bondpaper itself again');

  // The one exception is the sheet mount's letter (owner request, 2026-10-26):
  // the raw paragraph steps aside for the generated proposal while it is on
  // the paper — scoped to a non-empty mount, so an empty mount (no draft, or
  // kept / discarded / closed) leaves the writing area exactly as it was. The
  // native-language review surface lives outside the narrative block, so
  // hiding the paragraph can never hide the review with it.
  assert.match(
    STYLE,
    /\.ir-field\.ir-narrative:has\(~ \.ir-sheet-letter:not\(:empty\)\)/,
    'the paragraph no longer steps aside for the letter on the paper',
  );
  // The form's ribbon steps aside with the paragraph it serves — the paper
  // carries exactly one strip: the letter's own dock while under review.
  assert.match(
    STYLE,
    /body:has\(\.ir-sheet-letter:not\(:empty\)\) \.form-ribbon-dock/,
    'the form ribbon no longer steps aside for the letter’s dock',
  );
  assert.match(
    STYLE,
    /\.form-ribbon-dock \{[\s\S]*?max-width: 8\.5in;/,
    'the floating ribbon lost the paper’s measure',
  );
  assert.doesNotMatch(STYLE, /ir-sheet-reveal/, 'the reveal’s styles are back');
  assert.doesNotMatch(STYLE, /\.ir-narrative\[hidden\]/, 'the rule that hid the field for the reveal is back');
  // Matched on the raw source (comments intact): the panel opens directly
  // after the narrative div closes, so hiding the paragraph can never hide
  // the review with it.
  assert.match(
    REPORTS,
    /<\/div>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?\{hasSource\(draft\) && editingId && \(/,
    'the review surface is still inside the hidden block',
  );
});

test('the bondpaper still appears where the draft is read, and where it prints', () => {
  // The AI panel's own card is where Generate is pressed, and that is where the
  // page is drawn while the draft is under review.
  assert.match(PANEL_CODE, /const sheeted = !!draft && !!sheet;/, 'the page is no longer tied to the draft under review');
  assert.match(PANEL_CODE, /\{sheeted && !slim && \(\s*<div/, 'the bondpaper is no longer drawn in the assistant’s card');
  assert.match(SRC, /sheet=\{\{/, 'the form no longer hands the panel the sheet it draws');

  // And the page that will print is still the print portal's.
  assert.match(SRC, /<ReportPrint/, 'the print preview is gone from the form');
});

test('the save boundary keeps only the allowlisted subset', () => {
  // The editor sanitizes on every keystroke and the server strips again; the
  // save payload is cleaned too, so a mirror, a legacy row or any other
  // writer reaching the boundary cannot smuggle markup into the record.
  const save = bodyOf(SRC, 'const cleanSaveBody = (body) => {');
  assert.match(save, /sanitizeRichHtml\(next\.narrative\)/, 'the narrative is not cleaned at the boundary');
  assert.match(save, /sanitizeRichHtml\(next\.action_taken\)/, 'the disposition is not cleaned at the boundary');
  assert.match(
    save,
    /sanitizeRichHtml\(next\.type_specific\.notable_findings\)/,
    'the findings are not cleaned at the boundary',
  );
  // The freed letter rides the same boundary through its own subset —
  // structure and sheet hooks survive, everything else does not.
  assert.match(save, /sanitizeLetterHtml\(next\.letter_html\)/, 'the freed letter is not cleaned at the boundary');
  const writer = bodyOf(SRC, 'const writeDraft = useCallback(');
  assert.match(writer, /cleanSaveBody\(\{ \.\.\.d, status: 'draft'/, 'autosave bypasses the boundary');
  assert.match(SRC, /cleanSaveBody\(\{ \.\.\.next, status: 'draft', narrative_source: 'ai-assisted' \}\)/, 'the guided save bypasses the boundary');
});
