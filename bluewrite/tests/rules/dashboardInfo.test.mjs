// BlueWrite — the explanations the dashboard offers, and the ones it does not.
//
// The page answers with drawings that hide their own rules: stacked bands whose
// order IS the ranking, a donut whose slices come from the trend's own ramp, a
// grid whose four boxes were measured server-side. The one control that opens an
// explanation is the trend's colour key; the trio below it carries none, the
// way the reference draws it. This file guards both directions that goes wrong
// quietly:
//
//   - AN EXPLANATION WITH NOTHING BEHIND IT. A `?` control that opens an empty
//     card is worse than no control — ChartKey renders nothing when the range
//     is empty, so there are no colours to explain.
//
//   - COPY THAT DRIFTED. The note names specifics (which band sits on the axis,
//     what the number counts). Editing the stacking without editing the claim
//     leaves a confident sentence describing behaviour that is gone.
//
//   - TWO CONTROLS, ONE CARD. `aria-controls` is how a screen reader gets from
//     the button to the card; an id written twice points both at one panel,
//     and nothing visible looks broken.

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

test('the trend head carries the key and the range, and nothing else', () => {
  // The head's aside is the colour key and the one range control for the page —
  // Last 5 / 7 / 14 / 30 days — the reference's own arrangement. The key is still in
  // the head's `aside` rather than the only thing there.
  assert.match(
    component,
    /aside=\{\s*<>[\s\S]{0,400}?<ChartKey byType=\{chartTypes\} \/>/,
    'the trend panel’s head no longer carries the colour key',
  );
  assert.match(
    component,
    /aside=\{\s*<>[\s\S]{0,600}?<RangeSelect preset=\{preset\} onPick=\{applyPreset\} \/>/,
    'the trend panel’s head no longer carries the range it reads',
  );
  assert.match(component, /function ChartKey\(\{ byType \}\) \{[\s\S]*?<PanelInfo/);
});

test('the key says what the stacking means, in its own words', () => {
  const at = component.indexOf('function ChartKey(');
  const body = component.slice(at, component.indexOf('function StackedColumns('));
  // Which band sits where, and why: the order IS the ranking, most frequent at
  // the axis. A reader who takes the top band for the commonest incident is
  // reading the chart backwards, which is the trap this note exists for.
  assert.match(body, /most frequent at the axis/);
  assert.match(body, /stack from the bottom up/);
  // The number beside each name is a count in this range, not a share.
  assert.match(body, /how many reports of that type were filed in this range/);
  // …and the hint names the input the drawing hides: the right button.
  assert.match(body, /Right-click a day/);
  // An empty range draws no control at all rather than one that opens nothing.
  assert.match(body, /if \(!byType\.length\) return null;/);
});

test('the trio carries no explanation controls of its own', () => {
  // The reference draws Incident Types, Top Locations and System Status with a
  // mark, a name and a sub-line — no `?` circle. A Panel `info` on any of them
  // would be a control the design does not have.
  for (const title of ['Incident Types', 'Top Locations', 'System Status']) {
    const at = component.indexOf(`title="${title}"`);
    assert.ok(at > -1, `the ${title} panel is missing`);
    const head = component.slice(Math.max(0, at - 200), at + 300);
    assert.doesNotMatch(head, /info=\{/, `the ${title} panel grew an info control`);
  }
  // The donut reads the three busiest types, everything else as Others — in
  // blue and yellow only (owner request, 2026-10-30), so the page stays in
  // the station's two colours.
  assert.match(component, /cats\.slice\(0, 3\)/);
  assert.match(component, /\{ label: 'Others', count: rest/);
  assert.match(component, /DONUT_HUES/);
  assert.doesNotMatch(component, /rampColor\(rank >= 0 \? rank : 9\)/, 'the donut is back on the chart ramp');
});

test('the control is one disclosure, and its card id is unique per panel', () => {
  assert.match(
    component,
    /import React, \{[^}]*useId[^}]*\} from 'react'/,
    'the id has to come from the renderer, not from a name',
  );
  assert.match(component, /const panelId = `\$\{useId\(\)\}-info`/);
  assert.ok(
    !component.includes('dash-chart-key'),
    'a hardcoded id used by five controls would point every aria-controls at the first panel',
  );
  // The disclosure contract, unchanged from the key it grew out of.
  assert.match(component, /aria-expanded=\{open\}/);
  assert.match(component, /aria-controls=\{panelId\}/);
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /title=\{title\}/, 'the pointer wants the short version');
  assert.ok(component.includes("if (e.key === 'Escape') setOpen(false)"));
  assert.ok(component.includes("document.addEventListener('mousedown', onDown)"));
  // A control that opens an empty card is worse than no control.
  assert.match(component, /function ChartKey\(\{ byType \}\) \{\n\s+\/\/[\s\S]*?if \(!byType\.length\) return null;/);
});

test('the panel head holds the aside and the control on one line', () => {
  const aside = rule('.dash-panel__aside');
  assert.match(aside, /display:\s*inline-flex/, 'aside text and the control share the head line');
  assert.match(aside, /align-items:\s*center/, 'a 22px circle beside 12px text needs centring');
  assert.match(aside, /gap:/);
  // The card opens LEFTWARD from a control near the panel’s right edge, so on the
  // narrowest window only this keeps it on screen.
  assert.match(rule('.dash-key__panel'), /max-width:\s*calc\(100vw - 24px\)/);
  // Open is a state the control can show without motion.
  assert.match(rule(".dash-key__trigger[aria-expanded='true']"), /background:\s*var\(--cyan-bg\)/);
});
