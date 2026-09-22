// BlueWrite — the "Reports by hour" strip and the card that reads it.
//
// A histogram of 24 near-identical rectangles is read by POINTING at one of them: the
// axis under it is four labels at six-hour intervals, so nothing but the pointer says
// which hour is being asked about. That makes the card the panel's whole answer for one
// hour (the line under the strip stays the whole range's fact — see barPeek.test.mjs for
// the card itself), and it makes these failures invisible in a screenshot:
//
//   - TWO SOURCES OF TRUTH. The lit bar, the recession and the card have to come from
//     the same state. If they ever don't, the panel states one hour's count under
//     another hour's highlight, and the picture looks entirely fine while being wrong —
//     the same class of failure the pie's lift test guards (see statusPie.test.mjs).
//
//   - A BAR FOR NOTHING. The panel floors a bar at 3% so a one-report hour beside a busy
//     one is still visible. Applied to hours with NO reports, that floor turned every
//     empty hour into a small but real-looking mark, which in a chart of counts is a
//     claim rather than a rendering nicety.
//
// One more thing is asserted because it was REMOVED: each bar used to carry a native
// `title`. That is a second readout — a second late, and it covers the chart it is
// describing. The card replaced it, and only one of them may exist.

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

// The hour chart is the LAST section of the file now that the workload and activity
// panels are gone, so the slice runs from its marker to the end.
const chart = component.slice(component.indexOf('// ---- Hour-of-day histogram'));

test('the hour chart is findable, reads the range payload, and keeps one piece of state', () => {
  assert.ok(chart.length > 500, 'could not find HourChart in Dashboard.jsx');
  // ONE WINDOW: the dashboard's own range, like every other panel on the page.
  assert.match(chart, /function HourChart\(\{ hours \}\)/);
  assert.match(component, /<HourChart hours=\{data\?\.hourHistogram \?\? \[\]\} \/>/);
  assert.equal((chart.match(/useState\(/g) ?? []).length, 1, 'the strip keeps exactly one piece of state');
});

test('the lit bar and the printed number read the SAME hour', () => {
  // The bug this exists for: a card wired to the bar's index while the highlight is
  // wired to the hour states 14:00's count beside the 15:00 bar drawn as active — and
  // nothing about the picture says so.
  assert.match(
    chart,
    /const shown = active == null \? null : hours\.find\(\(h\) => h\.hour === active\)/,
    'the readout must be looked up by the hour, not by a position in the array',
  );
  assert.match(chart, /const lit = h\.hour === active;/, 'the lit bar must be the same hour the card names');
  assert.match(chart, /className=\{`dash-hour\$\{lit \? ' is-active' : ''\}/);
  // The card opens for the pointed-at hour, and only for the pointed-at hour.
  assert.match(chart, /\{shown && \(\s*<Peek at=\{read\}>/);
  // …while the line under the strip stays the range's own fact, so it never becomes a
  // second place that claims to know which bar is being read.
  assert.match(chart, /Busiest hour: <strong>/);
  const note = chart.slice(
    chart.indexOf('dash-hours__note'),
    chart.indexOf('</p>', chart.indexOf('dash-hours__note')),
  );
  assert.ok(!note.includes('{shown'), 'the line must not change with the pointer — the card is what answers it');
});

test('a zero hour draws nothing, so the strip never invents a report', () => {
  assert.match(chart, /\{h\.count > 0 && \(/, 'the floor must apply only to hours that HAVE reports');
  assert.equal(
    (chart.match(/Math\.max\(3,/g) ?? []).length,
    1,
    'the 3% floor is a floor, not a minimum height for every bar',
  );
  assert.match(chart, /height: `\$\{Math\.max\(3, \(h\.count \/ max\) \* 100\)\}%`/);
});

test('the hours that are not being read recede, by the dashboard\'s own value', () => {
  assert.match(chart, /const muted = active != null && !lit;/, 'the recession is derived from the read state');
  assert.match(chart, /className=\{`dash-hour\$\{lit \? ' is-active' : ''\}\$\{muted \? ' is-muted' : ''\}`\}/);
  const muted = styles.match(/\.dash-hour\.is-muted \.dash-hour__bar \{ opacity:\s*[\d.]+/)?.[0] ?? '';
  const seg = styles.match(/\.dash-seg\.is-muted \{ opacity:\s*[\d.]+/)?.[0] ?? '';
  assert.match(muted, /opacity:\s*0\.4/, 'the strip recedes by the shared 0.4');
  assert.match(seg, /opacity:\s*0\.4/, '…the same one the trend chart uses, or "not being read" stops meaning one thing');
});

test('there is ONE readout, not two', () => {
  // A native tooltip per bar was the old behaviour, and it is the cheap way to
  // reintroduce a second answer to the same question.
  assert.ok(
    !chart.includes('title={`'),
    'the per-bar native tooltip is a second readout — the card carries it',
  );
});

test('the keyboard reads the strip: one tab stop, stopping at both ends', () => {
  assert.equal((chart.match(/tabIndex=\{/g) ?? []).length, 1, 'one tab stop for the strip, not twenty-four');
  assert.match(chart, /tabIndex=\{0\}/);
  assert.match(chart, /e\.key !== 'ArrowLeft' && e\.key !== 'ArrowRight'/, 'the arrow keys walk the hours');
  assert.match(chart, /Math\.min\(23, Math\.max\(0, /, 'the walk stops at both ends of the day');
  assert.ok(!chart.includes('% hours.length'), 'a day is not a cycle: the walk must not wrap');
  // Leaving the strip closes the card — with the pointer AND with the keyboard, which
  // are two different events.
  assert.match(chart, /onMouseLeave=\{\(\) => setRead\(null\)\}/);
  assert.match(chart, /onBlur=\{\(\) => setRead\(null\)\}/);
  assert.match(chart, /if \(e\.key === 'Escape'\)/);
  // The walk moves the CARD, and it finds the hour's own column by the hour it IS: an
  // index would be right only while the server's zero-fill stayed in clock order.
  assert.match(
    chart,
    /readHour\(next, wrapRef\.current\?\.querySelector\(`\[data-hour="\$\{next\}"\]`\)\)/,
    'the keyboard route must land the card on the hour it just read',
  );
  assert.match(chart, /data-hour=\{h\.hour\}/);
});

test('the readout reserves its line, and the highlight is a state in a token', () => {
  const note = rule('.dash-hours__note');
  assert.match(note, /min-height:/, 'the line must be reserved, or reading an hour moves the panel');
  assert.match(note, /font-variant-numeric:\s*tabular-nums/, 'the hour, the count and the share all change width');

  // A token, so the track is the palette's tint in both themes rather than a literal.
  assert.match(rule('.dash-hour.is-active'), /background:\s*var\(--cyan-bg\)/);
  assert.match(rule('.dash-hour.is-active .dash-hour__bar'), /opacity:\s*1/);
  // The old rule brightened the bar on :hover alone. It is gone on purpose: one device,
  // driven by the state the card reads.
  assert.ok(
    !styles.includes('.dash-hour:hover'),
    'the hover-only highlight must be gone — it would light a bar without the readout',
  );
});

test('the strip is one grid of 24 columns, scaled by the payload', () => {
  // 24 fixed columns, so bar N is hour N without the CSS needing to know the hours.
  assert.match(rule('.dash-hours'), /grid-template-columns:\s*repeat\(24, 1fr\)/);
  assert.match(chart, /const max = Math\.max\(\.\.\.hours\.map\(\(h\) => h\.count\)\)/);
  // …and the emptiness case is a note, not twenty-four zero-height bars under an axis.
  assert.match(chart, /hours\.every\(\(h\) => h\.count === 0\)/);
});

test('the strip\'s motion is optional, its state is not', () => {
  const block = styles.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(block, /\.dash-hour \{ transition: background-color/);
  assert.match(block, /\.dash-hour__bar \{ transition: opacity/);
  // The track and the brightening are STATES, so they live outside the query — a
  // reader who asked for less motion still sees which hour they are on, instantly.
  for (const decl of ['background: var(--cyan-bg)', 'opacity: 1']) {
    assert.ok(
      styles.split('prefers-reduced-motion').some((part) => part.includes(decl)),
      `${decl} must be reachable without motion`,
    );
  }
});
