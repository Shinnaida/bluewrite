// BlueWrite — the progressive reveal's line splitter.
//
// splitHtmlLines cuts formatter-style html (<p> runs with <br> line breaks,
// as Arrange Only and Enhance Wording produce) into its visual lines: the
// sheet draws finished lines in their FINAL formatted html while only the
// current line types as plain words. Lossless is the contract — joining
// every block's html must return the input byte for byte — so the reveal
// converges exactly on the finished letter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitHtmlLines } from '../../src/lib/narrativeText.js';

const join = (blocks) => blocks.map((b) => b.html).join('');

test('empty input yields no blocks', () => {
  assert.deepEqual(splitHtmlLines(''), []);
  assert.deepEqual(splitHtmlLines(null), []);
});

test('a single line without breaks is one block', () => {
  const blocks = splitHtmlLines('<p><b>Place:</b> Naga City</p>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Place: Naga City');
  assert.equal(join(blocks), '<p><b>Place:</b> Naga City</p>');
});

test('<br> lines split with the break kept on the line it ends', () => {
  const src = '<p><b>Place:</b> Naga<br><b>Facts:</b> It rained.</p>';
  const blocks = splitHtmlLines(src);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, 'Place: Naga');
  assert.equal(blocks[1].text, 'Facts: It rained.');
  // Bold labels stay inked in the finished lines' html, never in the typed text.
  assert.match(blocks[0].html, /<b>Place:<\/b>/);
  assert.match(blocks[1].html, /<b>Facts:<\/b>/);
  assert.equal(join(blocks), src);
});

test('paragraph boundaries split and rejoin losslessly', () => {
  const src = '<p>First.</p><p>Second.</p>';
  const blocks = splitHtmlLines(src);
  assert.equal(blocks.length, 2);
  assert.equal(join(blocks), src);
});

test('a blank line rides with the previous block, never parks the cursor', () => {
  const src = '<p>First.<br><br>Second.</p>';
  const blocks = splitHtmlLines(src);
  assert.equal(join(blocks), src);
  assert.ok(blocks.every((b) => b.text !== ''), 'no textless block of its own');
  assert.equal(blocks.length, 2);
});

test('uppercase tags and trailing breaks round-trip', () => {
  const src = '<P><B>Place:</B> Naga<BR></P>';
  const blocks = splitHtmlLines(src);
  assert.equal(join(blocks), src);
  assert.equal(blocks[0].text, 'Place: Naga');
});

test('entities unescape in text but survive in html', () => {
  const blocks = splitHtmlLines('<p>Fish &amp; chips &nbsp; here</p>');
  assert.equal(blocks[0].text, 'Fish & chips here');
  assert.match(blocks[0].html, /&amp;/);
});
