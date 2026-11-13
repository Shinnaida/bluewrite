// BlueWrite — Enhance again must not let the model reshape the report.
//
// 2026-11-11: pressing Enhance again folded the field lines into the paragraph
// and swapped a name, and the mangled page landed on the paper. Two bindings
// stop that class: the press enhances THIS page in place (no rewind, no
// re-read, no re-save), and the model's answer passes through the per-line
// wording gate before it is built into a draft.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('enhanceReport runs the wording gate and builds from the guarded text', () => {
  const src = code(PANEL);
  assert.notEqual(src.indexOf('const enhanceReport'), -1, 'enhanceReport is gone');
  assert.match(
    src,
    /const guarded = guardEnhancedWording\(enhanced, sourceText\);/,
    'the model answer no longer passes the wording gate',
  );
  assert.match(src, /if \(guarded\.rejected\)/, 'a reshaped answer is no longer discarded');
  assert.match(
    src,
    /buildEnhancedDraft\(\{ enhancedText: guarded\.text, sourceText \}\)/,
    'the draft is no longer built from the guarded text',
  );
});

test('the rewind never overrides ink the officer typed on the paper (2026-11-11)', () => {
  const src = code(PANEL);
  const at = src.indexOf('const enhanceReport');
  assert.notEqual(at, -1, 'enhanceReport is gone');
  const body = src.slice(at, src.indexOf('await runAccountRead(accountText', at));
  assert.match(
    body,
    /if \(restoredRun\.narrative !== undefined && enhancePaper === ''\)/,
    'the restored snapshot once again overrides the paper ink — edits go back to the original',
  );
});

test('every run reads the paper, never the rewound snapshot it replaced', () => {
  // 2026-11-13: Generate, Arrange and Tighten read the officer's ink, then let
  // beginFreshRun's rewind hand back the words the report held before the last
  // draft landed — the last saved version. The run drafted from those older
  // words and the sheet TYPED them, so corrections typed on the paper only
  // showed up again afterwards. Enhance already kept this guard; the other
  // three now keep it too: the snapshot stands only when the paper is empty.
  const src = code(PANEL);
  const guard = (fn, flag) => {
    const at = src.indexOf(fn);
    assert.notEqual(at, -1, `${fn} is gone`);
    const body = src.slice(at, src.indexOf('presentDraftResult()', at));
    assert.ok(
      body.includes(`if (restoredRun.narrative !== undefined && ${flag} === '')`),
      `${fn} lets the rewind override ink typed on the paper`,
    );
    assert.ok(
      body.includes(`const ${flag} =`),
      `${fn} no longer reads the paper ink it guards on`,
    );
  };
  guard('const generate =', 'paperAccount');
  guard('const arrangeReport', 'arrangePaper');
  guard('const enhanceReport', 'enhancePaper');
  // Tighten carries no presentDraftResult, so it is checked on its own line.
  const at = src.indexOf('const tighten =');
  assert.notEqual(at, -1, 'tighten is gone');
  const tightenBody = src.slice(at, src.indexOf('await resolveReportId()', at));
  assert.match(
    tightenBody,
    /tightenPaper !== '' \? tightenPaper : restoredRun\.narrative/,
    'tighten still runs over the rewound words instead of the paper',
  );
});

test('the translation path translates the account the press runs on', () => {
  const src = code(PANEL);
  const at = src.indexOf('const generate =');
  const body = src.slice(at, src.indexOf('presentDraftResult()', at));
  assert.match(
    body,
    /const runNarrative = paperAccount !== ''/,
    'a translated press still sends the rewound narrative instead of the edited page',
  );
});

test('re-runs re-point the mid-run guard at the rewound account (paper must change)', () => {
  const src = code(PANEL);
  // beginFreshRun rewinds the paper to the original; the guard compares the
  // live paper at arrival — still pointing at the pre-press proposal it reads
  // our own rewind as a mid-run edit and the new draft never lands (view stays).
  for (const fn of ['const generate =', 'const arrangeReport', 'const enhanceReport']) {
    const at = src.indexOf(fn);
    assert.notEqual(at, -1, `${fn} is gone`);
    const body = src.slice(at, src.indexOf('presentDraftResult()', at));
    assert.match(body, /pressAccountRef\.current = accountText;/, `${fn} never re-points the guard after the rewind`);
  }
});

test('Enhance again freezes the current edited page during the run (no original flash)', () => {
  const src = code(PANEL);
  const at = src.indexOf('const enhanceReport');
  assert.notEqual(at, -1, 'enhanceReport is gone');
  const body = src.slice(at, src.indexOf('// SHEET FORMAT - Arrange-only', at));
  assert.match(body, /if \(fromArranged\) \{[\s\S]*?paperAtPressRef\.current = \{ pending: sheetPending, letterHtml, letterEdit \}/, 'in-place enhance never refreshes the paper freeze — loading shows the stale original');
});

test('Enhance keeps its typing animation but replays prose over whole chrome+facts', () => {
  const src = code(PANEL);
  const at = src.indexOf('const enhanceReport');
  assert.notEqual(at, -1, 'enhanceReport is gone');
  const body = src.slice(at, src.indexOf('// SHEET FORMAT - Arrange-only', at));
  // The animation stays (full replay gate reopens for every enhance)…
  assert.match(body, /if \(sheet\) setSheetTyped\(false\);/, 'enhance lost its typing animation');
  // …but a wording-only polish types the prose while chrome+facts draw whole,
  // so the replay never opens on the template top that reads as the original.
  assert.match(src, /bodyOnly: draft\?\.enhanced === true,/, 'enhance no longer types prose-only');
});

test('Enhance again enhances this page in place, not a fresh run', () => {
  const src = code(PANEL);
  const at = src.indexOf('>Enhance again<');
  assert.notEqual(at, -1, 'the Enhance again button is gone');
  const before = src.slice(Math.max(0, at - 600), at);
  assert.match(
    before,
    /onClick=\{\(\) => enhanceReport\(\{ fromArranged: true \}\)\}/,
    'Enhance again no longer reuses the in-place enhance path',
  );
});
