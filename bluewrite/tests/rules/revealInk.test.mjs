// BlueWrite — the typing reveal must type the NEW draft, never the old ink.
//
// The sheet canvas prefers letter_html over the typing seed, so landing a
// draft over kept/saved ink typed the new words invisibly behind the previous
// text (2026-11-11: the animation played the old saved report). The landing
// therefore stashes the paper's ink for Discard and clears it, and the rewind
// restores the stash instead of blanking it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('landing a draft stashes the paper ink and clears it for the reveal', () => {
  const src = code(REPORTS);
  const at = src.indexOf('function provisionalApplyAiDraft(');
  assert.notEqual(at, -1, 'provisionalApplyAiDraft is gone');
  const body = src.slice(at, src.indexOf('function keepProvisionalApply(', at));
  assert.match(body, /letterHtml: keptInk/, 'the landing no longer stashes the paper ink');
  assert.match(
    body,
    /if \(keptInk !== ''\) set\('letter_html', ''\);/,
    'kept ink no longer steps aside so the reveal can type',
  );
});

test('the rewind brings back the stashed ink instead of a blank paper', () => {
  const src = code(REPORTS);
  assert.match(
    src,
    /set\('letter_html', String\(narrativeUndo\.letterHtml \?\? ''\)\);/,
    'Discard/the next run still blanks the paper instead of restoring it',
  );
});
