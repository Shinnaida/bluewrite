// BlueWrite - arrange-only draft builder (sheet Generate Report, 2026-10-23).
// Pure helpers behind AiNarrativePanel arrangeReport: whitespace-normalize the
// officer's own account and shape the proposal draft. No LLM call, no side
// effects - directly unit-testable (see generateReportModes.test.mjs).
//
// The layout itself is the shared universal formatter (reportFormat.js), so
// Arrange Only and Enhance Wording bold exactly the same existing labels and
// invent none. Arrange Only asks for `sentenceCase`: capitalisation only, so a
// shouted account reads formally while its words, spelling, grammar,
// punctuation and identifiers stay exactly as the officer wrote them. Enhance
// Wording keeps its own answer's casing.
import { extractFieldLabels, formatIncidentReportHtml } from './reportFormat.js';

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

// The arrange proposal: the cleaned account, laid out with its OWN existing
// labels bolded, as the narrative; the officer's own findings/action carried
// through unchanged, no suggestions or gaps.
// arranged:true marks the provenance; the panel renders it as a visible
// receipt line (see ai-arranged-note), so the flag always has a reader.
export function buildArrangeDraft({ accountText, notableFindings = '', actionTaken = '' }) {
  const cleaned = cleanAccountText(accountText);
  const findingsText = String(notableFindings == null ? '' : notableFindings);
  const statusText = String(actionTaken == null ? '' : actionTaken);
  return {
    narrative: formatIncidentReportHtml(cleaned, { sentenceCase: true }),
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

/**
 * The Enhance Wording proposal. The model improves grammar and clarity, but
 * the FORMAT is the same formatter Arrange uses, constrained to the labels the
 * SOURCE carried: an invented heading can never be bolded, and no field label
 * is added by this side.
 *
 * Findings and Action Taken are NOT proposed here. Enhance Wording improves
 * the incident report's prose; it does not rewrite the record's own fields,
 * so they reach Accept as empty (which the editor treats as "nothing to
 * propose").
 */
export function buildEnhancedDraft({ enhancedText, sourceText }) {
  const html = formatIncidentReportHtml(cleanAccountText(enhancedText), {
    allowedLabels: extractFieldLabels(cleanAccountText(sourceText)),
  });
  return {
    narrative: html,
    suggestions: [],
    possibleGaps: [],
    notableFindings: [],
    actionTaken: '',
    addedContentWarnings: [],
    suspectLines: [],
    cached: false,
    residualRisk: [],
    economy: null,
    // Provenance marker for the panel's repeat control: an enhanced draft is
    // enhanced again, never replaced by a freshly generated narrative.
    enhanced: true,
    findingsText: '',
    statusText: '',
  };
}
