// BlueWrite — THE PAPER SHOWS THE BLOTTER'S WORDS, NOT THE ACCOUNT'S.
//
// The sheet is a drawing, and only a drawing test can see it: the quoted
// title upper-cased and in place, the recorder named or the line blank — and
// the signed-in account nowhere on the paper either way. Bundled with esbuild
// and rendered with react-dom/server (see renderHarness.mjs); no browser, no
// jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/sheetTitle.jsx');

test('a captioned sheet quotes the blotter wording and names its recorder', async () => {
  const { renderSheet, CAPTIONED_TS } = await load();
  const html = renderSheet(CAPTIONED_TS);
  // The caption, upper-cased through the sheet's own casing pass.
  assert.ok(
    html.includes('RECKLESS IMPRUDENCE RESULTING IN DAMAGE TO PROPERTY'),
    'the blotter wording is not on the paper',
  );
  assert.ok(!html.includes('TRAFFIC ACCIDENT'), 'the type still titles a captioned sheet');
  assert.ok(html.includes('PSSg Bastiana'), 'the recorder is not on the paper');
  // ...and the account that filed it is nowhere on it.
  assert.ok(!html.includes('keithabalo'), 'the session account is stamped on the paper');
});

test('an uncaptioned sheet falls back to the type with a blank recorder', async () => {
  const { renderSheet } = await load();
  const html = renderSheet({});
  assert.ok(html.includes('TRAFFIC ACCIDENT'), 'the type no longer titles an uncaptioned sheet');
  // The line stands (it is template), but it names nobody — not the account,
  // not a dash standing in for one.
  assert.ok(!html.includes('keithabalo'), 'the session account is stamped on the paper');
  assert.match(html, /Recorded by:<\/strong>\s*<\/p>/, 'the recorder line is not blank');
});
