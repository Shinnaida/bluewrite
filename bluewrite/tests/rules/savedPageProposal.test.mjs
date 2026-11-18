// BlueWrite — a saved page must replace the panel's proposal, never replay it.
//
// 2026-11-14: Arrange → hand-edit the paper → Save → Enhance typed the FIRST
// Arrange output instead of the edited + saved page. The model call already
// read the live paper (ink, else the narrative field), but the panel's
// proposal (`draft` → `sheetPending`) was never refreshed by the save — so the
// next press froze `{ pending: sheetPending, ... }` (the first arrangement)
// into `paperAtPressRef` and the paper drew/replayed that stale proposal for
// the whole run. The fix: every explicit save notifies the panel (`savedTick`)
// and the panel refreshes its proposal to the saved page (review-box typing
// and arranged/enhanced flags kept). The snapshot, autosave gate and
// Keep/Discard rules (§9) stay exactly as they were.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url), 'utf8');
const REPORTS = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment quoting code reads as code. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('an explicit save notifies the panel (savedTick)', () => {
  // Reports bumps the tick on every successful explicit save, next to the
  // unconditional setAiDraftPersisted(true) — and hands it to the panel.
  const src = code(REPORTS);
  assert.match(src, /const \[savedTick, setSavedTick\] = useState\(0\)/, 'saveDraft never bumps a saved tick');
  assert.match(src, /setSavedTick\(\(t\) => t \+ 1\)/, 'the tick is not bumped on save');
  assert.match(src, /savedTick=\{[^}]*savedTick[^}]*\}/, 'the tick is not handed to the panel');
  // The bump sits in the save-success path: right beside the persisted flag —
  // never on failure, never on a background write.
  const at = src.indexOf('async function saveDraft()');
  assert.notEqual(at, -1, 'saveDraft is gone');
  const body = src.slice(at, src.indexOf('async function printSlip()', at));
  assert.ok(body.includes('setAiDraftPersisted(true)'), 'the unconditional persisted flag is gone');
  assert.ok(
    body.includes('setSavedTick((t) => t + 1)'),
    'the tick is not bumped beside the persisted flag',
  );
});

test('the panel refreshes its proposal to the saved page on that tick', () => {
  const src = code(PANEL);
  assert.match(src, /savedTick = 0/, 'the panel does not accept the saved tick');
  const at = src.indexOf('savedTick');
  assert.notEqual(at, -1, 'savedTick is gone');
  // An effect keyed on the tick copies the saved page into the proposal…
  assert.match(
    src,
    /useEffect\(\(\) => \{[\s\S]*?savedTick[\s\S]*?setDraft\(/,
    'no effect refreshes the proposal when the page is saved',
  );
  // …narrative, findings and status — never a stale first arrangement.
  const body = src.slice(at);
  assert.ok(body.includes('narrative,'), 'the refresh does not take the saved narrative');
  assert.ok(body.includes('notableFindings') || body.includes('findingsText'), 'the refresh does not take the saved findings');
  assert.ok(body.includes('actionTaken') || body.includes('statusText'), 'the refresh does not take the saved status');
});

test('the refresh keeps review-box typing and the arranged/enhanced flags', () => {
  const src = code(PANEL);
  const at = src.indexOf('savedTickSeen');
  assert.notEqual(at, -1, 'the save-refresh effect is gone');
  const body = src.slice(at, at + 3000);
  // Spread first: flags, gaps, suspect lines and everything else survive.
  assert.match(body, /setDraft\(\(d\) =>/, 'the refresh does not map over the kept draft');
  assert.ok(body.includes('...d'), 'the refresh drops the kept draft instead of updating it');
  // Box-local typing (findingsText/statusText the officer typed in review)
  // is not in the report until Accept carries it over — the save must not
  // eat it, so it wins over the saved page where it holds newer typing.
  assert.ok(body.includes('findingsText'), 'the refresh can eat review-box findings typing');
  assert.ok(body.includes('statusText'), 'the refresh can eat review-box status typing');
});

test('the refresh only runs when the proposal is the page', () => {
  // A proposal the arrival effect held back (mid-run edits — press Keep to
  // confirm) must survive a save untouched, or Keep would confirm words the
  // officer never reviewed. Applied proposals and the satisfied receipt are
  // the page, so only those refresh.
  const src = code(PANEL);
  const at = src.indexOf('savedTickSeen');
  assert.notEqual(at, -1, 'the save-refresh effect is gone');
  const body = src.slice(at, at + 3000);
  assert.ok(
    body.includes("provisionalState !== 'applied'") && body.includes('satisfiedSaved'),
    'the refresh runs even on a proposal the paper does not hold',
  );
});

test('every press still reads the live paper once and guards the arrival', () => {
  // Single source per press: canvas ink when it holds an account, else the
  // narrative field — one string for the model call, the guard source,
  // pressAccountRef, the run freeze and the typewriter target. Never the
  // panel proposal, never the original upload.
  const src = code(PANEL);
  for (const fn of ['const generate =', 'const arrangeReport', 'const enhanceReport']) {
    const at = src.indexOf(fn);
    assert.notEqual(at, -1, `${fn} is gone`);
    const body = src.slice(at, src.indexOf('presentDraftResult()', at));
    assert.ok(
      body.includes('letterHtmlToAccountText(letterHtml)'),
      `${fn} no longer reads the live paper ink`,
    );
    assert.match(body, /pressAccountRef\.current = accountText;/, `${fn} never points the mid-run guard at the run account`);
  }
  // The arrival effect stays quiet while the receipt stands, and still
  // refuses to auto-apply over mid-run edits.
  assert.match(src, /if \(satisfiedSaved\) return;/, 'the arrival effect no longer stays quiet while saved');
  assert.match(src, /pressAccountRef\.current/, 'the mid-run edit guard is gone');
});

test('Save still keeps the original snapshot (§9: Discard-after-save restores the original)', () => {
  // The refresh updates the PROPOSAL only. The pre-AI original, the
  // unconditional persisted flag, the autosave gate and Keep-as-the-only-
  // confirm stay exactly as they were.
  const panel = code(PANEL);
  const satisfied = panel.indexOf('const satisfiedSave');
  assert.notEqual(satisfied, -1, 'satisfiedSave is gone');
  const saveBody = panel.slice(satisfied, panel.indexOf('const satisfiedDiscard', satisfied));
  assert.ok(!saveBody.includes('setNarrativeUndo(null)'), 'Save now drops the original — Discard-after-save breaks');
  assert.match(saveBody, /setProvisionalState\('idle'\)/, 'Save no longer idles the lifecycle');
  const reports = code(REPORTS);
  assert.match(reports, /setAiDraftPersisted\(true\)/, 'the unconditional persisted flag is gone');
  assert.match(
    reports,
    /if \(narrativeUndo !== null && !aiDraftPersisted\) return undefined;/,
    'the autosave gate is gone',
  );
  assert.match(reports, /function restoreProvisionalSnapshot/, 'the Discard path is gone');
});

test('a second arrival clears the previous draft ink so the sheet shows the new words (2026-11-19)', () => {
  // "what you said you enhance in the side should be shown in the sheet, when
  // pressing Enhance again": the canvas prefers letter_html over the fields, so
  // the ink the previous draft left behind kept drawing its own page while the
  // new wording typed invisibly behind it — the changes card listed everything
  // the model did and the sheet never changed. Both arrivals must clear the ink
  // the draft is about to replace: the first after snapshotting the officer's
  // own words for Discard, the second because that snapshot already holds them.
  const at = REPORTS.indexOf('function provisionalApplyAiDraft');
  assert.notEqual(at, -1, 'the provisional arrival is gone');
  const body = REPORTS.slice(at, REPORTS.indexOf('function restoreProvisionalSnapshot', at));
  assert.match(body, /if \(keptInk !== ''\) set\('letter_html', ''\);/, 'the first arrival no longer clears kept ink');
  assert.match(
    body,
    /if \(String\(\(draftRef\.current \?\? \{\}\)\.letter_html \?\? ''\) !== ''\) set\('letter_html', ''\);/,
    'a re-arrival no longer clears the previous draft ink, so the sheet keeps the old page',
  );
});
