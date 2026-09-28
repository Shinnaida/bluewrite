// BlueWrite — Panel I's field order (Reporting Party Information).
//
// The station asked for the contact number UNDER the full name. That is one
// class on the panel's sub-grid plus one rule in incident-report.css, and the
// failure mode is silent: `.ir-sub` is a two-column grid shared with every other
// panel, so if the `--stack` modifier is dropped — by an edit, or by someone
// re-copying the card — Panel I quietly goes back to name|contact side by side
// and nothing throws, nothing logs, and no other test notices.
//
// Measured in the built editor before these were written (1440px, document
// format, empty report): with the modifier the card's content box is one 355.5px
// column and the three fields sit at y=346.9 / 415.2 / 483.5, all at x=19, all
// 355.5 wide (100% of the box); with the modifier removed from the SAME live DOM
// the grid goes back to 168.4px + 168.4px and the contact number is at
// x=206.1, y=346.9 — beside the name. Panel II measured 168.375px + 168.391px
// both times, so the modifier is the only thing that moved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out: these assertions are about code, and a
 *  comment that explains the layout must not read as the layout itself. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** Panel I's card, from its IrCard opening tag to the next close. Comments
 *  stripped first, so the field order read here is the order React is handed. */
function panelI() {
  const src = code(REPORTS);
  const at = src.indexOf("title=\"Reporting Party Information\"");
  assert.notEqual(at, -1, 'Panel I (Reporting Party Information) is gone from the editor');
  const start = src.lastIndexOf('<IrCard', at);
  return src.slice(start, src.indexOf('</IrCard>', at));
}

/** The declaration block of one CSS rule, comments stripped. */
function rule(css, selector) {
  const src = code(css);
  const at = src.search(new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{`, 'm'));
  assert.notEqual(at, -1, `no ${selector} rule in incident-report.css`);
  const open = src.indexOf('{', at);
  return src.slice(open + 1, src.indexOf('}', open));
}

test('Panel I stacks its fields: one column, name then contact then address', () => {
  const jsx = panelI();

  assert.match(
    jsx,
    /className="ir-sub ir-sub--stack"/,
    'Panel I no longer carries the ir-sub--stack modifier, so its fields are two columns again',
  );

  // THE ORDER. The contact number must come after the name in the DOM — the
  // grid stacks in source order, so this is what puts it underneath.
  const fields = ['r-reporter-name', 'r-reporter-contact', 'r-reporter-address'].map((id) =>
    jsx.indexOf(`id="${id}"`),
  );
  fields.forEach((at, i) => assert.notEqual(at, -1, `field ${i} of Panel I is missing`));
  assert.ok(
    fields[0] < fields[1] && fields[1] < fields[2],
    'Panel I fields are not in the order name → contact → address',
  );

  // The address keeps the spanning class: it means "the card's whole measure",
  // which stays true whether the sub-grid is one column or two.
  const addressDiv = jsx.slice(jsx.lastIndexOf('<div className="ir-field', fields[2]), fields[2]);
  assert.match(addressDiv, /ir-span-2/, 'the address field lost its full-width class');
});

test('the stack is Panel I only, not every panel that shares .ir-sub', () => {
  const src = code(REPORTS);
  const uses = src.match(/ir-sub--stack/g) || [];
  assert.equal(
    uses.length,
    1,
    `ir-sub--stack is used ${uses.length} times: it is Panel I's one-column layout, and every other panel is still a two-column sub-grid`,
  );
});

test('.ir-sub--stack is a single column and wins over .ir-sub on source order', () => {
  const block = rule(CSS, '.ir-sub--stack');
  assert.match(
    block,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
    '.ir-sub--stack does not set a single column',
  );
  assert.doesNotMatch(block, /repeat\(2/, 'the stacked variant asks for two columns');

  // Equal specificity to `.ir-sub`, so it only wins by coming after it. If it is
  // ever hoisted above, the panel silently reverts with no other symptom.
  const src = code(CSS);
  assert.ok(
    src.search(/^\s*\.ir-sub\s*\{/m) < src.search(/^\s*\.ir-sub--stack\s*\{/m),
    '.ir-sub--stack is declared before .ir-sub, so .ir-sub wins and Panel I is two columns',
  );
});
