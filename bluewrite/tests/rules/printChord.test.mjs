// BlueWrite — Ctrl+P prints the slip in Write Report.
//
// The browser's own print would print the app screen, so the chord is
// intercepted in the live editor and runs printSlip: the same save-then-print
// the Print Slip button runs. One action, two ways to reach it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
const SHORTCUTS = readFileSync(new URL('../../src/lib/shortcuts.js', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('Print Slip saves first, through one shared action', () => {
  const src = code(REPORTS);
  const at = src.indexOf('async function printSlip()');
  assert.notEqual(at, -1, 'printSlip is gone');
  const body = src.slice(at, src.indexOf('\n  }', at));
  assert.match(body, /const saved = await saveDraft\(\);/, 'the slip no longer saves before it prints');
  assert.match(body, /if \(saved\) setPrinting\(true\);/, 'the slip no longer prints the saved copy');
});

test('the button and the chord reach the same action', () => {
  const src = code(REPORTS);
  assert.match(
    src,
    /\{draft\.id && \(\s*<button type="button" onClick=\{printSlip\}>/,
    'the Print Slip button no longer runs printSlip behind its saved-report guard',
  );
  const chordAt = src.indexOf('function onPrintKey(e)');
  assert.notEqual(chordAt, -1, 'the Ctrl+P listener is gone');
  const chord = src.slice(chordAt, src.indexOf('}, [printing, finalizePreview]);', chordAt));
  assert.match(chord, /\(e\.ctrlKey \|\| e\.metaKey\)/, 'the chord ignores the Mac modifier');
  assert.match(chord, /toLowerCase\(\) !== 'p'/, 'the chord no longer answers the P key');
  assert.match(chord, /e\.preventDefault\(\);/, 'the browser print dialog is no longer suppressed');
  assert.match(chord, /printRef\.current\(\)/, 'the chord no longer runs printSlip');
  assert.match(chord, /if \(printing \|\| finalizePreview\) return;/, 'the chord fights the open sheet');
  assert.match(chord, /if \(!draftRef\.current\?\.id\) return;/, 'the chord prints an unsaved draft');
});

test('the shortcut sheet documents Ctrl+P', () => {
  assert.match(SHORTCUTS, /keys: \['P'\]/, 'Ctrl+P is handled but not listed');
  assert.match(SHORTCUTS, /label: 'Print slip'/, 'the print row lost its label');
});
