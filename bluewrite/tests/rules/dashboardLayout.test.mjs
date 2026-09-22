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
