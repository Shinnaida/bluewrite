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
  new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url),
  'utf8',
);
const SHEET = readFileSync(new URL('../../src/components/reports/ReportSheetBody.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(PANEL);
const LEAF = code(SHEET);
const STYLE = code(CSS);
const SHEET_TEXT = code(
  readFileSync(new URL('../../src/components/reports/SheetText.jsx', import.meta.url), 'utf8'),
);

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
  assert.match(SRC, /\{sheeted && !slim && \(\s*<div/, 'the bondpaper is not drawn from the draft');
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
  assert.match(SRC, /revealPending(=\{!sheetTyped\}|: !sheetTyped)/, 'the sheet is not told whether to type');
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

test('the slim bar portals the letter onto the paper, under the narrative', () => {
  // The paper-side mount is a prop, defaulting off for the deck formats.
  assert.match(SRC, /letterMount = null,/, 'the paper mount prop is gone');
  // The letter renders through one shared dock for both homes: ribbon plus
  // paper, in that order, with the editable gate — no logic in the panel.
  assert.match(SRC, /import SheetLetterDock from '..\/reports\/SheetLetterDock.jsx';/, 'the shared dock import is gone');
  const DOCK = code(readFileSync(new URL('../../src/components/reports/SheetLetterDock.jsx', import.meta.url), 'utf8'));
  assert.match(DOCK, /export default function SheetLetterDock\(\{[^}]*\}\)/, 'the shared letter copy is gone');
  for (const prop of ['sheet,', 'pending,', 'viewportRef,', 'editable,', 'onEditNarrative,', 'onEditChrome,']) {
    assert.match(DOCK, new RegExp(prop.replace(/,/g, ',')), 'the dock lost ' + prop);
  }
  assert.match(DOCK, /<SheetToolBox enabled=\{!!editable\} \/>/, 'the dock lost the editable gate');
  // ONE HOME ONLY (owner request): the slim bar portals onto the paper mount
  // and renders nothing elsewhere — never a missing draft, and never a second
  // copy in the bar. Deck formats keep the page in the card.
  assert.match(SRC, /\{sheeted && \(slim/, 'the letter is no longer gated on the mount');
  assert.match(SRC, /letterMount \? createPortal\(<SheetLetterDock \{\.\.\.letterProps\} freeReview=\{slim && letterEdit\} \/>, letterMount\) : null/, 'the slim bar still draws a second copy');
  // Every sheeted draft draws the letter — plain arrivals as a static police-
  // format proposal (their sheetTyped is already true, so nothing replays),
  // guided arrivals with the typing reveal. Deck formats are unchanged: their
  // sheetProvisional is always false, so the same gate covers them.
  assert.match(SRC, /revealPending: !sheetTyped,/, 'plain arrivals no longer arrive whole');
  assert.match(SRC, /createPortal\(<SheetLetterDock \{\.\.\.letterProps\} freeReview=\{slim && letterEdit\} \/>, letterMount\)/, 'the letter is no longer portaled');
  // Both homes render the one shared props object — stated once, so the
  // portal and the card cannot drift apart on the next edit.
  assert.match(SRC, /const letterProps = \{/, 'the shared props object is gone');
  assert.equal((SRC.match(/<SheetLetterDock \{\.\.\.letterProps\} \/>/g) ?? []).length, 1, 'the deck card no longer shares the one props object');
  assert.equal((SRC.match(/<SheetLetterDock \{\.\.\.letterProps\} freeReview=\{slim && letterEdit\} \/>/g) ?? []).length, 1, 'the mount branch lost the shared props object or its Edit free flag');
  assert.doesNotMatch(SRC, /function sheetLetterPage/, 'the dock logic is back in the panel');
  // No Preview control in the slim bar (owner request, 2026-10-26): the paper
  // IS the preview there, so the fullscreen chip is deck-formats only.
  assert.match(SRC, /\{sheeted && !slim && \(\s*<div className="ai-sheet-bar">/, 'the Preview control is back in the slim bar');
  // The mount div lives on the paper under the narrative, before the form
  // closes; the editor hands its own node over by ref-callback, sheet-only.
  const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  const mount = REPORTS.indexOf('id="ir-sheet-letter-mount"');
  assert.notEqual(mount, -1, 'the paper mount div is gone');
  // Sheet-alone on purpose (owner request, 2026-10-26): gated on the draft,
  // the mount would not exist on the first arrival and the letter would flash
  // in the bar. `:empty` collapses it until the letter arrives.
  const gate = REPORTS.slice(Math.max(0, mount - 400), mount);
  assert.ok(gate.includes('{sheet && ('), 'the mount is no longer up before the draft');
  assert.ok(!gate.includes('{sheet && draft'), 'the mount is draft-gated again — the first arrival flashes in the bar');
  assert.ok(REPORTS.includes('ref={setSheetLetterMount}'), 'the mount no longer hands over its node');
  assert.ok(REPORTS.includes('letterMount={sheet ? sheetLetterMount : undefined}'), 'the mount is not wired sheet-only');
  const formClose = REPORTS.indexOf('</form>', mount);
  assert.notEqual(formClose, -1, 'form close missing');
  assert.ok(mount < formClose, 'the mount must sit on the paper, before the form closes');
});

test('an empty findings result omits the section instead of printing its absence', () => {
  // The panel filters a model-written absence before it reaches the sheet.
  // (Matched on the code, not the comment: this file reads source stripped of
  // comments, like every other rule in this file.)
  assert.match(SRC, /none\\s\+\(recorded\|noted\)/, 'the none-recorded filter is gone');
  // The sheet's own always-on fallback is retired: no heading, no line.
  assert.doesNotMatch(LEAF, /None recorded/, 'the sheet still prints the absence');
  // Read-only still omits the section; the editable letter offers a blank box
  // instead (owner request — type directly on the letter), which is the one
  // exception to the omission rule. The inner flag (not the raw prop) decides,
  // so the free canvas seeds from the read-only letter, never an editing one.
  assert.match(LEAF, /\(effectiveFindings\.length > 0 \|\| \(editInner && onEditFindings\)\) && \(/, 'the findings section is no longer conditional');
});

test('arrival brings what the officer must see next into view', () => {
  // A guided draft types its letter: on the paper in the slim bar (the paper
  // IS the preview there), in the card otherwise. A plain arrival already
  // reads on the paper (applied fields plus its static letter), so the REVIEW
  // in the bar comes into view instead — an Arrange press leaves the wording
  // untouched, and the bar's Keep/Discard is what is still out of sight.
  // The slim bar's letter has one home — the paper mount — so the scroll aims
  // at the mount, never at a copy in the bar.
  assert.match(SRC, /const el = slim \? letterMount \|\| sheetCardRef\.current : sheetCardRef\.current;/, 'the scroll no longer aims at the paper mount');
  assert.match(SRC, /\}, \[sheeted, genCounter, slim, letterMount\]\);/, 'the scroll does not re-aim when the arrival kind changes');
});

test('everything on the letter types back into the report', () => {
  // Owner request: the letter is not a picture of the report — Place, the
  // dates, the people and the items type straight into the draft, through the
  // form's own setters, with the sheet's own Add/Remove for rows.
  const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  // The leaf renders editors for every editable fact kind, gated on the same
  // `editable` flag as the prose.
  assert.match(LEAF, /onEditFact = null,/, 'the fact write path is gone');
  assert.match(LEAF, /onEditChrome = null,/, 'the chrome write path is gone');
  assert.doesNotMatch(LEAF, /onAddRow = null,/, 'the sheet Add path is back');
  assert.doesNotMatch(LEAF, /onRemoveRow = null,/, 'the sheet Remove path is back');
  assert.match(LEAF, /onEditFact\(\{ field: 'location' \}/, 'Place no longer types into the report');
  assert.match(LEAF, /commitIncidentDateTime/, 'the incident date no longer types into the report');
  assert.match(LEAF, /commitDiscoveryDate/, 'the discovery date no longer types into the report');
  assert.match(LEAF, /parseSheetDateTime\(text\)/, 'typed incident dates are not parsed on commit');
  assert.match(LEAF, /personEditor\(row, j, 'complainant'/, 'victim rows are no longer editable on the letter');
  assert.match(LEAF, /suspectEditor\(row, j\)/, 'suspect rows are no longer editable on the letter');
  assert.match(LEAF, /onEditFact\(\{ group: 'stolen_items', index: j, key: 'item_description' \}/, 'item rows no longer type into the report');
  // The panel forwards the fact and chrome paths with the prose ones, in the
  // one shared props object; computed lines (totals, derived action lines)
  // stay read-only. Rows add and remove in the revealed fields, never here.
  assert.match(SRC, /onEditFact,\s*\n\s*onEditChrome,/, 'the panel no longer forwards the write paths');
  assert.doesNotMatch(LEAF, /onEditFact\(\{[^}]*total/, 'a computed line gained a write path');
  // The editor implements the write path — scalars, group cells, and row
  // add/remove with mirrors re-derived — and hands it over read-only-safe.
  assert.match(REPORTS, /function editSheetFact\(target, value\)/, 'the fact write path is gone');
  assert.match(REPORTS, /function editSheetChrome\(tsKey, value\)/, 'the chrome write path is gone');
  assert.doesNotMatch(REPORTS, /function addSheetGroupRow\(groupKey\)/, 'the sheet Add path is back');
  assert.doesNotMatch(REPORTS, /function removeSheetGroupRow\(groupKey, index\)/, 'the sheet Remove path is back');
  assert.match(REPORTS, /onEditFact=\{canEdit \? editSheetFact : undefined\}/, 'the fact path is not gated on edit rights');
  assert.match(REPORTS, /onEditChrome=\{canEdit \? editSheetChrome : undefined\}/, 'the chrome path is not gated on edit rights');
  assert.doesNotMatch(REPORTS, /onAddRow=\{canEdit/, 'row Add is back on the paper');
  assert.doesNotMatch(REPORTS, /onRemoveRow=\{canEdit/, 'row Remove is back on the paper');
  // Rows live in the revealed form fields, never on the paper.
  assert.doesNotMatch(LEAF, /pr-add/, 'an Add control is back on the sheet');
  assert.doesNotMatch(LEAF, /pr-remove/, 'a Remove control is back on the sheet');
  assert.doesNotMatch(LEAF, /type="date"/, 'a date picker is back on the sheet');
  assert.doesNotMatch(LEAF, /type="time"/, 'a time picker is back on the sheet');
});

test('the mount letter reads as the paper itself, full size', () => {
  // Owner request, 2026-10-26: on the sheet the letter IS the article under
  // review — not a 50% card thumbnail below the paragraph. The mount scope
  // keeps the deck homes and the fullscreen screen on their own sizes.
  const FORM_CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \.print-sheet \{[\s\S]*?zoom: var\(--sheet-zoom, 1\);/,
    'the mount letter lost its desk-only size',
  );
  // The deskbar steppers move only the paper: the mount carries the var and
  // the desk offers out/in plus a way back to print size.
  const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  assert.match(REPORTS, /'--sheet-zoom': sheetZoom/, 'the mount no longer carries the desk size');
  assert.match(REPORTS, /aria-label="Zoom in the sheet"/, 'the desk lost its zoom-in');
  assert.match(REPORTS, /aria-label="Zoom out the sheet"/, 'the desk lost its zoom-out');
  assert.match(REPORTS, /setSheetZoom\(1\)/, 'the desk lost its way back to print size');
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \{[\s\S]*?overflow: visible;/,
    'the mount letter is still trapped in a card scroller',
  );
  // The sheet is the container: the card-preview rule fixes the sheet at a
  // full 8.5in, which overhangs the paper's text column — on the desk the
  // letter squeezes to the column it sits in.
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \.print-sheet \{[\s\S]*?width: 100%;/,
    'the mount letter overhangs the paper instead of squeezing to it',
  );
});

test('the letter reads as the same paper, not a page on a page', () => {
  // Owner request: the sheet-format paper showed two letterheads and a full
  // second sheet inside itself. While the mount holds the letter, the form's
  // own band steps aside and the inner paper loses its card chrome.
  const FORM_CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
  assert.match(
    FORM_CSS,
    /\.ir-form--sheet:has\(\.ir-sheet-letter:not\(:empty\)\) \.ir-sheet-head,/,
    'the form band no longer steps aside for the letter',
  );
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \.print-sheet \{\s*\n\s*background: transparent;/,
    'the inner paper still draws a second page',
  );
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \.print-sheet \{[\s\S]*?box-shadow: none;/,
    'the inner paper still casts its own shadow',
  );
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \.print-sheet \{[\s\S]*?min-height: 0;/,
    'the inner paper still holds an 11-inch floor inside the paper',
  );
  assert.match(
    FORM_CSS,
    /\.ir-sheet-letter \.ai-sheet-preview \.print-sheet \{[\s\S]*?padding: 0;/,
    'the inner paper still adds its own inch inside the paper inch',
  );
});

test('the blank sheet carries no buttons of its own — the assistant is the one entry', () => {
  // Owner request: the desk's Arrange / Generate pair duplicated the writing
  // assistant's mode cards + Generate Report exactly, so it was removed. The
  // blank sheet runs through the panel alone, and the run-entry plumbing
  // went with the buttons — nothing publishes entries nobody presses.
  const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(REPORTS, /ir-sheet-cta/, 'the removed desk buttons are back');
  assert.doesNotMatch(REPORTS, /sheetRunRef/, 'the dead run-entry handle is still wired');
  assert.doesNotMatch(REPORTS, /onSheetActions/, 'the dead run-entry registration is still passed');
  assert.doesNotMatch(SRC, /onSheetActions/, 'the panel still publishes entries nobody presses');
  const FORM_CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
  assert.doesNotMatch(FORM_CSS, /\.ir-sheet-cta/, 'the removed buttons left styling behind');
});

test('the letter edits all three prose parts in the formatted editor', () => {
  // Owner request: narrative first, then findings, then action taken. The
  // letter's prose slots are inline formatted editors — no plain textarea is
  // left anywhere in the bondpaper.
  assert.match(LEAF, /<RichTextArea\s*\n\s*value=\{narrativeRaw\}/, 'the narrative is no longer edited in place');
  assert.match(LEAF, /<RichTextArea\s*\n\s*value=\{findingsHtml\}/, 'the findings are still a plain textarea');
  assert.match(LEAF, /<RichTextArea\s*\n\s*value=\{statusHtml\}/, 'the action taken is still a plain textarea');
  assert.doesNotMatch(LEAF, /<textarea/, 'a plain textarea is left in the letter');
});

test('the editor offers undo and redo and nothing else', () => {
  // The scanned police sheet is uniform Verdana: no font, color or size
  // pickers — the brief wins over generic editor chrome.
  const EDITOR = readFileSync(new URL('../../src/components/reports/RichTextArea.jsx', import.meta.url), 'utf8');
  const commands = [...EDITOR.matchAll(/run\('([a-zA-Z]+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    commands,
    ['bold', 'insertOrderedList', 'insertUnorderedList', 'italic', 'redo', 'removeFormat', 'underline', 'undo'],
    'the toolbar gained or lost a command',
  );
});

test('the sheet edits read as the document, not as fields', () => {
  // Owner request: the editable sheet works like Word — no boxes, no dotted
  // outlines, ever. The global .ir-body wells would draw every inline value
  // as a control, so the sheet's own editors drop ALL chrome at every state:
  // rest, hover and focus all read as plain text, focus showing only the
  // native caret/selection.
  const FORM_CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
  assert.match(
    FORM_CSS,
    /\.ir-form--sheet textarea\.pr-edit \{[\s\S]*?background: transparent;/,
    'the sheet editors still draw the boxed wells',
  );
  assert.match(
    FORM_CSS,
    /\.ir-form--sheet textarea\.pr-edit \{[\s\S]*?border: none;/,
    'the sheet editors still carry a border at rest',
  );
  assert.doesNotMatch(
    FORM_CSS,
    /\.ir-form--sheet textarea\.pr-edit \{[\s\S]*?dashed/,
    'a dotted outline crept back onto the sheet editors',
  );
  assert.match(
    FORM_CSS,
    /\.ir-form--sheet textarea\.pr-edit:focus \{[\s\S]*?box-shadow: none;/,
    'the well focus ring still fires on the sheet',
  );
  assert.match(
    FORM_CSS,
    /\.ir-form--sheet textarea\.pr-edit:focus \{[\s\S]*?background: transparent;/,
    'focus still washes the sheet editors',
  );
  // A choice still opens on click, but the dropdown arrow is field chrome.
  assert.match(
    FORM_CSS,
    /\.ir-form--sheet select\.pr-edit \{[\s\S]*?appearance: none;/,
    'the sheet selects still draw their arrows',
  );
  assert.match(
    FORM_CSS,
    /input\.pr-edit\[type='number'\]::-webkit-inner-spin-button/,
    'the sheet number fields still draw spinners',
  );
});

test('long values wrap to the measure — nothing escapes the Letter paper', () => {
  // Owner request: the paper is true 8.5in Letter and every content fits it.
  // Single-line inputs clip (the stolen-item and suspect cut-offs in the
  // screenshots), so the fact rows wrap and unbreakable tokens like IMEIs
  // break anywhere rather than pushing past the edge.
  const STYLE = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(
    STYLE,
    /\.pr-item-edit \{[\s\S]*?flex-wrap: wrap;/,
    'the item rows can still shove a description past the edge',
  );
  assert.match(
    STYLE,
    /\.pr-fact-value \{[^}]*overflow-wrap: anywhere;/,
    'long values still run past the paper instead of wrapping',
  );
  assert.match(
    STYLE,
    /\.pr-fact \{[\s\S]*?min-width: 0;/,
    'a fact row can still force its own width past the measure',
  );
  // Free-text facts are wrapping Word-like fields, not clipping inputs.
  assert.match(LEAF, /<WordField/, 'no wrapping fact field on the sheet');
  assert.match(LEAF, /import WordField from '\.\/WordField\.jsx';/, 'the wrapping field is not wired up');
  // ...while choices keep their native dropdowns and dates type as text.
  assert.match(LEAF, /<select/, 'the choice dropdowns are gone');
  assert.match(LEAF, /parseSheetDateTime/, 'typed incident dates are not read back');
  assert.match(LEAF, /commitDiscoveryDate/, 'typed discovery dates are not read back');
  assert.match(LEAF, /commitReportDate/, 'the typed report date is not read back');
});

test('the prose tools live outside the paper — one dock, no strip on the sheet', () => {
  // Owner request: a single docked ribbon serves the prose from directly
  // ABOVE the paper — narrative, findings, action and the free canvas all
  // stay chrome-free. The blotter Upload rides the form's own strip (see
  // BlotterCapture in Reports.jsx), because the capture sits where the
  // account is written.
  const EDITOR = readFileSync(new URL('../../src/components/reports/RichTextArea.jsx', import.meta.url), 'utf8');
  const BOX = readFileSync(new URL('../../src/components/reports/SheetToolBox.jsx', import.meta.url), 'utf8');
  assert.match(EDITOR, /toolbar = 'top'/, 'the top toolbar lost its default');
  assert.match(BOX, /className="sheet-toolbox sheet-ribbon word-ribbon no-print"/, 'the box prints or lost its styling hook');
  // Narrative, findings, action and the free canvas all stay strip-free
  // under the one ribbon dock; the capture lives on the form, not the paper.
  assert.equal((LEAF.match(/toolbar="none"/g) ?? []).length, 4, 'a dock-served editor lost its none mode');
  assert.doesNotMatch(LEAF, /toolbar="top"/, 'a strip crept back onto the sheet');
  assert.doesNotMatch(LEAF, /<BlotterCapture/, 'the Upload button is back on the paper');
  assert.doesNotMatch(LEAF, /mergeBlotterText/, 'the capture merge is back on the paper');
  assert.doesNotMatch(LEAF, /toolbar="side"/, 'a per-section side panel is back');
  assert.doesNotMatch(STYLE, /\.rt-sidepanel/, 'a per-section side panel rule is back');
  // One copy, mounted in the dock above the sheet: before the frame,
  // outside .print-sheet. The dock owns the order; the panel only spreads
  // the shared props into it.
  const DOCK2 = readFileSync(new URL('../../src/components/reports/SheetLetterDock.jsx', import.meta.url), 'utf8');
  assert.equal((DOCK2.match(/<SheetToolBox enabled=\{!!editable\} \/>/g) ?? []).length, 1, 'the toolbox is missing or repeated');
  assert.ok(
    DOCK2.indexOf('<SheetToolBox enabled={!!editable} />') < DOCK2.indexOf('className="ai-sheet-preview"'),
    'the toolbox is not mounted outside the paper',
  );
  assert.match(DOCK2, /className="sheet-ribbon-dock"/, 'the ribbon dock is missing');
  assert.match(PANEL, /<SheetLetterDock \{\.\.\.letterProps\} \/>/, 'the panel no longer renders the shared dock');
  // The ribbon is in-flow and sticky above the paper, never printed.
  assert.match(STYLE, /\.sheet-toolbox \{[\s\S]*?position: sticky;/, 'the ribbon is not docked above the paper');
  assert.doesNotMatch(STYLE, /\.sheet-toolbox \{[^}]*position: fixed/, 'the floating rail is back');
  // A Word-style ribbon, not a button strip: Clipboard, Font and Paragraph
  // groups, each labeled like the reference.
  for (const group of ['Clipboard', 'Font', 'Paragraph']) {
    assert.match(BOX, new RegExp('aria-label="' + group + '"'), group + ' group is missing from the ribbon');
    assert.match(BOX, new RegExp(group + '</span>'), group + ' group lost its caption');
  }
  // Word Home-tab arrangement: Clipboard carries Cut, Copy, Paste; Clear
  // Formatting lives in Font (Word’s A-eraser) — and nothing that would
  // change the stored record (no font family, no size, no colors, no Format
  // Painter): the record stays words with emphasis.
  for (const tool of ['Cut', 'Copy', 'Paste']) {
    assert.match(BOX, new RegExp('aria-label="' + tool + '"'), tool + ' is missing from the Clipboard group');
  }
  assert.match(BOX, /aria-label="Clear formatting"/, 'Clear is missing from the Font group');
  assert.match(BOX, /wr-qat/, 'the Quick Access Toolbar is gone');
  assert.match(BOX, /wr-tabs/, 'the tab strip is gone');
  assert.match(BOX, /wr-tab--active/, 'Home is not the active tab');
  assert.match(BOX, /wr-groups/, 'the Word group row is gone');
  assert.match(BOX, /data-collapsed/, 'the collapse state is gone');
  assert.doesNotMatch(BOX, /fontName|foreColor|hiliteColor|formatPainter|Font family|Text color/i, 'a record-changing control crept onto the ribbon');
  // Same commands, one of each — counted on the box, the only toolbar the
  // sheet has: fourteen presses plus the Paste reader.
  assert.equal((BOX.match(/onMouseDown=\{press\('/g) ?? []).length, 14, 'the box gained or lost a command');
  assert.equal((BOX.match(/onMouseDown=\{paste\}/g) ?? []).length, 1, 'the Paste reader is missing or repeated');
  assert.equal((BOX.match(/<button /g) ?? []).length, 16, 'a ribbon button is missing or repeated');
});

test('facts type as plain words — no formatting chrome on inline values', () => {
  // Owner request: inline facts are fully naked. The wrapping field carries
  // no toolbar, and Enter commits while Escape reverts.
  const FIELD = readFileSync(new URL('../../src/components/reports/WordField.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(FIELD, /rt-toolbar|rt-tool/, 'formatting chrome crept onto the fact field');
  assert.match(FIELD, /e\.key === 'Enter'/, 'Enter no longer commits the fact');
  assert.match(FIELD, /e\.key === 'Escape'/, 'Escape no longer reverts the fact');
  assert.doesNotMatch(FIELD, /execCommand|<b>|sanitizeRichHtml/, 'facts stopped being plain words');
});

test('one docked ribbon serves the caret, with Word keys', () => {
  // Owner request: one ribbon above the paper serves all three prose
  // sections. Ctrl+B/I/U style like Word; Ctrl+Z/Y/X/C/V stay native (the
  // browser's own stack IS the Word parity).
  const EDITOR = readFileSync(new URL('../../src/components/reports/RichTextArea.jsx', import.meta.url), 'utf8');
  const BOX = readFileSync(new URL('../../src/components/reports/SheetToolBox.jsx', import.meta.url), 'utf8');
  // Registration: a none-mode editor announces its caret on focus and
  // withdraws it on blur — nothing else can enable the ribbon.
  assert.match(EDITOR, /if \(toolbar === 'none'\)/, 'the strip-free mode is gone from the editor');
  assert.match(EDITOR, /registerSheetEditor\(boxRef\.current, emit\)/, 'focusing the prose no longer hands the box its caret');
  assert.match(EDITOR, /unregisterSheetEditor\(boxRef\.current\)/, 'the caret is never withdrawn, so the ribbon never dims');
  assert.doesNotMatch(EDITOR, /toolbar === 'side'/, 'a side panel mode is back');
  // DOCKED ABOVE (owner request): in-flow in the ribbon dock, always
  // visible while editable, dimmed until a prose editor holds the caret —
  // never a floating rail tracking the caret row.
  assert.match(BOX, /data-active/, 'the ribbon lost its dimmed-until-caret state');
  assert.match(BOX, /aria-disabled={dis}/, 'the ribbon no longer dims when nothing holds the caret');
  assert.doesNotMatch(BOX, /\sdisabled=\{!active\}/, 'a disabled button kills the press path: real clicks never fire onMouseDown on it');
  assert.match(BOX, /enabled = true/, 'the ribbon lost its editable gate');
  assert.ok(BOX.includes("if (!enabled"), 'the ribbon shows on a read-only sheet');
  assert.doesNotMatch(BOX, /getBoundingClientRect|caretRect|window\.innerWidth/, 'the floating rail positioning is back');
  assert.doesNotMatch(BOX, /pr\.left - GAP/, 'the rail still parks left of the paper');
  assert.match(BOX, /role="toolbar"/, 'the box lost its toolbar role');
  assert.match(BOX, /title="Bold \(Ctrl\+B\)"/, 'Bold does not name its Word key');
  assert.match(BOX, /title="Undo \(Ctrl\+Z\)"/, 'Undo does not name its Word key');
  assert.match(BOX, /title="Redo \(Ctrl\+Y\)"/, 'Redo does not name its Word key');
  // Paragraph alignment reaches the matching command — the record keeps it
  // as a strict text-align (see richText.test.mjs), so these buttons do
  // something rather than styling a selection the sanitizer then drops.
  assert.match(
    BOX,
    /press\('justifyLeft'\)[\s\S]*press\('justifyCenter'\)[\s\S]*press\('justifyRight'\)[\s\S]*press\('justifyFull'\)/,
    'the Paragraph group is missing an alignment command',
  );
  assert.match(EDITOR, /const onKeys = \(e\) =>/, 'no Word key handler on the editor');
  assert.match(EDITOR, /k === 'b' \? 'bold' : k === 'i' \? 'italic' : k === 'u' \? 'underline' : null/, 'Ctrl+B/I/U do not reach the matching command');
  assert.match(EDITOR, /onKeyDown=\{onKeys\}/, 'the Word keys are not wired to the text');
  assert.doesNotMatch(EDITOR, /'z'|'y'|'x'|'c'|'v'/, 'undo/redo/clipboard got hijacked instead of staying native');
});

test('every fact value on the leaf types into the record', () => {
  // Owner request: the labeled facts are not read-only text — each value
  // resolves to the type_specific field (or fields) it prints, and each
  // field gets its own WordField. Money shows raw and parses digits back;
  // dates use the native picker; group rows edit in place.
  assert.match(LEAF, /const EDIT_TARGETS = \{/, 'the label-to-field table is gone');
  for (const [label, pattern] of [
    ['Weapon/Force Used', /'Weapon\/Force Used':/],
    ['Relationship', /'Relationship':/],
    ['Nature of Incident', /'Nature of Incident':/],
    ['Injuries Sustained', /'Injuries Sustained':/],
    ['Medical Treatment', /'Medical Treatment':/],
    ['Suspected Cause', /'Suspected Cause':/],
    ['Mode/Scheme Used', /'Mode\/Scheme Used':/],
    ['Estimated Value', /'Estimated Value':/],
    ['Date(s) of Transaction', /'Date\(s\) of Transaction':/],
    ['Circumstances', /'Circumstances':/],
    ['Operation Type', /'Operation Type':/],
    ['Casualties', /'Casualties':/],
  ]) {
    assert.match(LEAF, pattern, label + ' has no write path');
  }
  assert.match(LEAF, /resolveFactSpec\(entry\.label\)/, 'the generic facts do not resolve their write path');
  assert.match(LEAF, /moneyDigits\(v\)/, 'money no longer parses back to digits on write');
  assert.match(LEAF, /parseSheetDate\(text\)/, 'typed dates are not parsed back on write');
  // Composed group lines and templated displays stay static — editing them
  // as one box would corrupt the fields they join, and no row editor owns
  // them on the sheet.
  assert.doesNotMatch(LEAF, /'Vehicle N':/, 'a composed group line gained a bogus write path');
  assert.doesNotMatch(LEAF, /'Point of Entry':/, 'a templated display gained a bogus write path');
  assert.doesNotMatch(LEAF, /'Last Seen':/, 'a fallback composite gained a bogus write path');
});

test('the static lines type too — letterhead, labels, headings, signatures', () => {
  // Owner request: the whole sheet is a typing surface, not just its values.
  // Overrides ride flat `sheet_*` scalars (server-safe: the blob validator
  // rejects nested objects), and clearing a line drops its override so the
  // template default reads again.
  assert.match(LEAF, /import SheetText, \{ sheetTextOf \} from '\.\/SheetText\.jsx';/, 'the chrome field is not wired up');
  assert.match(LEAF, /const st = \(key, fallback\) => sheetTextOf\(ts, key, fallback\);/, 'the override reader is gone');
  assert.match(LEAF, /for \(const hk of \['agency', 'commission', 'regional_office', 'provincial_office', 'station_name', 'station_location', 'office_code'\]/, 'a letterhead line is not overridable');
  // CL is a plain helper (not a component) so the focused field keeps its
  // caret across re-renders — an inline component would remount mid-word.
  assert.match(LEAF, /const CL = \(k, fb\) =>/, 'the chrome helper lost its remount-safe shape');
  assert.match(LEAF, /\{CL\('head agency', head\.agency\)\}/, 'the agency line does not type');
  assert.match(LEAF, /\{CL\('title', "POLICE REPORT"\)\}/, 'the title does not type');
  assert.match(LEAF, /\{CL\(`label \$\{entry\.label\}`, labelCase\(entry\.label\)\)\}/, 'fact labels do not type');
  assert.match(LEAF, /\{CL\('facts head',/, 'the facts heading does not type');
  assert.match(LEAF, /\{CL\('noted label',/, 'the noted-by label does not type');
  // Read-only stays read-only: the editor renders only under `editable`,
  // and the fallback ink is the template default, never an empty box.
  assert.match(LEAF, /chromeEdit \? \(/, 'chrome edits leak into the read path');
  // The blotter number stays derived — typing it would falsify the record's
  // own reference — while the signing name resolves per-report, then the
  // station default.
  assert.match(LEAF, /blotter entry # \{reportNo\}/, 'the blotter reference stopped being derived');
  assert.match(LEAF, /report\.noted_by_name \|\|/, 'the report\u2019s own noting official no longer wins');
  assert.match(LEAF, /stationHeader\?\.noted_by/, 'the station default no longer stands behind it');
  // Overrides clear cleanly instead of storing blanks.
  assert.match(SHEET_TEXT, /clean === ''/, 'clearing a line no longer drops its override');
  assert.match(SHEET_TEXT, /export function sheetKeyName/, 'the override key builder is gone');
  assert.match(SHEET_TEXT, /export function sheetTextOf/, 'the override reader is gone');
});

test('the sheet frees its letter into one canvas that keeps its own text', () => {
  // Owner request: Edit on the letter is free typing — one canvas seeded from
  // the composed body, not a run of per-field boxes — and the kept text rides
  // the draft like any field, printing as-is.
  const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  const DOCK = code(readFileSync(new URL('../../src/components/reports/SheetLetterDock.jsx', import.meta.url), 'utf8'));
  const PRINT = readFileSync(new URL('../../src/components/reports/ReportPrint.jsx', import.meta.url), 'utf8');

  // The editor owns the kept text: default blank, a setter on the canvas
  // path, the save boundary's letter subset, and the way back to composed.
  assert.match(REPORTS, /letter_html: '',/, 'the draft carries no kept letter text');
  assert.match(REPORTS, /function setLetterHtml\(html\)/, 'the canvas has no write path into the draft');
  assert.match(REPORTS, /letterHtml=\{draft\?\.letter_html \|\| ''\}/, 'the panel never receives the kept text');
  assert.match(REPORTS, /onEditLetterHtml=\{canEdit \? setLetterHtml : undefined\}/, 'the canvas write path is missing or open to read-only accounts');
  assert.match(REPORTS, /set\('letter_html', ''\)/, 'a kept letter cannot be dropped for the composed one');
  // Discard (and the fresh run that replaces a review) drops the canvas text
  // with the snapshot — otherwise the provisional letter survives its own
  // Discard. A kept letter's snapshot is already dropped, so kept ink stays.
  assert.match(REPORTS, /bringing back the snapshotted words must drop the[\s\S]*?set\('letter_html', ''\);/, 'a discarded review leaves its canvas on the paper');

  // The panel forwards both halves; the dock spreads them into the body.
  assert.match(SRC, /letterHtml,\n    onEditLetterHtml,/, 'the letter props never reach the dock');
  assert.match(DOCK, /letterHtml=\{letterHtml\}/, 'the dock drops the kept text');
  assert.match(DOCK, /onEditLetterHtml=\{onEditLetterHtml\}/, 'the dock drops the canvas write path');

  // The body: one canvas while freeing (seeded from a hidden composed copy),
  // the kept text while kept (seals, signatures and appendix stay composed),
  // the composed body otherwise — and a draft under review frees only on the
  // sheet mount in Edit mode (see freeReview), where the desk owns Keep/Discard.
  assert.match(LEAF, /const freeEdit = !!\(editable && onEditLetterHtml && \(!pending \|\| freeReview\)\);/, 'the free canvas lost its gate');
  // Sheet-mount Edit mode never shows per-field boxes on the paper: with
  // `freeReview` the inner editors stay off even before the canvas takes
  // over, so Edit reads as flowing text (Word-like) at every moment.
  assert.match(LEAF, /const editInner = freeEdit \? false : \(editable && !freeReview\);/, 'field boxes are back on the sheet paper in Edit mode');
  // The dock carries the mount-only review flag into the body; the panel sets
  // it on the sheet portal alone (slim bar + Edit), never the deck card.
  assert.match(DOCK, /freeReview=\{freeReview\}/, 'the dock drops the review flag');
  assert.match(SRC, /freeReview=\{slim && letterEdit\}/, 'the canvas frees outside the sheet Edit review');
  assert.match(LEAF, /<div ref=\{seedRef\} hidden>\{midPart\}<\/div>/, 'the canvas no longer seeds from the composed body');
  // The seed re-captures while the reveal types and on every generation, but
  // never over officer ink: once the canvas holds keystrokes the seed freezes.
  assert.match(LEAF, /\}, \[freeEdit, letterHtml, cursor, revealKey\]\);/, 'the seed goes stale mid-typing or across runs');
  assert.match(LEAF, /<RichTextArea/, 'the free canvas is gone');
  assert.match(LEAF, /toolbar="none"/, 'the canvas carries chrome of its own');
  assert.match(LEAF, /letterHtml \|\| seed/, 'a cleared letter does not re-seed from the composed body');
  assert.match(LEAF, /sanitizeLetterHtml\(letterHtml\)/, 'the kept text renders unsanitized');
  // The canvas cleans through the letter subset (structure + hooks survive),
  // while every prose editor keeps the prose default — one prop, unchanged.
  assert.match(LEAF, /sanitize=\{sanitizeLetterHtml\}/, 'the canvas strips the seed through the prose filter');
  const EDITOR = code(readFileSync(new URL('../../src/components/reports/RichTextArea.jsx', import.meta.url), 'utf8'));
  assert.match(EDITOR, /sanitize = sanitizeRichHtml,/, 'a prose editor lost its default filter');

  // Print prefers the kept text (read-only — the canvas never mounts there).
  assert.match(PRINT, /letterHtml=\{report\.letter_html \|\| ''\}/, 'print ignores the kept letter text');
});

test('the View/zoom strip is pinned to the screen corner, not the page flow', () => {
  // Owner request: the paper's own size and mode controls float at the
  // viewport's bottom-right and stay there while the desk scrolls — fixed,
  // not sticky, because the shell scrolls inside `.main`. Off the paper by
  // construction: the deskbar carries `no-print`.
  const FORM_CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
  const bar = FORM_CSS.match(/\.ir-sheet-deskbar > \.ir-sheet-bar \{[^}]*\}/);
  assert.ok(bar, 'the deskbar bar rule is gone');
  assert.match(bar[0], /position:\s*fixed;/, 'the strip scrolls away with the page');
  assert.match(bar[0], /left:\s*1\.1rem;/, 'the strip is not docked left, clear of the chatbot button');
  assert.match(bar[0], /bottom:\s*1\.1rem;/, 'the strip is not docked to the bottom');
  assert.match(bar[0], /z-index:\s*60;/, 'the strip lost its place among the floating chrome');
});
