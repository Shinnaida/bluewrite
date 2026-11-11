// BlueWrite — Enhance again must not let the model reshape the report.
//
// 2026-11-11: pressing Enhance again folded the field lines into the paragraph
// and swapped a name, and the mangled page landed on the paper. Two bindings
// stop that class: the press enhances THIS page in place (no rewind, no
// re-read, no re-save), and the model's answer passes through the per-line
// wording gate before it is built into a draft.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('enhanceReport runs the wording gate and builds from the guarded text', () => {
  const src = code(PANEL);
  assert.notEqual(src.indexOf('const enhanceReport'), -1, 'enhanceReport is gone');
  assert.match(
    src,
    /const guarded = guardEnhancedWording\(enhanced, sourceText\);/,
    'the model answer no longer passes the wording gate',
  );
  assert.match(src, /if \(guarded\.rejected\)/, 'a reshaped answer is no longer discarded');
  assert.match(
    src,
    /buildEnhancedDraft\(\{ enhancedText: guarded\.text, sourceText \}\)/,
    'the draft is no longer built from the guarded text',
  );
});

test('the rewind never overrides ink the officer typed on the paper (2026-11-11)', () => {
  const src = code(PANEL);
  const at = src.indexOf('const enhanceReport');
  assert.notEqual(at, -1, 'enhanceReport is gone');
  const body = src.slice(at, src.indexOf('await runAccountRead(accountText', at));
  assert.match(
    body,
    /if \(restoredRun\.narrative !== undefined && enhancePaper === ''\)/,
    'the restored snapshot once again overrides the paper ink — edits go back to the original',
  );
});

test('Enhance again enhances this page in place, not a fresh run', () => {
  const src = code(PANEL);
  const at = src.indexOf('>Enhance again<');
  assert.notEqual(at, -1, 'the Enhance again button is gone');
  const before = src.slice(Math.max(0, at - 600), at);
  assert.match(
    before,
    /onClick=\{\(\) => enhanceReport\(\{ fromArranged: true \}\)\}/,
    'Enhance again no longer reuses the in-place enhance path',
  );
});
