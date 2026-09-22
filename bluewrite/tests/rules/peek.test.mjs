// BlueWrite — the peek: the card that answers a pointer on the dashboard's charts.
//
// Three panels now answer a hover with the same device: the hour strip, the incident
// category rank chart, and the trend chart's magnified day (`.dash-mag`, which came
// first). A fourth idiom invented per panel is how a dashboard stops looking like one
// thing, so the card, its surface and its pointer contract are asserted once here.
//
// The failures this file exists for are all silent in a screenshot:
//
//   - TWO SOURCES OF TRUTH. The card is positioned from a measured mark, but WHICH mark
//     it describes has to be the one that is lit. Both come from one piece of state per
//     panel (asserted in hourChart.test.mjs and categoryChart.test.mjs).
//
//   - A CARD THAT TAKES THE POINTER. It is drawn over the chart it describes. If it
//     accepted pointer events it would sit between the pointer and the next mark and
//     swallow the sweep — and the chart would look mysteriously "sticky", not broken.
//
//   - A CARD INSIDE THE CHART ELEMENT. Both charts are `role="img"`, and everything
//     inside one of those is presentational to assistive tech: a card rendered there
//     would be invisible to a screen reader while looking perfectly fine on screen.
//
//   - A WIDTH RESTATED IN CSS. The flip decision is arithmetic on PEEK_W, so a card
//     whose CSS width disagrees can be measured as fitting and then overflow its panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Comments out of the way FIRST: several in this project's sheets contain braces, and
// a comment with a brace in it splits a rule in half (see statusPie.test.mjs).
const styles = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const component = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');

/** Every declaration made under one selector, joined. */
function rule(selector) {
  const target = selector.replace(/\s+/g, ' ').trim();
  const found = [];
  for (const [, sel, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.replace(/\s+/g, ' ').trim() === target) found.push(body);
  }
  assert.ok(found.length >= 1, `${selector} is not declared at all`);
  return found.join('; ');
}

// Sliced by SECTION, so one chart's card cannot satisfy another chart's assertions.
// The hour chart is the last section in the file; the rank chart ends where the pie
// begins (the workload and activity sections that used to bound these are gone).
const hours = component.slice(component.indexOf('// ---- Hour-of-day histogram'));
const rank = component.slice(
  component.indexOf('// ---- Incident categories over time'),
  component.indexOf('// ---- Status pie'),
);

test("the card's width is stated once, and the CSS is the copy that must agree", () => {
  assert.ok(hours.length > 500, 'could not find HourChart in Dashboard.jsx');
  assert.ok(rank.length > 500, 'could not find CategoryRank in Dashboard.jsx');
  const declared = Number(component.match(/const PEEK_W = (\d+);/)?.[1]);
  assert.ok(Number.isFinite(declared), 'PEEK_W must be a number literal in Dashboard.jsx');
  assert.match(
    rule('.dash-peek'),
    new RegExp(`width:\\s*${declared}px`),
    "the card's CSS width and the constant the flip is computed from must be the same number",
  );
});

test('every chart panel answers a pointer with the same card', () => {
  assert.match(hours, /\{shown && \(\s*<Peek at=\{read\}>/);
  assert.match(rank, /\{readAt && \(\s*<Peek at=\{read\}>/);
  // …and the same device the trend chart's magnified day uses.
  assert.match(component, /className="dash-mag"/);
  // A SIBLING of the chart element, never a child of one: the charts are `role="img"`,
  // and a card in there would be presentational to a screen reader. Nothing but the
  // explanatory comment may sit between the chart's last element and the card.
  assert.match(
    hours,
    /<\/p>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?\{shown && \(\s*<Peek at=\{read\}>/,
    'the hour card must sit outside the role="img" strip',
  );
  assert.match(
    rank,
    /<\/p>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?\{readAt && \(\s*<Peek at=\{read\}>/,
    'the category card must sit outside the role="img" plot',
  );
  // Both wrappers are the coordinate frame the card is positioned in, so they must be
  // positioned elements — an absolutely positioned child of a static parent escapes to
  // the nearest positioned ancestor, which is somewhere else entirely.
  assert.match(hours, /className="dash-hours-wrap" ref=\{wrapRef\}/);
  assert.match(rank, /className="dash-rank" ref=\{wrapRef\}/);
  assert.match(rule('.dash-hours-wrap'), /position:\s*relative/);
  assert.match(rule('.dash-rank'), /position:\s*relative/);
});

test('the card cannot take the pointer from the mark it describes', () => {
  const peek = rule('.dash-peek');
  assert.match(peek, /position:\s*absolute/);
  assert.match(peek, /pointer-events:\s*none/, 'a card that took the pointer would swallow the sweep');
  assert.match(rule('.dash-mag'), /pointer-events:\s*none/);
  // The same surface too, so the readouts are recognisably one device.
  assert.match(peek, /background:\s*var\(--panel-raised\)/);
  assert.match(peek, /border:\s*1px solid var\(--line-bright\)/);
});

test('the category card states the standing the chart cannot print, and hides nobody', () => {
  // The order in the card is the bucket's OWN order, so the card reads as a leaderboard
  // for that slice rather than as the range's ranking again.
  assert.match(rank, /\.sort\(\(a, b\) => a\.rank - b\.rank\)/);
  // A type with nothing in the bucket is absent from it, not last in it — the same rule
  // the lines follow (see categoryRank.js).
  assert.match(rank, /\.filter\(\(r\) => r\.rank !== null\)/);
  assert.match(rank, /\{r\.rank\}\. \{r\.type\}/);
  // The count is beside every rank, here as everywhere: rank hides magnitude.
  assert.match(rank, /<em>\{fmt\.format\(r\.count\)\}<\/em>/);
});
