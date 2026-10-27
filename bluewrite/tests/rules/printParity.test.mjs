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
  assert.match(
    LEAF,
    /dangerouslySetInnerHTML=\{\{ __html: sanitizeRichHtml\(narrativeRaw\) \}\}/,
    'the rich narrative stopped rendering its stored html',
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

test('the printed leaf holds a full ordinary report on one sheet', () => {
  // Owner request: 9 inches of paper (Letter minus the 1in @page margins),
  // and a full report was landing ~130px past it — a second sheet for a
  // Noted-by line. Print keeps the screen's type sizes but spends less air:
  // smaller seals, tighter header rhythm and trimmed block spacing.
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  for (const rule of [
    /\.print-sheet \.pr-head > \.pr-seal,/,
    /\.print-sheet \.pr-org \{ font-size: 9pt; line-height: 1\.25; \}/,
    /\.print-sheet \.pr-title \{ margin: 0\.4rem 0 0\.3rem; \}/,
    /\.print-sheet \.pr-incident-type \{ margin: 0\.4rem 0; \}/,
    /\.print-sheet \.pr-narrative \{ margin: 0\.45rem 0; \}/,
    /\.print-sheet \.pr-noted \{ margin-top: 0\.35rem; \}/,
  ]) {
    assert.match(print, rule, 'the one-leaf print compaction lost a rule');
  }
});
