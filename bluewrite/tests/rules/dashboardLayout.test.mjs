// BlueWrite — the dashboard's filter row, as layout.
//
// The row is one wrapped flex line of five controls: two borderless button groups
// (scope, range presets) and three `<label>`-wrapped fields (From, To, incident
// type). It has been misaligned for two unrelated reasons, and both came from CSS
// the row INHERITS rather than from the row's own rules — which is why neither
// showed up in review as anything but "the controls do not line up":
//
//   - `label { margin-bottom: 0.35rem }`, the sheet's generic form rule, meant for
//     a column of stacked fields. A `.dash-field` IS a `<label>`, and
//     `align-items: flex-end` aligns each item's bottom MARGIN edge, so the margin
//     did not space the row — it moved the line the row was aligning to, leaving
//     all three labelled fields 5.25px above the two button groups beside them.
//   - unequal control heights. Chrome draws a date input at 37.5px and a select at
//     35px from the same padding, and because every field stacks a label above its
//     control, 2.5px of control difference became 2.5px of LABEL difference too.
//
// Both are asserted here because neither throws and neither is visible in a diff.
// Measured in headless Chrome against this stylesheet, the spreads across the five
// controls went from 6.0 / 5.3 / 2.5px (tops / bottoms / heights) to 0.0 / 0.0 / 0.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Comments go first. A selector is whatever sits between the previous `}` and the
// next `{`, so a rule preceded by an explanatory comment parses as
// `/* ... */ .the-real-selector` — and since almost every rule in this sheet is
// preceded by a comment, every exact match below would miss and the test would
// fail on correct CSS. (It did.)
const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

// The exclusion chains live in the workspace sheet, and the two files that put a
// chip in the row live in the components. Comments stripped, because the prose in
// all three names the identifiers asserted below.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
// Stripped, and that is not tidiness: the exclusion chains are named in the prose
// above them, so a search over the raw sheet counts the comments as rules and the
// two chains read as three or four. (It did, first run.)
const bodyClass = strip(readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8'));
const chrome = strip(readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8'));
const dashboard = strip(readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8'));

/** Every `selector { body }` pair in the sheet, as { selector, body }. */
function rules(sheet) {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

/** A declaration's value, or undefined. */
function value(body, property) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : undefined;
}

test('the row undoes the generic label margin it inherits', () => {
  const all = rules(css);
  // The cause has to still be there, or this test is guarding nothing: if the
  // generic rule ever stops setting a bottom margin, the override below is dead
  // code and this assertion is what says so.
  const generic = all.find((r) => r.selector === 'label');
  assert.ok(generic, 'styles.css still has a bare `label` rule');
  assert.ok(
    value(generic.body, 'margin-bottom'),
    'the bare `label` rule sets a bottom margin — that is what the row has to undo',
  );
  // An `!important` here could not be undone by a class selector, which is the
  // failure that would put the row 5.25px out again with the override still in place.
  assert.doesNotMatch(generic.body, /!/, 'the generic label margin must not be !important');

  const override = all.find((r) => r.selector === '.dash-filters .dash-field');
  assert.ok(override, '.dash-filters .dash-field must reset the margin the row inherits');
  assert.equal(
    value(override.body, 'margin-bottom'),
    '0',
    'the reset must be a real zero, not a smaller margin',
  );
});

test('every control in the row is the same height', () => {
  const shared = rules(css).filter(
    (r) => r.selector.startsWith('.dash-filters') && value(r.body, 'min-height') !== undefined,
  );
  assert.equal(shared.length, 1, 'ONE rule must set the shared control height, not four drifting copies');
  const { selector, body } = shared[0];
  // All five controls: the two button groups and the three field controls. A
  // selector list that misses one leaves that control at its own height, and the
  // labels above unequal controls drift with it.
  //
  // Membership, not `includes`: a substring test passes for a MANGLED selector
  // too, because ".dash-filters .dash-scope-NOT" contains ".dash-filters
  // .dash-scope". Verified by mutating the sheet — the substring version let it
  // through, which is the whole reason this is written as a list comparison.
  const parts = selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
  for (const part of ['.dash-filters .dash-field input', '.dash-filters .dash-field select', '.dash-filters .dash-scope', '.dash-filters .dash-presets']) {
    assert.ok(parts.includes(part), `the shared height must cover ${part} (selectors: ${parts.join(' | ')})`);
  }
  const height = Number.parseFloat(value(body, 'min-height'));
  assert.ok(height >= 38, `min-height ${height}px is under the 37.5px a date input draws at itself`);
  assert.ok(height <= 44, `min-height ${height}px is taller than a form row needs — the point is to normalise, not enlarge`);
});

test('the two button groups keep their own surface, and the workspace button face is told so', () => {
  // THE THIRD THING THIS ROW INHERITS, and the one that does not read as a
  // misalignment: `.ir-body button:not(…)` is the workspace's ordinary button — a
  // fill and a hairline on all four sides — and the scope and preset chips are the
  // opposite of that. `.dash-scope button` draws SEGMENTS of one plate, with a
  // hairline only BETWEEN them, and lifts the active one. Unnamed in that list,
  // every chip grew its own fill and its own border on all four sides, so the
  // joined strip read as four loose buttons.

  // The premise first, or the exclusions below are guarding nothing: the chips are
  // only in that rule's reach because Shell wraps every page in `.ir-body`.
  assert.match(chrome, /className="main ir-body"/, 'the pages are no longer wrapped in .ir-body');

  // OWNER REQUEST (2026-10-13): the range card (scope and presets) is removed from
  // the dashboard, so the chips no longer render and need no class. The exclusion
  // list below still guards the chip rule in the stylesheet.
  assert.doesNotMatch(dashboard, /dash-chip/, 'a range chip is back on the dashboard');

  // …and BOTH chains name it — the base rule and its :hover twin, which is what
  // would otherwise put a blue border back on a control that has none.
  const chains = bodyClass.match(/\.ir-body button:not\([^)]*\)[^{]*\{/g) ?? [];
  assert.equal(chains.length, 2, 'the neutral button treatment is no longer two rules');
  for (const chain of chains) {
    assert.match(chain, /:not\(\.dash-chip\)/, 'the chips are not excluded, so they come back as separate plates');
    assert.match(chain, /:not\(\.danger\)(:hover)?\s*\{/, 'the exclusion list no longer ends on .danger');
  }

  // The chips' own rule still describes a segmented strip: no fill of its own, no
  // border of its own, one hairline on the trailing edge of each segment.
  const chip = css.match(/\.dash-scope button,\s*\n?\.dash-presets button\s*\{([^}]*)\}/);
  assert.ok(chip, 'the segmented chip rule is gone from the stylesheet');
  assert.match(chip[1], /border:\s*none/, 'a chip draws a border on all four sides');
  assert.match(chip[1], /background:\s*transparent/, 'a chip states a fill of its own');
  assert.match(chip[1], /border-right:\s*1px solid var\(--line\)/, 'the hairline between segments is gone');
  // …and the active segment is the lift, not a colour swap alone: without it the
  // strip has no way to say where it is.
  const active = css.match(/\.dash-scope button\.is-active,\s*\n?\.dash-presets button\.is-active\s*\{([^}]*)\}/);
  assert.ok(active, 'the active segment lost its own rule');
  assert.match(active[1], /background:\s*var\(--panel-raised\)/, 'the active segment no longer lifts');
  assert.match(active[1], /color:\s*var\(--cyan\)/, 'the active segment lost its accent ink');
});
