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
//
// AND IT MOVES (owner request, 2026-10-05: "add animation design into this
// part"). This is the one screen in the app that holds an officer in front of
// an unchanging panel for up to 45 seconds, so its motion is designed rather
// than decorated, in two halves that are asserted separately below:
//
//   * FIVE PARTS, FIVE JOBS. The block arrives once (it is a different screen
//     from the one it replaces); the skeleton is WRITTEN IN and then shimmers
//     (shape, then life); the dots pulse under the rotating phrase (something
//     is still going, with no claim about how far); the phrase itself is the
//     step being reported; and the bar sweeps (time passing).
//   * THE STILL FRAME IS COMPOSED, NOT PAUSED. Every looping or arriving part
//     has a `prefers-reduced-motion` off-switch, and what is left when they are
//     off is deliberate: the frozen sweep has its rest position at the track's
//     LEFT EDGE, which is what a stalled download looks like, so the still fill
//     is drawn end to end instead. That is the frame the officer on a machine
//     with animations switched off actually sees — it must not be the accident
//     of an animation stopped mid-flight.

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

/** The reduced-motion block that governs the WAIT — located by one of its own
 *  rules rather than by being the first such block in the file: styles.css
 *  carries several of them, and other files' tests read theirs. */
const reduceBlock = () => {
  const at = STYLES.indexOf('.ai-spinner { animation-duration');
  assert.ok(at >= 0, 'the wait has no reduced-motion off-switch at all');
  const open = STYLES.lastIndexOf('@media (prefers-reduced-motion: reduce)', at);
  assert.ok(open >= 0, "the wait's motion override is not inside a reduced-motion block");
  const close = STYLES.indexOf('\n}', at);
  assert.ok(close > at, 'the reduced-motion block is unterminated');
  return STYLES.slice(open, close);
};

test('every moving part of the wait can be stopped', () => {
  // The parts that loop or arrive, by name, so a sixth one added later without
  // a way off fails here rather than reaching a machine that asked for stillness.
  const rm = reduceBlock();
  for (const part of ['.ai-loading', '.ai-skeleton-line', '.ai-dots span', '.ai-loading-bar-fill']) {
    assert.match(
      rm,
      new RegExp(`${part.replace(/\./g, '\\.')}\\s*\\{[^}]*animation:\\s*none`),
      `${part} keeps moving under prefers-reduced-motion`,
    );
  }
});

test('the still frame is composed, not a frozen sweep', () => {
  const rm = reduceBlock();
  // The bar. A 42% band's rest position is the track's left edge, so freezing
  // it draws a stub that reads as a download stalled at 40% — under reduced
  // motion the fill is drawn end to end with faded ends instead.
  assert.match(
    rm,
    /\.ai-loading-bar-fill\s*\{[^}]*width:\s*100%/,
    'the still bar is a left-anchored stub, which reads as stalled progress',
  );
  // The sweep's own band is faded at BOTH ends (`transparent 0%` … `92%`); the
  // still fill keeps the accent through the middle instead and drops the lit
  // tip, because a tip with nothing moving behind it is a headlight left on.
  assert.match(rm, /var\(--cyan\)\s*24%/, 'the still bar is not drawn as an end-to-end indeterminate fill');
  assert.match(
    rm,
    /\.ai-loading-bar-fill::after\s*\{[^}]*display:\s*none/,
    'the scanning tip is still drawn with the sweep off',
  );
  // ...and the skeleton is drawn IN FULL: a line left half-written reads as a
  // stall for exactly the same reason.
  assert.match(
    rm,
    /\.ai-skeleton-line\s*\{[^}]*transform:\s*none/,
    'a skeleton line can be left half-written under reduced motion',
  );
});

test('the skeleton is written in ONCE, then kept alive', () => {
  const line = rule(STYLES, '.ai-skeleton-line');
  // Two animations on one line, and the difference between them is the design:
  // the draw-in runs once (`both`, never `infinite`) and the shimmer is the one
  // that loops.
  assert.match(line, /ai-skeleton-write[\s\S]*?\bboth\b/, 'the lines no longer draw themselves in exactly once');
  assert.match(line, /ai-skeleton-shimmer[\s\S]*?\binfinite\b/, 'the shimmer no longer loops');
  // Read from the shorthand itself, up to the NEXT animation in the list: the
  // write-in's own run must not be an `infinite` one.
  const writeEntry = line.slice(line.indexOf('ai-skeleton-write'), line.indexOf('ai-skeleton-shimmer'));
  assert.doesNotMatch(writeEntry, /infinite/, 'the draw-in replays with every shimmer pass');
  assert.match(line, /transform-origin:\s*left/, "the draw-in no longer grows from the line's own left edge");
  // The travelling highlight is the accent, not a second grey: it is the mark
  // that ties the wait to the rest of the assistant's blue.
  assert.match(line, /var\(--cyan\)\s*50%/, 'the highlight crossing the lines is no longer the accent');
  // The stagger is what makes three lines read as one movement down the block.
  assert.match(
    STYLES,
    /\.ai-skeleton-line:nth-child\(2\)\s*\{[^}]*animation-delay:/,
    'the lines shimmer in lockstep again',
  );
});

test('the bar is one object — a band and its own leading tip', () => {
  const fill = rule(STYLES, '.ai-loading-bar-fill');
  const head = rule(STYLES, '.ai-loading-bar-fill::after');
  assert.match(fill, /animation:\s*ai-bar-sweep/, 'the sweep is gone');
  assert.match(fill, /position:\s*relative/, 'the leading tip has nothing to be positioned against');
  assert.equal(head.match(/animation:/), null, 'the tip has a timer of its own and will drift out of step with its band');
  assert.match(head, /background:\s*var\(--cyan\)/, 'the leading tip is not the accent');
});

test('the think ticker is the phrase\'s own ellipsis, drawn and silent', () => {
  const at = PANEL.indexOf('className="ai-dots"');
  assert.notEqual(at, -1, 'the wait lost its thinking dots');
  const dots = PANEL.slice(at, PANEL.indexOf('</div>', at));
  assert.equal((dots.match(/<span \/>/g) || []).length, 3, 'the ticker no longer draws three dots');
  assert.match(dots, /aria-hidden="true"/, 'the ticker is announced to screen readers');
  // One dot per phase: three dots on one timer is a blinking block, not a
  // sequence — the same argument the voice orb's waveform makes.
  assert.match(STYLES, /\.ai-dots span:nth-child\(2\)\s*\{[^}]*animation-delay:/, 'the dots pulse in lockstep');
  assert.match(STYLES, /\.ai-dots span:nth-child\(3\)\s*\{[^}]*animation-delay:/, 'the third dot has no phase of its own');
});
