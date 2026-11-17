// BlueWrite — the Possible-gaps advisories read as desk cards.
//
// The section is a headed panel (title, count, hint), each advisory is a
// card with a title/instruction/example split, a severity tag, a stamped
// receipt state, and a name field for the closing-line cards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PANEL = read('../../src/components/ai/AiNarrativePanel.jsx');
const CSS = read('../../src/styles.css');

test('only the required closing lines keep a panel — red, no count, no hint', () => {
  // Owner request, 2026-11-17: the advisory list was removed. What stays is
  // the two closing-line cards (Recorded by / Requested by): a certification
  // with neither must not go out, so that warning is kept and stays red.
  assert.ok(PANEL.includes('className="gap-panel"'), 'the panel wrapper is gone');
  assert.ok(PANEL.includes('Missing closing line'), 'the closing-line title is gone');
  assert.ok(PANEL.includes('closingGaps.map'), 'the closing-line cards are not rendered');
  assert.ok(PANEL.includes('RECORDED_BY_GAP'), 'the Recorded by card is not filtered for');
  assert.ok(PANEL.includes('REQUESTED_BY_GAP'), 'the Requested by card is not filtered for');
  assert.ok(PANEL.includes('gap-note-ok'), 'the stamped receipt line is gone');
  assert.ok(!PANEL.includes('Possible gaps'), 'the advisory panel came back');
  assert.ok(!PANEL.includes('gap-panel__count'), 'the count badge came back');
  assert.ok(!PANEL.includes('gap-panel__hint'), 'the hint line came back');
  assert.ok(CSS.includes('.gap-panel {'), 'the panel style is gone');
});

test('each card splits title, instruction, example and action', () => {
  assert.ok(PANEL.includes('splitGapText(g.description)'), 'the title split is not used');
  assert.ok(PANEL.includes('gap-link__title'), 'the card title is gone');
  assert.ok(PANEL.includes('gap-link__sev'), 'the severity tag is gone');
  assert.ok(PANEL.includes('gap-link__example'), 'the example chip is gone');
  assert.ok(PANEL.includes('gap-link__cta'), 'the action pill is gone');
  assert.ok(CSS.includes('.gap-link__example {'), 'the example style is gone');
});

test('a stamped card answers as done, with its name field kept', () => {
  assert.ok(PANEL.includes('is-stamped'), 'the stamped state is gone');
  assert.ok(PANEL.includes('On the paper ✓'), 'the stamped receipt text is gone');
  assert.ok(PANEL.includes('className="gap-name-row"'), 'the name field is gone');
  assert.ok(CSS.includes('.gap-link.is-stamped'), 'the stamped style is gone');
});
