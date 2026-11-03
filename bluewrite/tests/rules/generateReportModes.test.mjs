import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrangeOutputIsFaithful, cleanAccountText, buildArrangeDraft, buildEnhancedDraft } from '../../src/lib/arrangeDraft.js';
import { formatIncidentReportHtml, reportHtmlToPlain, extractFieldLabels, unsupportedFieldLabels, detectIncidentTitle, stripAddedFieldRows } from '../../src/lib/reportFormat.js';
import { emphasizeIssuanceRequestorHtml } from '../../src/lib/narrativeText.js';
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
  assert.ok(PANEL.includes("generateMode === 'arrange' ? arrangeReport() : enhanceReport()"), 'mode routing missing');
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
  // Arrange applies sentence case: the first word takes a capital, no word is
  // added or corrected.
  assert.equal(d.narrative, '<p>B a</p>');
  assert.equal(d.arranged, true);
  assert.deepEqual(d.suggestions, []);
  assert.deepEqual(d.notableFindings, ['x', 'y']);
  assert.equal(d.findingsText, ['x', ' y '].join(LF));
  assert.equal(d.statusText, 'filed');
});

test('the arrange gate keeps a faithful reorder and drops a guessing one', () => {
  // The BW-0442 defect: a road-accident arrangement that named a victim and
  // a suspect the account never stated. Reordering and title-dedupe are the
  // job and pass; a name, plate or marker from nowhere fails the press.
  const account = [
    'ROAD ACCIDENT',
    'The Toyota Hilux driven by Mark Anthony Reyes collided with the Mitsubishi Mirage driven by Daniel Cruz.',
    'Three persons died and two were hurt.',
  ].join(LF);
  const faithful = [
    'ROAD ACCIDENT',
    'The Toyota Hilux driven by Mark Anthony Reyes collided with the Mitsubishi Mirage driven by Daniel Cruz.',
    'Three persons died and two were hurt.',
  ].join(LF);
  assert.equal(arrangeOutputIsFaithful(faithful, account), true, 'a reorder must pass');
  assert.equal(
    arrangeOutputIsFaithful('Victim: Ricardo Manuel Santos\nSuspect: Jerome Paul Garcia\n' + faithful, account),
    false,
    'invented victim/suspect must fail',
  );
  // Retitle-casing the account's own words is arrangement, not invention.
  assert.equal(
    arrangeOutputIsFaithful('The Toyota Hilux Driven By Mark Anthony Reyes Collided.', account),
    true,
    'the account\u2019s own words in another case must pass',
  );
  // Plates, document codes and vehicle markers obey the same rule.
  const withPlate = 'Vehicle KJ-48213 was involved.\n' + faithful;
  assert.equal(arrangeOutputIsFaithful(withPlate, account + ' Plate KJ-48213.'), true, 'a stated plate must pass');
  assert.equal(arrangeOutputIsFaithful(withPlate, account), false, 'an invented plate must fail');
  assert.equal(arrangeOutputIsFaithful('V1: Toyota Hilux.\n' + faithful, account), false, 'an invented vehicle marker must fail');
  // A harmless month shortening is not a guessed code.
  assert.equal(
    arrangeOutputIsFaithful('On Oct 24 the Hilux driven by Mark Anthony Reyes collided.', 'On October 24 the Hilux driven by Mark Anthony Reyes collided.'),
    true,
    'a month shortening must pass',
  );
  assert.equal(arrangeOutputIsFaithful('', account), false, 'an empty answer must fail');
  assert.equal(arrangeOutputIsFaithful(faithful, ''), false, 'an empty account must fail');
  // The press wires the gate: a guessing answer never reaches the paper.
  assert.ok(PANEL.includes('arrangeOutputIsFaithful(text, accountText)'), 'arrange does not gate the model answer');
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
  const uses = PANEL.split('await runAccountRead(accountText').length - 1;
  assert.equal(uses, 3, 'generate, arrange and enhance must call the shared reader');
  const direct = PANEL.split('await onReadAccount(accountText').length - 1;
  assert.equal(direct, 2, 'reads happen only inside the shared reader (call + retry)');
  // Arrange only — keep wording, add no labels not in the text.
  assert.ok(PANEL.includes('await runAccountRead(accountText, { arrangeOnly: true })'), 'arrange must pass arrangeOnly');
  assert.ok(REPORTS.includes('arrangeOnly'), 'sheet read must know arrangeOnly');
  assert.ok(REPORTS.includes("if (afterFirst.incident_type && !arrangeOnly)"), 'arrange must skip type-details');
  assert.ok(PANEL.includes('setDraft(withSheetCompletion(buildArrangeDraft({ accountText, notableFindings: runFindings, actionTaken: runActionTaken })))'), 'arrange must build via the lib');
  // Sheet theft completion (owner request): both sheet drafts run the audit —
  // fills from the officer's own words, gaps as advisories.
  assert.ok(PANEL.includes('withSheetCompletion(buildEnhancedDraft('), 'enhance skips the completion audit');
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
  // Owner request: the arranged chatter is gone — no arranged note, no
  // filled-fields pointer. The draft still carries the arranged flag (see
  // arrangeDraft.js); only the noise is removed.
  assert.ok(!PANEL.includes('ai-arranged-note'), 'arranged note is still rendered');
  assert.ok(!PANEL.includes('wording unchanged'), 'arranged chatter is still rendered');
  assert.ok(CSS.includes('.ai-arranged-note'), 'receipt css missing');
});
test('Time/Date is a label: it is bolded and named the sheet way', () => {
  // Owner request, 2026-11-02: the arranged page printed "Time/Date:" as plain
  // words, because the label vocabulary only knew the long spellings and
  // "Time/Date" is neither ALL CAPS nor long-form.
  for (const label of ['TIME/DATE', 'Time/Date', 'TIME / DATE', 'T/D OF INCIDENT', 'T / D']) {
    const html = formatIncidentReportHtml(`${label}: 8:40 AM of 10-20-26`, { sentenceCase: true });
    assert.match(html, /^<p><b>Time\/Date:<\/b> /, `"${label}" is not bolded as Time/Date`);
    assert.equal(extractFieldLabels(`${label}: x`).length, 1, `"${label}" is not read as one label`);
  }
  // Spacing around the slash is presentational: every spelling is ONE label, so
  // an answer that spaces it differently still matches the source's allow-list.
  assert.deepEqual(extractFieldLabels('Time / Date: x'), extractFieldLabels('Time/Date: x'));
  // Owner request: Time/Date sits directly below Place on the sheet, whatever
  // order the account typed them in — the short label ranks with the long one.
  const unordered = ['TITLE', '', 'Time/Date: 8:40 AM', 'Place: Naga'].join('\n');
  const ordered = formatIncidentReportHtml(unordered);
  assert.ok(
    ordered.indexOf('Place:') < ordered.indexOf('Time/Date:'),
    'Time/Date is not directly below Place',
  );
  // A clock is still a clock: a bare "8:40 AM" line is not a label.
  assert.equal(formatIncidentReportHtml('8:40 AM of 10-20-26', {}).includes('<b>'), false, 'a time was bolded as a label');
});

test('Enhance Wording cannot add rows the arranged report never carried', () => {
  // Owner request, 2026-11-02: the enhanced answer came back with a fresh
  // `Vehicle 1: Plate 0718SR` row and a `Suspected Cause:` heading lifted out
  // of the facts. Those read as extra inputs on the sheet, so they are dropped
  // while every line the source states survives.
  const source = [
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY',
    'Place of incident: Brgy Mainit',
    'Time/Date: 8:40 AM of October 20, 2026',
    'Vehicles involved:',
    'V1: Yamaha NMAX with plate #0718SR, driven by Joseph Porol.',
    'Facts:',
    "Investigation revealed that both vehicle were traveling in opposite direction, V2 encroached into V1's and accidentally hit left side portion of V1.",
    'Recorded by: Kainoa',
  ].join(LF);
  const answer = [
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY',
    'Place of incident: Brgy Mainit',
    'Time/Date: 8:40 AM of October 20, 2026',
    'Vehicle 1: Plate 0718SR',
    "Suspected Cause: V2 ENCROACHED INTO V1'S AND ACCIDENTALLY HIT LEFT SIDE PORTION OF - - V1",
    'Vehicles involved:',
    'V1: Yamaha NMAX with plate #0718SR, driven by Joseph Porol.',
    'Facts:',
    "Investigation revealed that both vehicles were traveling in opposite directions, with V2 encroaching into V1's lane and accidentally hitting the left side portion of V1.",
    'Recorded by: Kainoa',
  ].join(LF);
  const out = stripAddedFieldRows(answer, source);
  assert.equal(out.includes('Vehicle 1:'), false, 'the invented vehicle row survived');
  assert.equal(out.includes('Suspected Cause:'), false, 'the invented cause heading survived');
  assert.equal(out.includes('Plate 0718SR'), false, 'the invented row\'s value survived as stray ink');
  // Every real part of the page is still there, word for word.
  for (const line of source.split(LF).filter((l) => !l.startsWith('Investigation'))) {
    assert.ok(out.includes(line), 'lost a source line: ' + line);
  }
  assert.ok(out.includes('both vehicles were traveling in opposite directions'), 'the corrected facts were dropped');
  // A row the SOURCE opens is never an addition — V1/V2 markers survive even
  // when the model rewords them slightly.
  const reworded = ['V1: Yamaha NMAX, plate 0718SR, driven by Joseph Porol.'].join(LF);
  assert.equal(stripAddedFieldRows(reworded, source), reworded, 'a source row was treated as an addition');
});

test('the enhance path strips added rows before it audits labels', () => {
  const at = PANEL.indexOf('const enhanceReport = async (');
  assert.notEqual(at, -1, 'enhanceReport is gone');
  const body = PANEL.slice(at, PANEL.indexOf('// SHEET FORMAT - Arrange-only', at));
  const strip = body.indexOf('stripAddedFieldRows(');
  const audit = body.indexOf('unsupportedFieldLabels(');
  assert.notEqual(strip, -1, 'added rows are no longer stripped');
  assert.ok(strip < audit, 'the audit runs before the cleanup');
});

test('an arranged page offers Enhance writing from the same panel', () => {
  // Owner request, 2026-11-02: after arranging, the officer can settle with the
  // page OR polish its wording right there. The enhanced page replaces the
  // arranged one in the SAME panel — no second trip through the sidebar.
  assert.ok(
    PANEL.includes('onClick={() => enhanceReport({ fromArranged: true })}'),
    'the arranged result no longer offers Enhance writing',
  );
  assert.ok(PANEL.includes('{draft?.arranged && ('), 'the control is not scoped to an arranged draft');
  // From an arranged result nothing is rewound and nothing is read or saved
  // again: the arranged page IS the text being enhanced.
  const at = PANEL.indexOf('const enhanceReport = async (');
  assert.notEqual(at, -1, 'enhanceReport is gone');
  const body = PANEL.slice(at, PANEL.indexOf('// SHEET FORMAT - Arrange-only', at));
  assert.ok(body.includes('fromArranged ? {} : beginFreshRun(false)'), 'arrange-then-enhance rewinds the paper');
  assert.ok(body.includes('if (!fromArranged && onReadAccount)'), 'a second account read is run instead');
  assert.ok(body.includes("if (fromArranged) setProvisionalState('idle')"), 'the enhanced page is never written onto the paper');
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
  assert.equal(uses, 3, 'generate, arrange and enhance must present through it');
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
  // Owner request: closing must not change the paper — an applied draft is
  // restored on close, so only Keep confirms it.
  assert.ok(PANEL.includes("if (provisionalState === 'applied') onRestoreProvisional?.()"), 'close keeps an applied draft on the paper');
  assert.ok(PANEL.includes('const restoredRun = beginFreshRun(false)'), 'generate does not reopen through the shared helper');
  // Runs read restored values first — never the draft sitting on the paper.
  assert.ok(PANEL.includes('restoredRun.narrative ?? narrative'), 'generate does not prefer restored words');
  assert.ok(PANEL.includes('notable_findings: runFindings'), 'generate sends live findings instead of restored ones');
  assert.ok(REPORTS.includes('restored.findings'), 'restore does not hand back findings');
  // Hand-edits close the narrative revert, like the fields below.
  assert.ok(REPORTS.includes("Hand-edits close the narrative revert, like the fields below"), 'edits do not close the narrative revert');
});

test('the shared formatter bolds existing labels only and adds none', () => {
  const src = [
    '10-20-26 10:00 AM',
    '',
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
    '',
    'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
    'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
    'VEHICLES INVOLVED:',
    'V1 YAMAHA NMAX WITH PLATE 0718SR.',
    '',
    'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
    'REMARKS: Settled at the barangay.',
    'RECORDED BY : PO1 DELA CRUZ',
  ].join(LF);
  const html = formatIncidentReportHtml(src);
  assert.ok(html.includes('<b>PLACE:</b> CANGI MUNDONG'), 'place label not bolded');
  assert.ok(html.includes('<b>T/D OF INCIDENT:</b> MORE OR LESS 8:40 AM'), 't/d label not bolded');
  assert.ok(html.includes('<b>VEHICLES INVOLVED:</b>'), 'vehicles label not bolded');
  assert.ok(html.includes('<b>FACTS:</b><br>\u2003\u2003INVESTIGATION REVEALED'), 'facts label not bolded');
  assert.ok(html.includes('<b>REMARKS:</b> Settled at the barangay.'), 'remarks label not bolded');
  assert.ok(html.includes('<b>RECORDED BY:</b> PO1 DELA CRUZ'), 'recorded-by label not bolded');
  // The incident title has no separator: it stands as its own bold heading,
  // never as a field label.
  assert.ok(html.includes('<p><b>RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY</b></p>'), 'incident title is not a standalone heading');
  assert.ok(!html.includes('<b>RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY:</b>'), 'standalone incident title was treated as a field');
  // Nothing was added: the same words, with the vehicle row's V-marker bold
  // and wearing the label colon.
  assert.ok(
    html.includes('<b>V1:</b> YAMAHA NMAX WITH PLATE 0718SR.'),
    'vehicle wording changed or its marker was not bold with a colon',
  );
  assert.ok(html.includes('10-20-26 10:00 AM'), 'date/time wording changed');
  // A time on its own line is not a field label.
  const timeOnly = formatIncidentReportHtml('MORE OR LESS 8:40 AM');
  assert.ok(!timeOnly.includes('<b>'), 'a time was mistaken for a label');
});

test('enhance formats only labels the source carried', () => {
  const source = ['PLACE OF INCIDENT : Naga City', 'FACTS. The wallet was lost.'].join(LF);
  assert.deepEqual(extractFieldLabels(source), ['place of incident', 'facts']);
  const enhanced = ['PLACE OF INCIDENT : Naga City', 'FACTS: The wallet was lost.', 'VEHICLES INVOLVED: None.'].join(LF);
  const draft = buildEnhancedDraft({ enhancedText: enhanced, sourceText: source });
  assert.ok(draft.narrative.includes('<b>PLACE:</b>'), 'source label not bolded');
  assert.ok(draft.narrative.includes('<b>FACTS:</b>'), 'source label not bolded');
  assert.ok(!draft.narrative.includes('<b>VEHICLES INVOLVED:</b>'), 'invented label was bolded');
  assert.equal(draft.enhanced, true);
  assert.deepEqual(draft.notableFindings, [], 'enhance must not propose findings');
  assert.equal(draft.actionTaken, '', 'enhance must not propose a disposition');
  assert.deepEqual(
    unsupportedFieldLabels(enhanced, source),
    { invented: ['vehicles involved'], missing: [] },
    'an invented label must be detectable',
  );
  assert.deepEqual(
    unsupportedFieldLabels('FACTS: The wallet was lost.', source),
    { invented: [], missing: ['place of incident'] },
    'a dropped label must be detectable',
  );
});

// ---- Universal incident-title detection (owner request, 2026-11-02) --------
// One detector serves Arrange Only and Enhance Wording through the shared
// formatter: the title comes from the report being read, never from a
// hardcoded reference.

const REFERENCE = [
  'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
  '',
  'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
  'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
  'VEHICLES INVOLVED:',
  'V1 YAMAHA NMAX WITH PLATE 0718SR, OR 0716-819041, CR 0216-25-250349 OWNED AND DRIVEN BY JOSEPH LONTAYO POROL, MALE FILIPINO, 36 YRS OLD.',
  'V2 HONDA XRM WITH PLATE GF39113, OWNED BY GALEO CABRERE, DRIVEN BY HERO SANORIA CANQUE, 19 YRS OLD. NO DRIVERS LICENSE.',
  'BACKRIDER VILMA SANORIA CANQUE',
  '',
  'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
  'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
  'RECORDED BY : HONEY',
  'This certification is issued upon the request of "BEE" for what ever legal purposes it may serve.',
].join(LF);

test('the reference source yields its own title, not a field and not a guess', () => {
  assert.equal(
    detectIncidentTitle(REFERENCE),
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
    'reference title not detected',
  );
  const html = formatIncidentReportHtml(REFERENCE);
  assert.ok(
    html.includes('<p><b>RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY</b></p>'),
    'reference title is not a standalone heading',
  );
  assert.ok(!html.includes('INCIDENT TITLE:'), 'an INCIDENT TITLE: label was added');
});

test('a different incident receives its own title from its own source', () => {
  const src = [
    'LOST WALLET WITH IDENTIFICATION CARDS',
    '',
    'PLACE OF INCIDENT : PUBLIC MARKET, BARANGAY DAGATAN',
    'FACTS. THE COMPLAINANT REPORTED THAT HIS WALLET WENT MISSING WHILE BUYING GOODS.',
    'REMARKS: NONE',
    'RECORDED BY : PO1 DELA CRUZ',
  ].join(LF);
  assert.equal(detectIncidentTitle(src), 'LOST WALLET WITH IDENTIFICATION CARDS');
  const html = formatIncidentReportHtml(src);
  assert.ok(html.includes('<p><b>LOST WALLET WITH IDENTIFICATION CARDS</b></p>'));
  assert.ok(!html.includes('RECKLESS IMPRUDENCE'), 'the reference title leaked into another report');
});

test('vehicle rows, back-rider lines, times and certifications are not titles', () => {
  assert.equal(detectIncidentTitle('V1 YAMAHA NMAX WITH PLATE 0718SR.'), '');
  assert.equal(detectIncidentTitle('BACKRIDER VILMA SANORIA CANQUE'), '');
  assert.equal(detectIncidentTitle('MORE OR LESS 8:40 AM'), '');
  assert.equal(detectIncidentTitle('10-20-26 10:00 AM'), '');
  assert.equal(
    detectIncidentTitle('This certification is issued upon the request of "BEE" for what ever legal purposes it may serve.'),
    '',
    'certification read as a title',
  );
  assert.equal(
    detectIncidentTitle('Investigation revealed that both vehicles were traveling in opposite directions.'),
    '',
    'a narrative sentence read as a title',
  );
});

test('a one-word incident title heads the report instead of joining the section above it', () => {
  // "THEFT" is a whole incident name, stated in one word. Before, the title
  // scan needed two words, so the line fell into the section above it and was
  // sentence-cased into ordinary prose ("Remarks: None / theft"). It is now
  // the heading, wherever it sits in the source.
  const src = [
    'FACTS. THE COMPLAINANT REPORTED THAT HIS WALLET WAS TAKEN.',
    'REMARKS: NONE',
    'THEFT',
    'PLACE OF INCIDENT : PUBLIC MARKET',
    'RECORDED BY : Kainoa',
  ].join(LF);
  assert.equal(detectIncidentTitle(src), 'THEFT');
  const html = formatIncidentReportHtml(src, { sentenceCase: true });
  assert.ok(html.startsWith('<p><b>THEFT</b></p>'), 'the one-word title is not the heading');
  assert.ok(html.includes('<p><b>Remarks:</b> None</p>'), 'the title was swallowed by the remarks');
  assert.ok(!/Remarks:<\/b> None<br>/.test(html), 'the title leaked into another section');
  // A one-word line that is not a known incident name is never promoted.
  assert.equal(detectIncidentTitle('FACTS. THE VEHICLE SUSTAINED DAMAGE.\nDAMAGE\nREMARKS: NONE'), '');
});

test('a title wrapped by the source is one heading, not a stray paragraph', () => {
  // OCR wraps a long charge over two lines. Both fragments are the same title,
  // so they are emitted once, as one heading, and the second line never
  // survives as sentence-cased prose in the section below.
  const src = [
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY',
    'AND PHYSICAL INJURY',
    'FACTS. V1 HIT V2.',
  ].join(LF);
  assert.equal(
    detectIncidentTitle(src),
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
  );
  const html = formatIncidentReportHtml(src, { sentenceCase: true });
  assert.ok(
    html.startsWith('<p><b>RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY</b></p>'),
    'the wrapped title was not joined into one heading',
  );
  assert.ok(!html.includes('And physical injury'), 'a title fragment was left behind as prose');
});

test('no title is invented when the source carries none', () => {
  const src = [
    'PLACE OF INCIDENT : PUBLIC MARKET',
    'FACTS. THE COMPLAINANT REPORTED A MISSING WALLET.',
  ].join(LF);
  assert.equal(detectIncidentTitle(src), '');
  const html = formatIncidentReportHtml(src);
  assert.ok(!html.includes('<p><b>PUBLIC MARKET'), 'a field value was promoted to a heading');
  assert.ok(html.includes('<b>PLACE:</b>'), 'existing labels still bold');
});

test('arrange sentence-cases the place without correcting it; enhance keeps it as written', () => {
  // Arrange Only changes CAPITALISATION only (owner request, 2026-11-02):
  // CANGI MUNDONG becomes Cangi Mundong, never Cansimundong — the spelling is
  // the officer's. Enhance Wording keeps its own answer's casing.
  const src = [
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
    '',
    'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
    'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
  ].join(LF);
  const arranged = buildArrangeDraft({ accountText: src });
  assert.ok(
    arranged.narrative.includes('<b>Place:</b> Cangi Mundong, Inoburan, City of Naga'),
    'arrange did not sentence-case the recorded place or its label',
  );
  assert.ok(!arranged.narrative.includes('Cansimundong'), 'arrange corrected the recorded place');
  const enhanced = buildEnhancedDraft({ enhancedText: src, sourceText: src });
  assert.ok(
    enhanced.narrative.includes('<b>PLACE:</b> CANGI MUNDONG, INOBURAN, CITY OF NAGA'),
    'enhance formatting changed the recorded place wording',
  );
});

test('enhance path uses the same title logic as arrange but keeps its own casing', () => {
  const draft = buildEnhancedDraft({ enhancedText: REFERENCE, sourceText: REFERENCE });
  assert.ok(
    draft.narrative.includes('<p><b>RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY</b></p>'),
    'enhance did not keep the source title as a standalone heading',
  );
  assert.ok(
    draft.narrative.includes('<b>FACTS:</b><br>\u2003\u2003INVESTIGATION REVEALED'),
    'enhance must not be sentence-cased by Arrange Only\'s pass',
  );
  const arranged = buildArrangeDraft({ accountText: REFERENCE });
  assert.ok(
    arranged.narrative.includes('<p><b>RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY</b></p>'),
    'arrange lost the same title',
  );
  assert.notEqual(arranged.narrative, draft.narrative, 'the two modes must not share one casing pass');
});

// ---- Arrange Only: formal sentence case (owner request, 2026-11-02) --------
// Capitalisation is the ONLY thing that changes. The word sequence, spelling,
// grammar, punctuation, names, numbers and identifiers stay untouched.

test('arrange sentence-cases every all-caps narrative without correcting its words', () => {
  const arranged = buildArrangeDraft({ accountText: REFERENCE });
  // The two examples the owner pinned: only the case changes. "vehicle" stays
  // singular and "direction" stays singular — no grammar correction.
  // The label is the sheet's own, in sentence case, and the facts follow it
  // on the next line (owner request, 2026-11-02).
  assert.ok(
    arranged.narrative.includes(
      '<b>Facts:</b><br>\u2003\u2003Investigation revealed that both vehicle were traveling in opposite direction.',
    ),
    'the FACTS narrative was not sentence-cased or does not follow its label',
  );
  assert.ok(
    arranged.narrative.includes('<b>Remarks:</b> Both parties amicably settled the incident'),
    'the REMARKS narrative was not sentence-cased',
  );
  assert.ok(!arranged.narrative.includes('vehicles were'), 'grammar was corrected');
  assert.ok(!arranged.narrative.includes('directions'), 'grammar was corrected');
  // A typo is the officer's: sentence case must not correct it.
  const typo = buildArrangeDraft({
    accountText: 'FACTS. THEY WERE BROUGT TO NAGA INFIRMARY FOR TREATMENT.',
  });
  assert.ok(
    typo.narrative.includes('They were brougt to Naga Infirmary for treatment.'),
    'the officer\'s spelling or the facility name was not preserved',
  );
  assert.ok(!typo.narrative.includes('brought'), 'a spelling correction slipped in');
});

test('arrange keeps names, places, vehicle markers and identifiers intact', () => {
  const full = [
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
    '',
    'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
    'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
    'VEHICLES INVOLVED:',
    'V1 YAMAHA NMAX WITH PLATE 0718SR, OR 0716-819041, CR 0216-25-250349 OWNED AND DRIVEN BY JOSEPH LONTAYO POROL, MALE FILIPINO, 36 YRS OLD, DOB : 2-25-1990 AND A RESIDENT OF PUROK SAMBAG, INOBURAN, CITY OF NAGA, CEBU. WITH DRIVERS LICENSE G04-16-000471 VALID UNTIL 2-25-2029.',
    'V2 HONDA XRM WITH PLATE GF39113, OR 0741-206152, CR 258503221, OWNED BY GALEO CABRERE, DRIVEN BY HERO SANORIA CANQUE, MALE, FILIPINO, 19 YRS OLD, DOB: 9-22 - AND A RESIDENT OF PUROK TAL-OT, BRGY. MAIN IT, CITY OF NAGA, CEBU. NO DRIVERS LICENSE.',
    'BACKRIDER VILMA SANORIA CANQUE',
    '',
    'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
    'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
    'RECORDED BY : HONEY',
    'This certification is issued upon the request of "BEE" for what ever legal purposes it may serve.',
  ].join(LF);
  const arranged = buildArrangeDraft({ accountText: full });
  for (const bit of [
    '<b>Place:</b> Cangi Mundong, Inoburan, City of Naga',
    '<b>Time/Date:</b> More or less 8:40 AM of October 20, 2026',
    '<b>V1:</b> Yamaha NMAX with plate 0718SR, OR 0716-819041, CR 0216-25-250349',
    'Joseph Lontayo Porol',
    'male Filipino',
    'DOB : 2-25-1990',
    'Purok Sambag, Inoburan, City of Naga, Cebu',
    'G04-16-000471',
    '<b>V2:</b> Honda XRM with plate GF39113, OR 0741-206152, CR 258503221',
    'Galeo Cabrere',
    'Hero Sanoria Canque',
    'Purok Tal-ot, Brgy. Main It, City of Naga, Cebu',
    'No drivers license.',
    'Backrider Vilma Sanoria Canque',
    '<b>Recorded by:</b> Honey',
    // The issuance line's requestor name prints bold, ALL CAPS and
    // underlined on the paper (owner request) — never sentence-cased.
    '"<b><u>BEE</u></b>"',
  ]) {
    assert.ok(arranged.narrative.includes(bit), 'lost source detail: ' + bit);
  }
  // Every word is still there, exactly once: the pass is capitalisation only.
  // The exceptions are the labels the sheet renames (T/D → Time/Date,
  // PLACE OF INCIDENT → Place).
  const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).sort();
  assert.deepEqual(
    words(reportHtmlToPlain(arranged.narrative)),
    words(
      full
        .replace('T/D OF INCIDENT', 'Time/Date')
        .replace('PLACE OF INCIDENT', 'Place')
        .replace('MORE OR LESS 8:40 AM OF 10-20-26', 'MORE OR LESS 8:40 AM OF October 20, 2026'),
    ),
    'sentence case added, dropped, duplicated or reordered a word',
  );
});

test('arrange caps a lowercase or# before a number and spaces glued vehicle tokens', () => {
  // Live sheet bug: "or# 0716-819041" printed lowercase, and
  // "CR#0716-25-250349DRIVEN" printed with no spacing.
  const src = [
    'VEHICLES INVOLVED:',
    'V1 YAMAHA NMAX WITH PLATE 0718SR, or# 0716-819041, CR#0716-25-250349DRIVEN BY JOSEPH',
  ].join(LF);
  const html = formatIncidentReportHtml(src, { sentenceCase: true });
  assert.ok(html.includes('OR# 0716-819041'), 'lowercase or# was not capped: ' + html);
  assert.ok(html.includes('CR# 0716-25-250349 driven'), 'glued vehicle tokens were not spaced: ' + html);
  // Plates never split.
  assert.ok(html.includes('0718SR'), 'plate was damaged: ' + html);
  assert.doesNotMatch(html, /0718 SR/, 'plate was split: ' + html);
});

test('enhance keeps document codes capped and spaced without sentence-casing', () => {
  // Same live bug on the Enhance path: the formatter runs without
  // sentenceCase there, so OR/CR caps and spacing must hold on their own.
  // The conjunction "or" before words stays lowercase.
  const src = [
    'VEHICLES INVOLVED:',
    'V1 Yamaha NMAX with plate #0718SR, or# 0716-819041, CR#0716-25-250349DRIVEN by Joseph',
    'V2 Honda XRM with plate # gf 39113, or #0701 0741-206152, cr # 258V03221, owned by Galeo',
  ].join(LF);
  const html = formatIncidentReportHtml(src, {});
  assert.ok(html.includes('OR# 0716-819041'), 'enhance lost OR caps: ' + html);
  assert.ok(html.includes('CR# 0716-25-250349 DRIVEN'), 'enhance lost glued spacing: ' + html);
  assert.ok(html.includes('OR #0701'), 'enhance lost spaced OR caps: ' + html);
  assert.ok(html.includes('CR # 258V03221'), 'enhance lost CR caps: ' + html);
  assert.ok(html.includes('0718SR'), 'enhance damaged a plate: ' + html);
  const prose = formatIncidentReportHtml('FACTS. Tea or coffee. He left.', {});
  assert.ok(prose.includes('or coffee'), 'conjunction was capped: ' + prose);
});

test('enhance keeps the source order and breaks instead of rearranging', () => {
  // Owner request: Enhance is a copy-edit of the arranged page, never a
  // rearrangement — the SAME lines in the SAME order. The formatter must
  // not re-sort or inject breathing separators here (that rhythm is
  // Arrange's); it only bolds the labels the source carried.
  const src = [
    'REMARKS: None.',
    'PLACE: Naga City',
    'FACTS: The wallet was lost.',
  ].join(LF);
  const draft = buildEnhancedDraft({ enhancedText: src, sourceText: src });
  const html = draft.narrative;
  const at = (s) => html.indexOf(s);
  assert.ok(at('<b>REMARKS:</b>') < at('<b>PLACE:</b>'), 'enhance re-sorted the source order');
  assert.ok(at('<b>PLACE:</b>') < at('<b>FACTS:</b>'), 'enhance re-sorted the source order');
  assert.doesNotMatch(html, /<p><br><\/p>/, 'enhance injected a breathing separator');
  // Arrange still owns the standard order and rhythm.
  const arranged = formatIncidentReportHtml(src, { sentenceCase: true });
  const bt = (s) => arranged.indexOf(s);
  assert.ok(bt('Place:') < bt('Facts:'), 'arrange lost the standard order');
  assert.ok(bt('Facts:') < bt('Remarks:'), 'arrange lost the standard order');
  assert.ok(arranged.includes('<p><br></p>'), 'arrange lost its breathing room');
});

test('a slash-compound label opens its known section, never prose', () => {
  // The BW-0441 defect: "Narrative/facts:" is the sheet's own "Facts /
  // narrative" order written joined — the known side identifies the section,
  // so the prose below it sorts as Facts instead of gluing onto Remarks.
  const src = [
    '"THEFT"',
    '',
    'Remarks: Incident recorded and under investigation.',
    '',
    'Narrative/facts:',
    'Investigation revealed that the complainant reported that her wallet containing cash amounting to php 5,000.00 was missing from her bag inside a small store.',
  ].join(LF);
  const html = formatIncidentReportHtml(src, { sentenceCase: true });
  assert.ok(html.includes('<b>Facts:</b>'), 'the compound label did not open Facts: ' + html);
  assert.ok(!html.includes('Narrative/facts'), 'the compound label leaked through as prose');
  // A compound of two real sections stays prose: it must not fold under one.
  const both = formatIncidentReportHtml('Victim/Suspect: Ana Lopez / Juan Dela Cruz');
  assert.ok(!both.includes('<b>Victim:</b>'), 'an ambiguous compound was folded under one label');
  // The BW-0443 shape: an ALL-CAPS spaced compound. The generic unknown-label
  // rule would file it as an unknown section after the closings — the Facts
  // check runs first, so the shouting heading still opens Facts.
  const shout = formatIncidentReportHtml('NARRATIVE / FACTS:\n\nINVESTIGATION REVEALED THAT A HILUX AND A MIRAGE COLLIDED ON THE HIGHWAY AND THREE PERSONS DIED WHILE TWO OTHERS WERE HURT AND ALL WERE BROUGHT TO THE HOSPITAL FOR TREATMENT AT ONCE.', { sentenceCase: true });
  assert.ok(shout.includes('<b>Facts:</b>'), 'the shouting compound did not open Facts: ' + shout);
  assert.ok(!/Narrative\/facts/i.test(reportHtmlToPlain(shout)), 'the compound leaked through as prose');
});

test('a front-loaded Remarks still closes the report', () => {
  // The BW-0441 defect: the account states Remarks first and the narrative
  // after it, and the paper printed them in that order — Remarks above the
  // story. The station order owns the page: a blank-separated narrative of
  // substance leaves the closing section for Facts and sorts ahead of it.
  const prose = 'Investigation revealed that at the aforementioned date, time, and place of incident, the complainant reported that her wallet containing cash amounting to php 5,000.00, one (1) ATM card, and personal identification cards was missing from her bag. According to the complainant, she left her bag unattended inside a small store while attending to some personal matters, and upon returning she discovered that her wallet was no longer inside her bag.';
  assert.ok(prose.length >= 200, 'fixture too thin to exercise the split');
  const src = ['"THEFT"', '', 'Remarks: Incident recorded and under investigation.', '', 'Narrative/facts:', prose].join(LF);
  const html = formatIncidentReportHtml(src, { sentenceCase: true });
  const factsAt = html.indexOf('<b>Facts:</b>');
  const remarksAt = html.indexOf('<b>Remarks:</b>');
  assert.ok(factsAt !== -1 && remarksAt !== -1, 'both parts must print: ' + html);
  assert.ok(factsAt < remarksAt, 'Remarks still opens the body: ' + html);
  assert.ok(html.includes('Incident recorded and under investigation.'), 'the remarks wording was touched');
  // A short continuation stays glued: a closing written over several lines
  // is never torn apart for a one-line tail.
  const short = formatIncidentReportHtml('REMARKS: Case under follow-up.\n\nStill open.', { sentenceCase: true });
  assert.ok(short.indexOf('Still open') > short.indexOf('<b>Remarks:</b>'), 'a short continuation was split off');
  // No blank lines at all (a model that squashed the breaks): a long fresh
  // sentence after a finished closing line is still the narrative.
  const longTail = 'Investigation revealed that at more or less 7:45 PM of October 24, 2026, a multi-vehicle road accident occurred involving one Hilux, one Mirage and one motorcycle. The Hilux lost control and collided with the Mirage before hitting the motorcycle. Three individuals died while two others were hurt and brought to hospital. All vehicles sustained damage of an undetermined amount. The incident was reported to this office for proper documentation and further investigation. Responding officers secured the area and coordinated with the proper authorities for appropriate legal action without delay.';
  assert.ok(longTail.length >= 500, 'fixture too thin to exercise the no-blank split');
  const squashed = reportHtmlToPlain(formatIncidentReportHtml('Remarks: Incident recorded and referred for further investigation.\n' + longTail, { sentenceCase: true }));
  assert.ok(
    squashed.indexOf('Investigation revealed') !== -1 && squashed.indexOf('Investigation revealed') < squashed.indexOf('Remarks:'),
    'the squashed narrative still opens the body: ' + squashed.slice(0, 160),
  );
  // ...but a wrapped closing line (unfinished sentence) keeps its own tail.
  const wrapped = formatIncidentReportHtml('Remarks: Incident recorded and referred\nfor further investigation at length ' + longTail, { sentenceCase: true });
  assert.ok(!reportHtmlToPlain(wrapped).includes('Facts:'), 'a wrapped closing was torn apart');
});

test('a one-line paste with no breaks arranges like its spaced twin', () => {
  // The BW-0446 defect: the same report pasted as one line arranged nothing
  // — no title, no sections, no order — while the spaced twin arranged
  // cleanly. Section boundaries are the labels themselves, wherever they sit:
  // spacing must never decide the arrangement.
  const oneLine = [
    '**PHYSICAL INJURY RESULTING FROM A ROAD ALTERCATION** PLACE OF INCIDENT: PUROK 3, LANGTAD, CITY OF NAGA, CEBU',
    'T/D OF INCIDENT: MORE OR LESS 5:30 PM OF 10-22-26 PERSONS INVOLVED: COMPLAINANT: MARK ANTHONY REYES, MALE, FILIPINO, 28 YEARS OLD, DOB: 06-15-1998, AND A RESIDENT OF PUROK 3.',
    'RESPONDENT: RONALD JAMES GARCIA, MALE, FILIPINO, 30 YEARS OLD, DOB: 09-12-1996, AND A RESIDENT OF PUROK 5.',
    'FACTS: INVESTIGATION REVEALED THAT THE COMPLAINANT AND THE RESPONDENT ARGUED. THE RESPONDENT ALLEGEDLY ASSAULTED THE COMPLAINANT.',
    'RECORDED BY: KAINOA REMARKS: BOTH PARTIES WERE ADVISED TO SETTLE PEACEFULLY.',
    'THIS CERTIFICATION IS ISSUED UPON THE REQUEST OF MARK ANTHONY REYES FOR WHATEVER LEGAL PURPOSES IT MAY SERVE.',
  ].join(' ');
  const html = formatIncidentReportHtml(oneLine, { sentenceCase: true });
  const plain = reportHtmlToPlain(html);
  assert.ok(!html.includes('**'), 'markdown vestige leaked onto the paper');
  assert.ok(html.includes('<b>PHYSICAL INJURY RESULTING FROM A ROAD ALTERCATION</b>'), 'the one-line title was lost: ' + html.slice(0, 120));
  const heads = ['<b>Place:', '<b>Time/Date:', '<b>Persons involved:', '<b>Complainant:', '<b>Respondent:', '<b>Facts:', '<b>Remarks:', '<b>Recorded by:'];
  const at = heads.map((h) => html.indexOf(h));
  assert.ok(at.every((p) => p !== -1), 'a section went missing: ' + JSON.stringify(at));
  assert.ok(at.every((p, i) => i === 0 || p > at[i - 1]), 'the one-liner lost the station order');
  // Person rows stay whole: the DOB never breaks away from its name.
  assert.ok(/Mark Anthony Reyes[^]*?DOB: 06-15-1998/i.test(plain), 'the complainant row was torn apart');
  assert.ok(/Ronald James Garcia[^]*?DOB: 09-12-1996/i.test(plain), 'the respondent row was torn apart');
  // The closing issuance takes its own place, requestor dressed.
  assert.ok(html.includes('<b><u>MARK ANTHONY REYES</u></b>'), 'the issuance requestor was not dressed');
  assert.ok(plain.indexOf('for whatever legal') > plain.indexOf('Recorded by:'), 'the issuance did not close the report');
});

test('a Requested-by line builds the closing issuance with the named requestor', () => {
  // Owner request: "Requested by: KNOHEA" in the source prints the
  // certification closing naming them — in Arrange Only and everywhere the
  // same formatter runs (Enhance Wording is handed the arranged text).
  const src = [
    'LOST WALLET REPORT',
    '',
    'REQUESTED BY: KNOHEA',
    '',
    'FACTS. THE COMPLAINANT REPORTED THAT HER WALLET WENT MISSING.',
    'REMARKS: NONE',
    'RECORDED BY : PO1 DELA CRUZ',
  ].join(LF);
  const html = buildArrangeDraft({ accountText: src }).narrative;
  assert.ok(
    html.includes(
      'This certification is issued upon the request of "<b><u>KNOHEA</u></b>" for what ever legal purposes it may serve.',
    ),
    'issuance with the named requestor missing: ' + html,
  );
  // The label line itself is consumed — the report closes with the
  // certification naming them, and "Requested by:" is not repeated.
  assert.ok(!html.includes('Requested by:'), 'the Requested-by line was repeated');
  // The arranged text handed to Enhance carries the same line, so the
  // wording pass keeps it like any other line it was given.
  const arrangedPlain = reportHtmlToPlain(formatIncidentReportHtml(src, { sentenceCase: true }));
  assert.ok(
    arrangedPlain.includes('This certification is issued upon the request of "KNOHEA"'),
    'enhance input lost the issuance',
  );
  const enhanced = buildEnhancedDraft({ enhancedText: arrangedPlain, sourceText: arrangedPlain });
  assert.equal(
    enhanced.narrative.split('upon the request of').length - 1,
    1,
    'enhance display doubled the issuance',
  );
});

test('no Requested-by line means no issuance line is built', () => {
  const src = ['FACTS. THE COMPLAINANT REPORTED THAT HER WALLET WENT MISSING.', 'REMARKS: NONE'].join(LF);
  assert.ok(
    !formatIncidentReportHtml(src).includes('upon the request of'),
    'an issuance line was invented',
  );
});

test('an issuance the source already carries is kept once, never doubled', () => {
  const src = [
    'REQUESTED BY: KNOHEA',
    '',
    'FACTS. SOMETHING HAPPENED.',
    'This certification is issued upon the request of "KNOHEA" for what ever legal purposes it may serve.',
  ].join(LF);
  const html = formatIncidentReportHtml(src);
  assert.equal(
    html.split('upon the request of').length - 1,
    1,
    'issuance duplicated: ' + html,
  );
});

test('a reworded issuance line still dresses its requestor', () => {
  // A second Enhance press runs the wording pass over the arranged page, and
  // that pass may "correct" the station formula ("purposes" to "purpose",
  // dropped quotes). The paper still dresses the name — the line is
  // recognized by meaning, not by exact template wording.
  for (const line of [
    'This certification is issued upon the request of KNOHEA for whatever legal purpose it may serve.',
    'This certification is issued upon the request of "KNOHEA" for whatever legal purposes it may serve.',
    'This certification is issued upon the request of KNOHEA for what ever legal purposes it may serve.',
  ]) {
    const html = formatIncidentReportHtml(line);
    assert.ok(html.includes('<b><u>KNOHEA</u></b>'), 'requestor not dressed: ' + line);
  }
  // The editor-side dresser agrees, so the box and the paper never disagree.
  const dressed = emphasizeIssuanceRequestorHtml(
    '<p>This certification is issued upon the request of KNOHEA for whatever legal purpose it may serve.</p>',
  );
  assert.ok(dressed.includes('<b><u>KNOHEA</u></b>'), 'editor dresser missed the reworded line');
});

test('a placeholder requestor builds no issuance', () => {
  const src = ['REQUESTED BY: name of who requested', '', 'FACTS. SOMETHING HAPPENED.'].join(LF);
  assert.ok(
    !formatIncidentReportHtml(src).includes('upon the request of'),
    'an issuance was built for a placeholder',
  );
});

test('arrange sentence-cases mixed-case source without flattening correct words', () => {
  const mixed = buildArrangeDraft({
    accountText: [
      'FACTS. The complainant reported THAT HIS WALLET WAS MISSING.',
      'HE SAID THE wallet WAS LAST SEEN AT THE MARKET.',
    ].join(LF),
  });
  assert.ok(
    mixed.narrative.includes(
      '<b>Facts:</b><br>\u2003\u2003The complainant reported that his wallet was missing.<br>\u2003\u2003He said the wallet was last seen at the market.',
    ),
    'mixed-case source was not brought to consistent sentence case',
  );
  // AM is the verb here, not a clock marker; only a time keeps it upper-case.
  const clock = buildArrangeDraft({
    accountText: 'FACTS. I AM THE COMPLAINANT AND I WAS AT THE MARKET AT 8:40 AM.',
  });
  assert.ok(
    clock.narrative.includes('I am the complainant and I was at the market at 8:40 AM.'),
    'AM/PM or the pronoun I was cased wrongly',
  );
});

test('arrange handles a non-vehicular report and keeps incomplete identifiers', () => {
  const lost = buildArrangeDraft({
    accountText: [
      'LOST WALLET WITH IDENTIFICATION CARDS',
      '',
      'PLACE OF INCIDENT : PUBLIC MARKET, BARANGAY DAGATAN',
      'FACTS. THE COMPLAINANT REPORTED THAT HIS WALLET WENT MISSING WHILE BUYING GOODS.',
      'REMARKS: NONE',
      'RECORDED BY : PO1 DELA CRUZ',
    ].join(LF),
  });
  assert.ok(
    lost.narrative.includes('<b>Facts:</b><br>\u2003\u2003The complainant reported that his wallet went missing while buying goods.'),
    'the lost-property narrative was not sentence-cased',
  );
  assert.ok(lost.narrative.includes('<b>Remarks:</b> None'), 'existing remarks were not kept');
  assert.ok(lost.narrative.includes('<b>Recorded by:</b> PO1 Dela Cruz'), 'recorder name was not cased');
  assert.ok(!lost.narrative.includes('VEHICLES INVOLVED'), 'a vehicle section was invented');
  // An incomplete date or identifier is left exactly as supplied.
  const incomplete = buildArrangeDraft({
    accountText: 'FACTS. THE DRIVER\'S LICENSE NO. 9-22 - WAS RECORDED WITHOUT A COMPLETE DATE.',
  });
  assert.ok(incomplete.narrative.includes('9-22 -'), 'an incomplete value was completed or reformatted');
});

test('arrange writes every bold field label in sentence case, not all caps', () => {
  // Owner request, 2026-11-02: the sheet's labels read as words, the T/D
  // shorthand reads as Time/Date, and the facts narrative follows its label on
  // the next line. Only the label's own presentation changes.
  const arranged = buildArrangeDraft({
    accountText: [
      'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
      '',
      'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
      'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
      'VEHICLES INVOLVED:',
      'V1 YAMAHA NMAX WITH PLATE 0718SR.',
      'FACTS. THE VEHICLES COLLIDED.',
      'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
      'RECORDED BY : HONEY',
      'PURPOSE: RECORD',
    ].join(LF),
  });
  for (const bit of [
    '<b>Place:</b> Cangi Mundong, Inoburan, City of Naga',
    '<b>Time/Date:</b> More or less 8:40 AM of October 20, 2026',
    '<b>Vehicles involved:</b></p><p>',
    '<b>Facts:</b><br>\u2003\u2003The vehicles collided.',
    '<b>Remarks:</b> Both parties amicably settled the incident',
    '<b>Recorded by:</b> Honey',
    '<b>Purpose:</b> Record',
  ]) {
    assert.ok(arranged.narrative.includes(bit), 'label not spelled as the sheet writes it: ' + bit);
  }
  for (const shout of ['<b>FACTS', '<b>T/D', '<b>PLACE', '<b>REMARKS', '<b>RECORDED']) {
    assert.ok(!arranged.narrative.includes(shout), 'an all-caps label survived: ' + shout);
  }
});

// ---- Order-independent arrangement (owner request, 2026-11-02) -------------
// The same report may state its parts in any order; the sheet must find the
// title and arrange the parts by meaning, never by where they sat.

test('a title stated after the facts is still the report its title', () => {
  const src = [
    'PLACE OF INCIDENT : PUBLIC MARKET',
    'FACTS. THE COMPLAINANT REPORTED A MISSING WALLET.',
    'LOST WALLET WITH IDENTIFICATION CARDS',
    'REMARKS: NONE',
  ].join(LF);
  assert.equal(detectIncidentTitle(src), 'LOST WALLET WITH IDENTIFICATION CARDS');
  const html = formatIncidentReportHtml(src);
  assert.equal(
    html.indexOf('<p><b>LOST WALLET WITH IDENTIFICATION CARDS</b></p>'),
    0,
    'the title is not the leading heading',
  );
  assert.ok(html.includes('<b>PLACE:</b> PUBLIC MARKET'), 'the place was lost');
  assert.ok(html.includes('<b>FACTS:</b>'), 'the facts were lost');
  assert.ok(html.includes('<b>REMARKS:</b>'), 'the remarks were lost');
  assert.ok(!html.includes('INCIDENT TITLE:'), 'an INCIDENT TITLE: label was added');
});

test('reordered parts are arranged in the report order without losing a word', () => {
  const src = [
    'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
    'RECORDED BY : HONEY',
    'FACTS. THE VEHICLES COLLIDED.',
    'VEHICLES INVOLVED:',
    'V1 YAMAHA NMAX WITH PLATE 0718SR.',
    'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
    'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
    '10-20-26 10:00 AM',
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
  ].join(LF);
  const html = formatIncidentReportHtml(src);
  const order = [
    '10-20-26 10:00 AM',
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
    // The sheet prints the place label short (owner request: "Place:").
    '<b>PLACE:</b>',
    'T/D OF INCIDENT',
    'VEHICLES INVOLVED',
    'FACTS',
    'REMARKS',
    'RECORDED BY',
  ];
  // The place / T-D / vehicles block follows the title on every report: the
  // entry timestamp is the only thing ahead of the title, never between it and
  // the place line.
  assert.ok(
    html.indexOf('10-20-26 10:00 AM') < html.indexOf('RECKLESS IMPRUDENCE'),
    'the entry timestamp is not at the head of the report',
  );
  let last = -1;
  for (const needle of order) {
    const at = html.indexOf(needle);
    assert.ok(at > last, needle + ' is out of report order');
    last = at;
  }
  for (const word of [
    'BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
    'HONEY',
    '<b>V1:</b> YAMAHA NMAX WITH PLATE 0718SR.',
    'CANGI MUNDONG, INOBURAN, CITY OF NAGA',
    'MORE OR LESS 8:40 AM OF October 20, 2026',
  ]) {
    assert.ok(html.includes(word), 'lost source wording: ' + word);
  }
});

test('a reordered source yields the same arranged report, not a reordered one', () => {
  // The SOURCE may be sequence-interchanged; the GENERATED arrangement does
  // not follow it. Both permutations below produce one identical report.
  const date = '10-20-26 10:00 AM';
  const title = 'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY';
  const place = 'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA';
  const td = 'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26';
  const vehicles = ['VEHICLES INVOLVED:', 'V1 YAMAHA NMAX WITH PLATE 0718SR.'];
  const facts = 'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.';
  const remarks = 'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT';
  const recorded = 'RECORDED BY : HONEY';
  const sourceA = [date, title, place, td, ...vehicles, facts, remarks, recorded].join(LF);
  const sourceB = [remarks, recorded, facts, ...vehicles, td, place, title, date].join(LF);
  assert.equal(
    formatIncidentReportHtml(sourceA),
    formatIncidentReportHtml(sourceB),
    'the generated report followed the source order instead of the report order',
  );
});

test('vehicle markers are bold only where the source carries vehicle rows', () => {
  const html = formatIncidentReportHtml(REFERENCE);
  assert.ok(html.includes('<b>V1:</b> YAMAHA NMAX WITH PLATE 0718SR'), 'V1: is not bold');
  assert.ok(html.includes('<b>V2:</b> HONDA XRM'), 'V2: is not bold');
  // A report with no vehicles gets no vehicle marker.
  const wallet = formatIncidentReportHtml(
    'LOST WALLET WITH IDENTIFICATION CARDS\n\nFACTS. NO VEHICLE WAS INVOLVED.',
  );
  assert.ok(!/<b>V\d+:<\/b>/.test(wallet), 'a vehicle marker was invented');
  // A V2 mentioned inside the facts prose is not a vehicle row.
  const prose = formatIncidentReportHtml('FACTS. UPON REACHING THE PLACE V2 ENCROACHED INTO V1 LANE.');
  assert.ok(!/<b>V\d+:<\/b>/.test(prose), 'a prose V-marker was bolded as a row');
});

test('enhance is a copy-edit of the ALREADY-ARRANGED report, never a rearrangement', () => {
  // Owner request, 2026-11-02: the officer may settle for the arranged report,
  // or have its wording enhanced. The layout is the application's, so the model
  // is told to change wording only — no reordering, no new sections, no
  // restating the record's structured fields. Reusing another report is still
  // forbidden.
  const prompt = readFileSync(new URL('../../resources/ai/enhance_report_prompt.txt', import.meta.url), 'utf8');
  assert.match(prompt, /COPY-EDIT, NOT A REARRANGEMENT/);
  assert.match(prompt, /Return the SAME lines, in the SAME order, with the SAME labels/);
  assert.doesNotMatch(prompt, /STANDARD ORDER/);
  assert.match(prompt, /never reuse[\s\S]{0,80}?another report/i);

  // ONE CONTRACT, TWO MODES (owner request, 2026-11-02): Enhance Wording is
  // Arrange Only plus a wording pass — the arrangement is not its job. The
  // prompt must say so, and must not hand the model any ordering permission.
  assert.match(prompt, /ENHANCE WORDING = ARRANGE ONLY \+ WORDING/);
  assert.match(prompt, /Everything that\s*\nmode decides is therefore settled/);
  assert.doesNotMatch(prompt, /order of the parts/i, 'the prompt still lets the model order the parts');
  assert.doesNotMatch(prompt, /arranged into the standard report order below/i, 'stale ordering instruction is back');
  assert.match(prompt, /correct wording, grammar,\s*\npunctuation and police register/);

  // Police register with real terminology (owner request): Enhance is the
  // wording pass, so the prompt carries the formal substitutions themselves
  // — vocabulary swaps only, never a new fact, never a heavier legal term,
  // never an invented classification.
  assert.match(prompt, /POLICE REGISTER/);
  assert.match(prompt, /proceeded to/);
  assert.match(prompt, /made contact with/);
  assert.match(prompt, /never a term of greater legal/);
  assert.match(prompt, /Warrant of Arrest/);

  // The panel arranges FIRST and hands the model that text.
  const PANEL = readFileSync(new URL('../../src/components/ai/AiNarrativePanel.jsx', import.meta.url), 'utf8');
  assert.match(
    PANEL,
    /formatIncidentReportHtml\(accountText, \{ sentenceCase: true \}\)/,
    'enhance no longer arranges the report before sending it',
  );
  assert.match(
    PANEL,
    /body: \{ account: sourceText \}/,
    'enhance sends something other than the arranged report',
  );

  // AND THE SAME READ ARRANGE MAKES (owner request, 2026-11-02): type/date/place
  // only. The full read filled the type's own fields, which is where the sheet
  // grew a `Vehicle 1:` row and a `Suspected Cause:` line the arranged page
  // never had — the two the officer asked to be gone.
  assert.match(
    PANEL,
    /if \(!fromArranged && onReadAccount\) \{\s*\n\s*await runAccountRead\(accountText, \{ arrangeOnly: true \}\);/,
    'enhance runs the full account read again',
  );
});
