// BlueWrite — screen and print draw the SAME sheet.
//
// ReportPrint renders the shared ReportSheetBody with the record alone: no
// pending proposal, no editing mode, and no prose markup of its own. A rich
// narrative, rich findings or a rich disposition therefore print exactly the
// html the screen showed — parity by construction, pinned here so a second
// drawing cannot creep back in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PRINT = readFileSync(new URL('../../src/components/reports/ReportPrint.jsx', import.meta.url), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const BODY = code(PRINT);

test('print draws the shared sheet, never its own copy', () => {
  // One implementation is the point: the print dialog draws the same
  // component the screen reads, from the same record.
  assert.match(BODY, /<ReportSheetBody/, 'print no longer draws the shared sheet');
  assert.match(
    BODY,
    /report=\{report\}\s*\n\s*ts=\{ts\}/,
    'print stopped handing the sheet the record it holds',
  );
  // The print portal is the read path: nothing pending, nothing editable.
  assert.doesNotMatch(BODY, /pending=\{/, 'print draws a draft proposal');
  assert.doesNotMatch(BODY, /editable/, 'print passes an editing mode');
  // ...and no prose of its own: the facts, findings and disposition blocks
  // live in the sheet alone, so the two cannot drift.
  assert.doesNotMatch(BODY, /pr-narrative|pr-findings|pr-actions/, 'print carries its own prose markup');
});

test('the finished sheet types itself in once — auto-print stays whole', () => {
  // Owner request: the finalize review, the sheet page and the print preview
  // replay the sheet's typing sequence once over the COMMITTED values (click
  // skips, reduced-motion draws whole). The auto-print dialog never replays —
  // it prints ~150ms after load, so a mid-sequence print would be half-typed.
  assert.match(PRINT, /revealFinal=\{[^}]*!finalTyped/, 'the final letter no longer types itself in');
  assert.match(PRINT, /onRevealComplete=\{\(\) => setFinalTyped\(true\)\}/, 'the one-shot final flag never releases');
  assert.match(PRINT, /canAnimateFinal/, 'the auto-print guard is gone');
});

test('the read letter honors every ribbon alignment, justify included', () => {
  // The sanitizer normalizes the ribbon's live style="text-align: …" into
  // align="…" on p/div (see richText.test.mjs); the read-only letter must
  // honor each value it can carry, or Justify would silently read back as
  // left while Center survived. Left is explicit so it resets a centered
  // parent instead of inheriting it.
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  for (const align of ['left', 'center', 'right', 'justify']) {
    for (const surface of ['pr-narrative-html', 'pr-findings-html', 'pr-actions-html']) {
      assert.match(
        css,
        new RegExp('\\.' + surface + ' p\\[align="' + align + '"\\]'),
        surface + ' never honors align="' + align + '" on paragraphs',
      );
    }
    assert.match(
      css,
      new RegExp('\\.rt-edit p\\[align="' + align + '"\\]'),
      'the editor never honors its own align="' + align + '" after sanitize',
    );
  }
});

test('the shared sheet renders one html for screen and print', () => {
  // ReportSheetBody is what both surfaces mount: the rich read paths render
  // the stored html through the sanitizer, and the plain paths render the
  // same cased words both callers compute.
  const LEAF = code(
    readFileSync(new URL('../../src/components/reports/ReportSheetBody.jsx', import.meta.url), 'utf8'),
  );
  // The rich narrative renders through the sanitizer minus redundant header
  // paragraphs (owner request, 2026-11-02): an arranged account's own
  // opening date/time and title restate the certification line and the quoted
  // title, so the sheet skips them — the record itself is untouched. An
  // Enhance answer's closing title echo below Remarks is skipped the same
  // way (owner request, 2026-11-04). The place line then takes the
  // conclusive City of Naga spelling at render (owner request, 2026-11-02),
  // and the issuance line's requestor name prints bold, ALL CAPS and
  // underlined (owner request).
  // ...then blanks an unnamed requestor (owner request, 2026-11-16: a role is
  // not a person). No FACTS caption is placed any more (owner request,
  // 2026-11-19: the sheet adds no heading the source does not carry).
  assert.match(
    LEAF,
    /const narrativeHtml = stripStrayBraceHtml\(emphasizeIssuanceRequestorHtml\(blankUnnamedIssuanceRequestor\(correctNagaPlaceLinesHtml\(sanitizeRichHtml\(/,
    'the rich narrative stopped rendering its stored html',
  );
  assert.ok(!LEAF.includes('withFactsCaption'), 'the FACTS caption came back on the printed sheet');
  assert.match(
    LEAF,
    /stripRedundantSheetFooterHtml\(stripRedundantSheetHeaderHtml\(narrativeRaw, sheetTitle\), sheetTitle\)/,
    'the redundant header/footer strips left the rich narrative path',
  );
  assert.match(
    LEAF,
    /dangerouslySetInnerHTML=\{\{ __html: narrativeHtml \}\}/,
    'the finished letter no longer draws the one html the reveal converges on',
  );
  assert.match(
    LEAF,
    /dangerouslySetInnerHTML=\{\{ __html: sanitizeRichHtml\(findingsHtml\) \}\}/,
    'the rich findings stopped rendering their stored html',
  );
  assert.match(
    LEAF,
    /dangerouslySetInnerHTML=\{\{ __html: sanitizeRichHtml\(statusHtml\) \}\}/,
    'the rich disposition stopped rendering its stored html',
  );
});

test('a short report still fits the whole sheet, justified', () => {
  // Owner request: dynamic fill — the slack before the signature block is
  // measured from layout and becomes one gap, so a short report meets the
  // bottom of the leaf while a full report measures none. Both Arrange Only
  // and Enhance Wording read here, justified.
  const SHEET = code(
    readFileSync(new URL('../../src/components/reports/ReportSheetBody.jsx', import.meta.url), 'utf8'),
  );
  assert.match(SHEET, /className="pr-fill"/, 'the fill spacer is gone from the sheet');
  // Loop-proof by construction (2026-11-03): the height is written straight
  // to the spacer's DOM node and re-measured by a ResizeObserver — no React
  // state, so the finalize preview can never feed itself ("Maximum update
  // depth exceeded"). The old state-fill expression must not come back.
  assert.match(SHEET, /new ResizeObserver/, 'the fill is no longer re-measured from layout');
  assert.doesNotMatch(SHEET, /setFill/, 'the fill went back to React state');
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.pr-narrative \{[^}]*text-align: justify;/, 'the narrative is no longer justified');
});

test('the printed page wears the sheet itself, never a restyle', () => {
  // Owner request, 2026-11-19: "what it look like in print should look like
  // that in here". Print states no type size, margin or leading for the sheet:
  // the account and the letterhead print with the rules the desk draws, and the
  // page box holds the sheet's own 1in station margin, so the printed measure
  // and the screen measure are the same and no line breaks differently.
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  // Just this media block: from its @page box to the screen rule that follows it.
  const print = css.slice(css.indexOf('@page {'), css.indexOf('/* Screen: the portaled sheet'));
  assert.ok(print.includes('.pr-footer-block'), 'the print block moved');
  assert.doesNotMatch(print, /\.print-sheet[^{}]*\{[^}]*font-size:/, 'print restates a sheet type size');
  assert.doesNotMatch(print, /\.print-sheet \.pr-org \{ font-size/, 'print restyles the letterhead');
  assert.doesNotMatch(
    print,
    /\.print-sheet \.pr-(title|narrative|facts|section|entry|noted|footer-block) \{[^}]*margin/,
    'print restates a block rhythm',
  );
  assert.match(
    css,
    /@page \{[\s\S]*?margin: 1in;/,
    'the page box lost the sheet\'s own station margin',
  );
});
