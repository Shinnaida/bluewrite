import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanAccountText, buildArrangeDraft } from '../../src/lib/arrangeDraft.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PANEL = read('../../src/components/ai/AiNarrativePanel.jsx');
const REPORTS = read('../../src/pages/Reports.jsx');
const CSS = read('../../src/styles.css');
const LF = String.fromCharCode(10);
test('sheet format offers Arrange-only vs Enhance-wording, hidden while translating', () => {
  assert.ok(PANEL.includes('ai-generate-modes'), 'mode selector missing');
  assert.ok(PANEL.includes('How to generate the report'), 'radiogroup label missing');
  assert.ok(PANEL.includes('Arrange only'), 'arrange option missing');
  assert.ok(PANEL.includes('Enhance wording'), 'enhance option missing');
  assert.ok(PANEL.includes("!(nativeNarrative && effectiveSource === 'narrative')"), 'translate case must hide the modes');
});
test('sheet primary action reads Generate Report and routes by mode', () => {
  assert.ok(PANEL.includes('Generate Report'), 'Generate Report label missing');
  assert.ok(PANEL.includes("generateMode === 'arrange' ? arrangeReport() : generate()"), 'mode routing missing');
});
test('cleanAccountText collapses whitespace but keeps words and order', () => {
  const inp = ['around  10pm,  market.   ', '', '', 'Ana   took   phone.'].join(LF);
  const out = cleanAccountText(inp);
  assert.equal(out, ['around 10pm, market.', 'Ana took phone.'].join(LF));
  assert.equal(cleanAccountText('   '), '');
  assert.equal(cleanAccountText(null), '');
});
test('buildArrangeDraft shapes the proposal with no LLM content', () => {
  const d = buildArrangeDraft({ accountText: 'b  a', notableFindings: ['x', ' y '].join(LF), actionTaken: 'filed' });
  assert.equal(d.narrative, 'b a');
  assert.equal(d.arranged, true);
  assert.deepEqual(d.suggestions, []);
  assert.deepEqual(d.notableFindings, ['x', 'y']);
  assert.equal(d.findingsText, ['x', ' y '].join(LF));
  assert.equal(d.statusText, 'filed');
});
test('a filled-then-unsaved read names the save, not missing basics', () => {
  // The screenshot defect: the read filled type/date/place and the save
  // behind the id still failed, and the panel claimed the basics were
  // missing. The receipt of THIS press decides which line is honest — a
  // filled read that cannot save points at the editor banner (which carries
  // the real refusal), and only a read that filled nothing keeps the
  // three-fields line. Panel state from an earlier press must not answer.
  assert.ok(PANEL.includes('const saveBlockedMessage = (read, tail)'), 'save message helper missing');
  assert.ok(PANEL.includes('return done;'), 'the reader keeps its receipt to itself instead of handing it back');
  assert.ok(PANEL.includes("saveBlockedMessage(generateRead, 'the AI can work on it')"), 'generate ignores what its own read filled');
  assert.ok(PANEL.includes("saveBlockedMessage(arrangeRead, 'it can be arranged')"), 'arrange ignores what its own read filled');
  assert.ok(PANEL.includes('The draft could not be saved with those details'), 'refused-write line missing');
  assert.ok(!PANEL.includes("setMessage(\n        'This report is not saved yet"), 'a hard-coded three-fields line bypasses the helper');
});
test('the receipt lists each filled field once', () => {
  // Same screenshot: "Property Owners" appeared twice — the two reads name
  // overlapping labels, and the receipt concatenated them raw.
  assert.ok(REPORTS.includes('filled: [...new Set([...fill.filled, ...(details?.filled ?? [])])]'), 'receipt filled list is not deduped');
});
test('one account reader serves both Generate paths, arrange builds via the lib', () => {
  assert.ok(PANEL.includes('const runAccountRead'), 'shared reader missing');
  const uses = PANEL.split('await runAccountRead(accountText)').length - 1;
  assert.equal(uses, 2, 'both paths must call the shared reader');
  const direct = PANEL.split('await onReadAccount(accountText)').length - 1;
  assert.equal(direct, 2, 'reads happen only inside the shared reader (call + retry)');
  assert.ok(PANEL.includes('setDraft(buildArrangeDraft({ accountText, notableFindings: runFindings, actionTaken: runActionTaken }))'), 'arrange must build via the lib');
  assert.ok(PANEL.includes('Arrange is a third run entry'), 'arrange does not rewind before reading');
  assert.ok(!PANEL.includes('const cleaned = accountText'), 'inline cleaner must be gone');
});
test('a throwing draft-save cannot strand Arrange in silent loading', () => {
  // arrangeReport guards its awaits like generate() does: the save behind
  // resolveReportId can throw (expired session, network, server refusal), and
  // without this catch the panel sat in loading with the message cleared —
  // a press that appeared to do nothing.
  const at = PANEL.indexOf('const arrangeReport = async () => {');
  assert.notEqual(at, -1, 'arrangeReport is gone');
  const body = PANEL.slice(at, PANEL.indexOf('\n  };', at));
  assert.match(body, /try \{/, 'arrange no longer guards its awaits');
  assert.match(body, /\} catch \(err\) \{/, 'arrange has no failure path');
  assert.match(body, /setMode\('error'\)/, 'a failed arrange never leaves loading');
  assert.match(body, /setPanelOpen\(true\)/, 'a failed arrange never shows its reason');
});
test('arranged drafts render a visible wording-unchanged receipt', () => {
  assert.ok(PANEL.includes('ai-arranged-note'), 'receipt element missing');
  assert.ok(PANEL.includes('wording unchanged'), 'receipt must say wording is unchanged');
  assert.ok(CSS.includes('.ai-arranged-note'), 'receipt css missing');
});
test('retry repeats an arrange press', () => {
  assert.ok(PANEL.includes("lastPress.kind === 'arrange' ? arrangeReport()"), 'retry must handle arrange');
});
test('mode cards use defined tokens', () => {
  const start = CSS.indexOf('.ai-generate-modes');
  const end = CSS.indexOf('.ai-toolbar', start);
  const block = CSS.slice(start, end);
  assert.ok(block.includes('var(--steel)'), 'hint must use defined --steel');
  assert.ok(block.includes('var(--input-bg'), 'card must use defined --input-bg');
  assert.ok(!block.includes('var(--ink)'), 'undefined --ink must be gone');
  assert.ok(!block.includes('var(--muted)'), 'undefined --muted must be gone');
});
test('arrange Accept carries the flag; the record keeps manual provenance', () => {
  assert.ok(PANEL.includes('arranged: draft.arranged === true ? true : undefined'), 'accept must carry arranged');
  const at = REPORTS.indexOf('function applyAiDraft(');
  assert.notEqual(at, -1, 'applyAiDraft is gone');
  const body = REPORTS.slice(at, REPORTS.indexOf('}', REPORTS.indexOf("narrativeSourceRef.current = 'manual'", at)) + 1);
  assert.ok(body.includes("if (parts?.arranged === true) narrativeSourceRef.current = 'manual'"), 'arrange must restore manual provenance');
});
test('enhance path still marks AI provenance', () => {
  const at = REPORTS.indexOf('function applyAiNarrative(');
  assert.notEqual(at, -1, 'applyAiNarrative is gone');
  assert.ok(REPORTS.slice(at, at + 2000).includes("narrativeSourceRef.current = 'ai-assisted'"), 'AI tag missing');
});
test('both Generate results share one presenter', () => {
  assert.ok(PANEL.includes('const presentDraftResult'), 'shared presenter missing');
  const uses = PANEL.split('presentDraftResult();').length - 1;
  assert.equal(uses, 2, 'generate and arrange must present through it');
});
test('sheet home sits on the desk below the form, beside the reveal toggle', () => {
  const bar = REPORTS.indexOf('<div className="ir-sheet-ai ir-sheet-ai--bar">');
  assert.notEqual(bar, -1, 'deskbar sheet AI home is gone');
  assert.equal(REPORTS.includes('<div className="ir-sheet-ai no-print">'), false, 'on-paper sheet AI home must be gone');
  const desk = REPORTS.indexOf('<div className="ir-sheet-deskbar no-print">');
  assert.notEqual(desk, -1, 'desk row is gone');
  assert.ok(desk < bar, 'assistant must sit inside the desk row');
  // The toggle shares the row: desk row opens, then the bar home, then the
  // toggle follows in the same parent.
  const row = REPORTS.slice(desk, desk + 2000);
  assert.ok(row.includes('ir-sheet-toggle'), 'reveal toggle must share the desk row');
  assert.ok(row.includes('{draft && ('), 'bar must render on loaded draft, not only when editable');
  assert.ok(REPORTS.includes('read-only for your account'), 'locked reports must say why instead of showing nothing');
  // After the paper: the nearest form close above the desk row.
  const formClose = REPORTS.lastIndexOf('</form>', desk);
  assert.notEqual(formClose, -1, 'form close missing');
  assert.ok(formClose < desk, 'desk row must sit below the form, after it closes');
  const homes = REPORTS.split('<div className="ir-sheet-ai').length - 1;
  assert.equal(homes, 1, 'one home in the whole file');
});
test('sheet bar carries no blob frame and skips the orb face', () => {
  // No frame in the bar home: the modal look went with the card.
  const bar = REPORTS.indexOf('<div className="ir-sheet-ai ir-sheet-ai--bar">');
  assert.notEqual(bar, -1, 'deskbar home is gone');
  const home = REPORTS.slice(bar, bar + 900);
  assert.ok(!home.includes('GradientBlobCard'), 'bar home must not wrap in the blob frame');
  assert.ok(!home.includes('ir-ai-frame'), 'bar home must not carry the frame class');
  // The editor asks for the slim face in the sheet format only.
  assert.ok(REPORTS.includes('slim={sheet}'), 'slim not wired sheet-only');
  // ...and the panel honours it on the orb stage alone.
  assert.ok(PANEL.includes('{!slim && ('), 'orb stage is not gated on slim');
  assert.ok(PANEL.includes('slim = false'), 'slim must default off for the deck formats');
  // The glass override went with the frame.
  const FORM_CSS = read('../../src/incident-report.css');
  assert.ok(!FORM_CSS.includes('.ir-sheet-ai .gradient-blob-card__glass'), 'dead glass override is still in the stylesheet');
  assert.ok(FORM_CSS.includes('.ir-sheet-deskbar'), 'desk row css missing');
  assert.ok(FORM_CSS.includes('.ir-sheet-ai--bar'), 'bar css missing');
});

test('sheet provisional arrival writes on landing; Discard restores, Keep confirms', () => {
  // The editor side: snapshot + write + restore + confirm exist and are wired
  // to the panel in the sheet format only.
  assert.ok(REPORTS.includes('const [narrativeUndo, setNarrativeUndo] = useState(null)'), 'narrative snapshot missing');
  assert.ok(REPORTS.includes('function provisionalApplyAiDraft('), 'provisional apply missing');
  assert.ok(REPORTS.includes('function restoreProvisionalSnapshot('), 'provisional restore missing');
  assert.ok(REPORTS.includes('function keepProvisionalApply('), 'provisional keep missing');
  assert.ok(REPORTS.includes('onProvisionalApply={sheet ? provisionalApplyAiDraft : undefined}'), 'arrival not wired sheet-only');
  assert.ok(REPORTS.includes('onRestoreProvisional={sheet ? restoreProvisionalSnapshot : undefined}'), 'restore not wired sheet-only');
  assert.ok(REPORTS.includes('onKeepProvisional={sheet ? keepProvisionalApply : undefined}'), 'keep not wired sheet-only');
  // The panel side: plain results are gated on a terminal guided state (the
  // translation review stays a proposal), and every new run restores first so
  // the model never reads its own text.
  assert.ok(PANEL.includes('const sheetProvisional = !!sheet && guidedIsTerminal(guided);'), 'provisional gate missing');
  assert.ok(PANEL.includes('onRestoreProvisional?.()'), 'runs do not restore first');
  // Keep confirms, Discard restores, both reset and close.
  assert.ok(PANEL.includes('Discard draft'), 'Discard button missing');
  assert.ok(PANEL.includes('Keep on the paper'), 'Keep label missing');
  // One home only: the slim bar portals onto the mount (or renders nothing
  // until it is up) — no second copy in the bar. Deck formats keep the card.
  assert.ok(PANEL.includes('{sheeted && (slim'), 'in-card paper not gated');
  assert.ok(PANEL.includes('letterMount ? createPortal(<SheetLetterDock {...letterProps} />, letterMount) : null'), 'slim bar still draws a second copy');
  // Lifecycle resets: Close or a new run from a restored draft reopens the
  // lifecycle so the next arrival applies instead of stranding pending.
  assert.ok(PANEL.includes("if (provisionalState === 'pending') setProvisionalState('idle')"), 'close does not reopen pending');
  assert.ok(PANEL.includes('const restoredRun = beginFreshRun(false)'), 'generate does not reopen through the shared helper');
  // Runs read restored values first — never the draft sitting on the paper.
  assert.ok(PANEL.includes('restoredRun.narrative ?? narrative'), 'generate does not prefer restored words');
  assert.ok(PANEL.includes('notable_findings: runFindings'), 'generate sends live findings instead of restored ones');
  assert.ok(REPORTS.includes('restored.findings'), 'restore does not hand back findings');
  // Hand-edits close the narrative revert, like the fields below.
  assert.ok(REPORTS.includes("Hand-edits close the narrative revert, like the fields below"), 'edits do not close the narrative revert');
});
