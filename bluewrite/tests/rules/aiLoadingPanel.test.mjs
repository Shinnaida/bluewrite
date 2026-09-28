// BlueWrite — the AI panel's WAITING state, and the box that used to be around
// it.
//
// While a draft generates, the panel shows a heading, three skeleton lines, a
// rotating status phrase and a progress bar. All of that used to sit inside a
// solid-bordered, raised-surface box — a second frame drawn inside a card that
// already has one, around content that is not a document. The border is gone; the
// content is not, and neither is the height it reserves (without it the panel
// collapses and everything under it jumps when the draft lands).
//
// The failure this guards is the tidy-up that goes one step too far: a
// de-boxing edit that also drops the skeleton, the live region or the reserved
// height, and looks fine in a diff.
//
// Measured on the built panel in a browser, with the generate request left
// hanging so the state was real: border widths 0px/0px/0px/0px, border-style
// none, background rgba(0,0,0,0), padding 0/0/0/0, box-shadow none — while the
// block still rendered "Generating your narrative", 3 skeleton bars, the progress
// bar, role="status" aria-live="polite", and a height of exactly its 180px
// min-height, aligned 0px from `.ai-inline-body`'s content edge (padding 13.5px,
// the only inset left). The draft head above it measured unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(new URL('../../src/components/AiNarrativePanel.jsx', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** The declaration block of one CSS rule, comments stripped — a comment
 *  explaining a rule must not read as the rule itself. */
function rule(css, selector) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = src.search(new RegExp(`(^|\\})\\s*${selector.replace(/\./g, '\\.')}\\s*\\{`, 'm'));
  assert.notEqual(at, -1, `no ${selector} rule in the stylesheet`);
  const open = src.indexOf('{', at);
  return src.slice(open + 1, src.indexOf('}', open));
}

test('the waiting state draws no box of its own', () => {
  const block = rule(STYLES, '.ai-loading');
  assert.match(block, /border:\s*0\s*;/, 'the waiting block still draws a border');
  assert.doesNotMatch(block, /border:\s*1px/, 'a 1px edge is back around the waiting state');
  assert.doesNotMatch(block, /background:\s*var\(/, 'the waiting block paints its own surface again');
  assert.match(block, /padding:\s*0\s*;/, 'the block re-insets itself instead of using the body padding');
});

test('the box went and the content stayed', () => {
  // The block itself is still drawn, still a live region, and still carries the
  // four things it is made of.
  assert.match(PANEL, /className="ai-loading"\s+role="status"\s+aria-live="polite"/, 'the waiting block is gone or lost its live region');
  assert.match(PANEL, /className="ai-loading-head"/, 'the waiting heading is gone');
  assert.match(PANEL, /className="ai-loading-text/, 'the rotating status line is gone');
  assert.match(PANEL, /className="ai-loading-bar"/, 'the progress bar is gone');

  // Three skeleton lines, counted rather than assumed: the shape of the draft
  // that is about to replace them.
  const skeletonAt = PANEL.indexOf('className="ai-skeleton"');
  assert.notEqual(skeletonAt, -1, 'the skeleton is gone');
  const skeleton = PANEL.slice(skeletonAt, PANEL.indexOf('</div>', skeletonAt));
  // Counted by opening className, not by the substring: one line carries the
  // `--short` modifier too, so the bare word appears four times over three bars.
  assert.equal(
    (skeleton.match(/className="ai-skeleton-line/g) || []).length,
    3,
    'the skeleton no longer draws three lines',
  );
});

test('the height it reserves is still reserved', () => {
  const block = rule(STYLES, '.ai-loading');
  const min = block.match(/min-height:\s*([\d.]+)rem/);
  assert.ok(min, 'the waiting block no longer reserves height, so the panel jumps when the draft lands');
  assert.ok(Number(min[1]) >= 8, `the reserved height shrank to ${min[1]}rem`);
});

test('the draft that arrives is still a box — only the wait lost its frame', () => {
  // The draft is an EDITABLE box (dashed), and the dashed edge is what says so.
  // Removing the wait's frame must not have taken this one with it.
  const draft = rule(STYLES, '.ai-draft');
  assert.match(draft, /border:\s*1px dashed/, 'the draft box lost its dashed edge');
  assert.match(draft, /background:\s*var\(--panel-raised\)/, 'the draft box lost its surface');
});

test('the inset the wait now relies on belongs to the panel body', () => {
  const body = rule(STYLES, '.ai-inline-body');
  const padding = body.match(/padding:\s*([\d.]+)rem/);
  assert.ok(padding, '.ai-inline-body has no padding: the waiting text would sit flush against the card edge');
  assert.ok(Number(padding[1]) > 0);
  assert.match(PANEL, /className="ai-inline-body"/, 'the waiting block is no longer inside the panel body');
});
