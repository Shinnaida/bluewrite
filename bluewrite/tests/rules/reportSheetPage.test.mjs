// BlueWrite — CLICK A REPORT, READ ITS SHEET.
//
// The register's rows used to open the WRITER, for a draft and a filed report
// alike. They now open the record as the page it will print on — a page of the
// register rather than a panel over it — and what the page offers is decided by
// the STATUS (owner request, 2026-10-06):
//
//   · a DRAFT keeps the way back into writing: "Edit draft", which is the row's
//     own Edit, confirm and all (one ask for one act);
//   · a SUBMITTED (or finalized) report is READ-ONLY here. It has gone to the
//     station; the sheet is the whole of it.
//
// Four things have to hold together, and each is asserted here:
//
//   1. THE CLICK shows the sheet — for every status the list holds (reading a
//      record is not an edit), except the archive, which stays restore-only;
//   2. THE PAGE is the shared sheet, drawn by ReportPrint's page variant: the
//      same paper, the same endpoint, and NOT the print overlay;
//   3. THE ACTIONS are the page's own bar — Edit draft on a draft, Print on
//      everything — and Print still goes through the shared dialog, because a
//      page cannot print itself (print CSS hides the app the page stands in);
//   4. THE VARIANT really is a different frame: no portal, no print body class,
//      and no in-sheet action row;
//   5. EDIT DRAFT LANDS IN WRITE REPORT, carrying the draft (owner request,
//      2026-10-06). The sheet page's own Edit draft opens the writer ON TOP of
//      it — so the writer is drawn before the sheet page, and the writer loads
//      the record by the id it was handed.
//
// Read from source, like the rest of tests/rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const LIST = readFileSync(new URL('../../src/components/ReportList.jsx', import.meta.url), 'utf8');
const PRINT = readFileSync(new URL('../../src/components/ReportPrint.jsx', import.meta.url), 'utf8');
const ACTIONS = readFileSync(new URL('../../src/components/ReportActions.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
const SHARED = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const SRC = code(REPORTS);
const ROW = code(LIST);
const SHEET = code(PRINT);

test('the row click views the sheet, whatever the report’s status', () => {
  // The rule lives in rowMeta, where the list's own rules already are, and the
  // click carries it: every status the list holds opens.
  assert.match(SRC, /canOpen: !showArchived,/, 'the register still refuses to open a filed report');
  assert.match(SRC, /onOpen=\{openSheet\}/, 'the register no longer opens a report as its sheet');
  assert.match(SRC, /function openSheet\(r\) \{\s*\n\s*setSheetReport\(r\);/);
  // The list hands the whole record over, so the page can name it without a
  // second read of the row it came from.
  assert.match(ROW, /if \(meta\.canOpen\) onOpen\?\.\(report\)/);
  // Edit is still the DRAFT's own action, and the archive is still restore-only:
  // viewing changed, editing did not.
  assert.match(
    SRC,
    /canEdit:\s*!showArchived &&\s*statusBucket\(r\.status\) === 'draft' &&\s*\(user\.role === 'Admin' \|\| Number\(r\.created_by\) === Number\(user\.id\)\)/,
  );
  assert.match(SRC, /canRestore: showArchived && user\.role === 'Admin'/);
});

test('the page draws the shared sheet, not a lookalike', () => {
  assert.match(SRC, /if \(sheetReport\) \{/, 'there is no sheet page');
  assert.match(SRC, /<ReportPrint\s*\n\s*reportId=\{sheetReport\.id\}\s*\n\s*variant="page"/);
  assert.match(SRC, /onLoaded=\{\(filed\) =>/, 'the page’s own name is never refreshed from the filed record');
  // The page is a page: the bar is above the paper, and the way back is its own
  // control rather than the browser's.
  assert.match(SRC, /className="ir-sheet-page__bar"/);
  assert.match(SRC, /className="ir-sheet-page__back" onClick=\{closeSheet\}/);
  assert.match(SRC, /function closeSheet\(\) \{\s*\n\s*setSheetReport\(null\);/);
  assert.match(CSS, /\.ir-sheet-page__bar \{/);
  assert.match(CSS, /\.ir-sheet-page__ident \{/);
});

test('the bar offers Edit draft on a draft, and Print on everything', () => {
  // DRAFTS ONLY. A submitted report has gone to the station, so the sheet is the
  // whole of it here — the page's own rendering says so.
  assert.match(
    SRC,
    /\{!showArchived && statusBucket\(sheetReport\.status\) === 'draft' && \(\s*\n\s*<button type="button" className="primary" onClick=\{\(\) => askEdit\(sheetReport\)\}>\s*\n\s*Edit draft/,
  );
  // ...and the ask is the register's one ask for a draft, confirmation included.
  assert.match(SRC, /action: \(\) => setOpenId\(r\.id\)/);

  // PRINT GOES THROUGH THE DIALOG. Print CSS hides `.shell` while the overlay's
  // body class is on, so a page inside the shell cannot print itself: the page
  // hands the officer the surface that can.
  assert.match(SRC, /onClick=\{\(\) => actions\.print\(sheetReport\)\}/);
  assert.match(SRC, /\{actions\.dialogs\}/, 'the page does not draw the shared dialogs it opens');
  assert.match(ACTIONS, /function print\(r\) \{\s*\n\s*setPrintingId\(r\.id\);/);
  assert.match(ACTIONS, /return \{ items, ask, askArchive, askRestore, openHistory, print, dialogs \};/);
});

test('Edit draft opens the writer over the sheet, carrying the draft', () => {
  // ONE ask, two surfaces: the bar's Edit draft hands the SAME confirm the row
  // does, and confirming it opens the writer on that report (`setOpenId`).
  assert.match(SRC, /onClick=\{\(\) => askEdit\(sheetReport\)\}/);
  assert.match(SRC, /action: \(\) => setOpenId\(r\.id\)/);

  // AND THE WRITER WINS THE RENDER. The sheet page is left standing under it, so
  // editing returns the officer to the page they came from — but only if the
  // writer is drawn FIRST. With the sheet's return in front, its own Edit draft
  // set `openId` behind a page that went on rendering and the click looked like
  // it had done nothing at all.
  const writer = SRC.indexOf('if (openId !== null) {');
  const sheet = SRC.indexOf('if (sheetReport) {');
  assert.notEqual(writer, -1, 'Write Report is never drawn');
  assert.notEqual(sheet, -1, 'the sheet page is never drawn');
  assert.ok(
    writer < sheet,
    'the sheet page is drawn before the writer, so Edit draft cannot reach Write Report',
  );
  // ...and the writer is opened on the report it came from: the id it is handed
  // is what it reads the draft back with, so the form arrives filled in rather
  // than blank.
  assert.match(SRC, /reportId=\{openId\}/);
  assert.match(SRC, /api\(`\/reports\/\$\{reportId\}\/print`\)/);
  assert.match(SRC, /setDraft\(\{\s*\n\s*\.\.\.EMPTY,\s*\n\s*\.\.\.r,/);
});

test('the page variant is a different frame from the print dialog', () => {
  // NO PORTAL and NO PRINT BODY CLASS: `body.print-sheet-open` hides `.shell`
  // wholesale, and the page stands inside it — wearing it would hide the page it
  // belongs to.
  assert.match(SHEET, /if \(variant !== 'overlay'\) return undefined;/);
  assert.match(SHEET, /if \(autoPrint && variant === 'overlay'\) \{/);
  assert.match(SHEET, /if \(variant === 'page'\) return pageFrame\(paper\);/);
  assert.match(SHEET, /const pageFrame = \(paper\) => \(\s*\n\s*<div className="sheet-page">\s*\n\s*\{bar\}/);
  // The default action row belongs to the overlay: the page's controls are its
  // own bar, above the paper.
  assert.match(SHEET, /\{footer \|\| variant === 'page' \? null : \(/);
  // ...and the overlay path is untouched: still portaled, still the dialog.
  assert.match(SHEET, /return createPortal\(\s*\n\s*<div className=\{`print-overlay/);
  // The desk and the paper's own shadow, so a page does not read as a dialog.
  assert.match(SHARED, /\.sheet-page \{/);
  assert.match(SHARED, /\.sheet-page__scroll \{/);
});
