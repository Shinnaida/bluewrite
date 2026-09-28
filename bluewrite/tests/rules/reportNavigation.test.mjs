// BlueWrite — the report's way back ("← Previous").
//
// The failure this guards is small and visual: on the FIRST screen there is
// nothing behind the officer, and the row used to draw a greyed-out "← Previous"
// anyway — a control that announces itself and then refuses. The way FORWARD was
// already conditional ("Proceed to …" is simply absent on the last screen); the
// way back was not, and this asserts the two ends of the walk behave alike.
//
// The behaviour was checked in the built editor in both formats (a real click on
// Proceed and back again — the button appears on screen two and is gone again on
// screen one). These assert the rules that run produced, from the source, because
// the editor is driven by state a render harness cannot reach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(
  new URL('../../src/components/Reports.jsx', import.meta.url),
  'utf8',
);

/** The JSX of one nav row, from its opening div to the closing one, with the
 *  comments taken out: these assertions are about code, and a comment that
 *  quotes the wording a change removed must not read as the wording still being
 *  there. */
function row(className) {
  const at = REPORTS.indexOf(`className="${className}"`);
  assert.notEqual(at, -1, `no .${className} row in the editor`);
  const start = REPORTS.lastIndexOf('<div', at);
  // The rows hold no nested div of their own; the next `</div>` closes them.
  const jsx = REPORTS.slice(start, REPORTS.indexOf('</div>', at));
  return jsx.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** The Previous button inside a row. */
function previousButton(jsx) {
  const at = jsx.indexOf('← Previous');
  assert.notEqual(at, -1, 'no Previous button in this row at all');
  const open = jsx.lastIndexOf('<button', at);
  return jsx.slice(open, jsx.indexOf('</button>', at) + 9);
}

test('the first section of the walk is the reporting party, which has no previous', () => {
  // The rule is about THIS screen, so the screen has to be the one the list opens
  // on — if the order ever changes, the guard has to move with it.
  const steps = REPORTS.slice(REPORTS.indexOf('const STEPPER_STEPS = ['), REPORTS.indexOf('const REVIEW_STEP'));
  assert.match(steps.match(/label: '([^']+)'/)[1], /^Reporting party$/);
});

for (const [name, className, guardToken] of [
  ['document format', 'ir-doc-nav', 'prevSlide'],
  ['stepped format', 'ir-step-nav', 'prevLabel'],
]) {
  test(`${name}: Previous is drawn only when there is somewhere to go back to`, () => {
    const jsx = row(className);
    // Rendered behind the guard…

    assert.match(
      jsx,
      new RegExp(`\\{${guardToken} \\&\\& \\(`),
      `the Previous button in .${className} is not guarded by ${guardToken}`,
    );
    // …and never drawn in a state it would refuse: no disabled attribute at all.
    assert.doesNotMatch(
      previousButton(jsx),
      /disabled/,
      `.${className} still draws a disabled Previous`,
    );
    // The bare fallback label ("← Previous", for the first screen) is gone with
    // the state it described: a drawn button always names where it goes.
    assert.doesNotMatch(
      jsx,
      /'← Previous'/,
      `.${className} still has the unnamed-Previous fallback`,
    );
    assert.doesNotMatch(
      jsx,
      /This is the first (screen|step)/,
      `.${className} still carries the tooltip for the first-screen state it no longer draws`,
    );
  });

  test(`${name}: the way forward stays conditional too`, () => {
    const jsx = row(className);
    assert.match(jsx, /\{nextSlide && \(|\{nextLabel && \(/, 'the Proceed button lost its guard');
  });
}
