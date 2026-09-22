// BlueWrite — the info controls on the dashboard's chart panels.
//
// Each panel answers a different question with the same furniture (a wedge, a strip of
// 24 bars, two lists of bars), and the panel head has room for a title and nothing else.
// So every chart panel carries one control that opens over the chart with its own
// explanation. This file guards the three ways that goes wrong quietly:
//
//   - A PANEL WITH NO EXPLANATION. The dashboard is read by an Admin who did not write
//     it, and the interesting facts are all invisible: that the hour bars discard the
//     date, that a bar length is relative rather than a share, that "workload" counts
//     reports created rather than incidents attended. Nothing on screen is wrong when
//     one of those is missing — the panel is just unreadable to a new reader.
//
//   - COPY THAT DRIFTED. These paragraphs name specifics (the timestamp, the
//     denominator, the cut-off). Editing the query without editing the claim leaves a
//     confident sentence describing the old behaviour, which is worse than no note.
//
//   - ONE CARD FOR FIVE CONTROLS. `aria-controls` is how a screen reader gets from the
//     button to the card; an id written twice points four of the five at one panel's
//     card, and nothing visible looks broken.
//
// The wording rules live on PANEL_INFO in Dashboard.jsx: what ONE MARK is, what its size
// means, then the trap a reader would otherwise fall into.

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

const info = component.slice(component.indexOf('const PANEL_INFO = {'), component.indexOf('\nfunction Panel('));
// The workload and activity panels are gone, so there are three: the trend chart's
// control is the colour key, which carries no PANEL_INFO entry of its own.
const keys = ['status', 'hour', 'categories'];

/** The copy block for one panel, from `key: {` to the line that closes it. */
function entry(key) {
  const at = info.indexOf(`\n  ${key}: {`);
  assert.ok(at > -1, `PANEL_INFO.${key} is missing`);
  return info.slice(at, info.indexOf('\n  },', at));
}

test('every chart panel offers its own explanation', () => {
  // The trend chart's control is the colour key, which is the same panel behind it.
  assert.match(component, /<Panel title="Reports over time" aside=\{<ChartKey byType=\{chartTypes\} \/>\}>/);
  assert.match(component, /function ChartKey\(\{ byType \}\) \{[\s\S]*?<PanelInfo/);
  // The other four are plain copy — and each names ITS OWN entry, so a copy-paste
  // that left one panel explaining another chart is a test failure.
  assert.match(component, /<Panel title="Status breakdown" info=\{<PanelInfo \{\.\.\.PANEL_INFO\.status\} \/>\}>/);
  assert.match(component, /<Panel title="Reports by hour" info=\{<PanelInfo \{\.\.\.PANEL_INFO\.hour\} \/>\}>/);
  assert.match(component, /<Panel title="Incident categories" info=\{<PanelInfo \{\.\.\.PANEL_INFO\.categories\} \/>\}>/);
  assert.equal(keys.length, 3, 'one entry per non-trend chart panel');
  // The removed panels took their copy with them: a stale entry would be a paragraph
  // about a chart that is no longer on the page.
  assert.ok(!component.includes('PANEL_INFO.officers'), 'no entry for a panel that is gone');
  assert.ok(!component.includes('function OfficerRows(') && !component.includes('function Activity('));
});

test('each panel forswears the thing it cannot know, in its own words', () => {
  // The claims a reader cannot check from the picture, patterned per panel so that two
  // entries swapped or a paragraph reused would fail rather than read fine.
  const claims = {
    // A pie with two wedges is not a bug: a status with nothing in range is dropped.
    status: [/wedge/i, /share of the reports in this range/, /clock/, /workflow order/, /Draft/, /not drawn/],
    // The one panel whose numbers are NOT per-day, and not the filing timestamp.
    hour: [/hour of the day/, /date is discarded/, /HAPPENED/, /not when the report was filed/, /relative to the busiest hour/],
    // Rank over time — a question about position, not about volume.
    categories: [/RANK in each slice/, /a line breaks where its type had nothing/, /never a fall/],
  };
  const notes = keys.map((key) => {
    const e = entry(key);
    assert.match(e, /label: '/, `PANEL_INFO.${key} needs a label for the control`);
    assert.match(e, /title: '/, `PANEL_INFO.${key} needs a title for the control`);
    const note = e.match(/note: '([^']+)'/);
    assert.ok(note, `PANEL_INFO.${key} needs a note`);
    for (const pattern of claims[key]) {
      assert.match(note[1], pattern, `PANEL_INFO.${key} must say what makes IT different`);
    }
    return note[1];
  });
  assert.equal(new Set(notes).size, notes.length, 'no two panels may share one paragraph');
});

test('no panel promises a hover it does not have', () => {
  // Every chart left on the page answers a pointer, so every one of them carries a hint —
  // a hint line is a promise about behaviour, and one without the other is the bug.
  for (const key of keys) {
    assert.match(entry(key), /hint: '/, `PANEL_INFO.${key} must say what pointing does`);
  }
  // …and the hints name the input, so the reader knows how to try it.
  assert.match(entry('status'), /right-click one/);
  assert.match(entry('hour'), /←\/→/);
  assert.match(entry('categories'), /Hover or focus a name on the right/);
  // …and it names the other route into the same chart, because a reader who only knows
  // about hovering one of the two dimensions will never find the other.
  assert.match(entry('categories'), /Hover the plot, or focus it and walk with ←\/→/);
  // The trap the rank chart carries, said out loud rather than left to be discovered:
  // a line can lead on four reports, so the counts are printed beside every position.
  assert.match(entry('categories'), /Rank says nothing about how many reports/);
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
    'a hardcoded id used by five controls would point every aria-controls at the first card',
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
