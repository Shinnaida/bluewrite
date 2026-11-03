// The Arrange paper reveal: while an Arrange press runs, the sheet paper
// itself shows what is happening (reading → arranging → typing) with a
// status pill, a shimmer sweep and a live caret riding the typewriter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url), 'utf8');
const DOCK = readFileSync(new URL('../../src/components/reports/SheetLetterDock.jsx', import.meta.url), 'utf8');
const BODY = readFileSync(new URL('../../src/components/reports/ReportSheetBody.jsx', import.meta.url), 'utf8');
const LEGACY = readFileSync(new URL('../../src/components/ReportSheetBody.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('the arrange run phases the paper reading → arranging → typing → idle', () => {
  assert.match(PANEL, /const \[arrangePhase, setArrangePhase\] = useState\('idle'\)/, 'the phase state is gone');
  assert.match(PANEL, /setArrangePhase\('reading'\)/, 'the press never enters reading');
  assert.match(PANEL, /setArrangePhase\('arranging'\)/, 'the press never enters arranging');
  assert.match(PANEL, /setArrangePhase\(sheet \? 'typing' : 'idle'\)/, 'the paper never enters typing');
  // Every exit idles the paper again — success, refusal, error, boxes, close.
  assert.ok((PANEL.match(/setArrangePhase\('idle'\)/g) ?? []).length >= 4, 'an exit leaves the paper working');
});

test('an arranged draft types into the paper instead of popping in', () => {
  // Provisional arrivals draw whole by default (sheetTyped starts true),
  // which is why Arrange used to pop: reopen the gate so the sheet types.
  assert.match(PANEL, /presentDraftResult\(\);\s*\n\s*if \(sheet\) setSheetTyped\(false\);/, 'arrange no longer reopens the paper gate');
});

test('the letter props carry the working state and idle it on landing', () => {
  assert.match(PANEL, /arranging: arrangePhase !== 'idle' \? arrangePhase : false,/, 'the paper no longer receives the working state');
  assert.match(
    PANEL,
    /onRevealComplete: \(\) => \{\s*\n\s*setSheetTyped\(true\);\s*\n\s*setArrangePhase\('idle'\);/,
    'landing no longer idles the paper',
  );
});

test('the dock forwards the working state to the sheet', () => {
  assert.match(DOCK, /arranging = false,/, 'the dock lost the default-off working state');
  assert.match(DOCK, /arranging=\{arranging\}/, 'the dock no longer forwards it to the sheet');
});

for (const [name, src] of [['live', BODY], ['legacy', LEGACY]]) {
  test(`the ${name} sheet draws the pill, the working class and the caret`, () => {
    assert.match(src, /arranging = false,/, `the ${name} sheet lost the default-off prop`);
    assert.match(src, /pr-sheet-working/, `the ${name} sheet lost the working class`);
    assert.match(src, /className="pr-work"/, `the ${name} sheet lost the status pill`);
    assert.match(src, /Reading your account/, `the ${name} pill lost the reading line`);
    assert.match(src, /Arranging the report/, `the ${name} pill lost the arranging line`);
    assert.match(src, /Typing onto the paper/, `the ${name} pill lost the typing line`);
    assert.match(src, /<span className="pr-caret" aria-hidden="true" \/>/, `the ${name} typewriter lost its caret`);
  });
}

test('the paper reveal is dressed: caret, sweep, pill, restraint', () => {
  assert.match(CSS, /@keyframes pr-caret-blink/, 'the caret never blinks');
  assert.match(CSS, /@keyframes pr-work-sweep/, 'the paper never sweeps');
  assert.match(CSS, /@keyframes pr-work-pulse/, 'the pill dot never pulses');
  assert.match(CSS, /\.pr-work \{/, 'the status pill is undressed');
  // Restraint: reduced motion parks everything, print hides it all.
  assert.match(CSS, /\.pr-caret \{ animation: none; \}/, 'reduced motion still blinks');
  const print = CSS.slice(CSS.indexOf('@media print'));
  assert.match(print, /\.pr-work \{ display: none; \}/, 'the pill would print');
  assert.match(print, /\.pr-caret \{ display: none; \}/, 'the caret would print');
});
