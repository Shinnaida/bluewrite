// BlueWrite — Ctrl+S saves the draft, even mid-sentence.
//
// The officer presses save with the cursor still in the narrative or on the
// paper, so the chord must be answered BEFORE the typing-target guard —
// refusing it there is what let the browser's own "save this page" appear
// over an unsaved incident report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SHELL = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
const SHELL_MIRROR = readFileSync(new URL('../../src/components/layout/Shell.jsx', import.meta.url), 'utf8');
const SHORTCUTS = readFileSync(new URL('../../src/lib/shortcuts.js', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('the save chord is answered before the typing guard', () => {
  for (const [name, src] of [['Shell', SHELL], ['layout/Shell', SHELL_MIRROR]]) {
    const clean = code(src);
    const chord = clean.indexOf('if (isSaveChord(e))');
    assert.notEqual(chord, -1, `${name} no longer answers the save chord`);
    const typing = clean.indexOf('if (isTypingTarget(e.target)) return;');
    assert.notEqual(typing, -1, `${name} lost its typing guard`);
    assert.ok(
      chord < typing,
      `${name} refuses Ctrl+S while the officer is typing — the browser's save-page dialog wins`,
    );
    const block = clean.slice(chord, clean.indexOf('if (isTypingTarget(e.target)) return;', chord));
    assert.match(block, /e\.preventDefault\(\);/, `${name} lets the browser keep its own save dialog`);
    assert.match(block, /saveRef\.current\?\.\(\);/, `${name} no longer reaches the open report's save`);
  }
});

test('the chord is still documented as Save draft', () => {
  assert.match(SHORTCUTS, /label: 'Save draft'/, 'the shortcut sheet lost Save draft');
  assert.match(SHORTCUTS, /withMod: true/, 'Save draft lost its Ctrl modifier mark');
});
