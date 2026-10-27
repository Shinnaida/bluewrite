// BlueWrite - arrange-only draft builder (sheet Generate Report, 2026-10-23).
// Pure helpers behind AiNarrativePanel arrangeReport: whitespace-normalize the
// officer's own account and shape the proposal draft. No LLM call, no imports,
// no side effects - directly unit-testable (see generateReportModes.test.mjs).
const BS = String.fromCharCode(92);
const LF = String.fromCharCode(10);
const WS_NL = new RegExp(BS + 's+' + BS + 'n', 'g');
const SP_TAB = new RegExp('[ ' + BS + 't]+', 'g');
const TRIPLE = new RegExp(BS + 'n{3,}', 'g');

// Collapse trailing whitespace at line ends, runs of spaces/tabs, and 3+ blank
// lines - the officer's words and order are otherwise untouched.
export function cleanAccountText(text) {
  return String(text == null ? '' : text)
    .replace(WS_NL, LF)
    .replace(SP_TAB, ' ')
    .replace(TRIPLE, LF + LF)
    .trim();
}

// The arrange proposal: the cleaned account as the narrative, the officer's
// own findings/action carried through unchanged, no suggestions or gaps.
// arranged:true marks the provenance; the panel renders it as a visible
// receipt line (see ai-arranged-note), so the flag always has a reader.
export function buildArrangeDraft({ accountText, notableFindings = '', actionTaken = '' }) {
  const cleaned = cleanAccountText(accountText);
  const findingsText = String(notableFindings == null ? '' : notableFindings);
  const statusText = String(actionTaken == null ? '' : actionTaken);
  return {
    narrative: cleaned,
    suggestions: [],
    possibleGaps: [],
    notableFindings: findingsText.split(LF).map((s) => s.trim()).filter(Boolean),
    actionTaken: statusText,
    addedContentWarnings: [],
    suspectLines: [],
    cached: false,
    residualRisk: [],
    economy: null,
    arranged: true,
    findingsText,
    statusText,
  };
}
