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

// Faithfulness gate for the provider's arrangement (owner request): Arrange
// Only may reorder, never invent — so a model answer that names a person,
// plate, document code or vehicle marker the account never stated is
// guessing, and the press falls back to the deterministic formatter on the
// officer's own words. Checks output-extra only (a dropped duplicate title is
// the job, not a fault): every multi-word capitalized run and every
// plate/OR/CR/V-marker-style code in the answer must already read in the
// account, letter for letter modulo case and spacing. A rephrased ordinary
// phrase in the account's own words passes; a name from nowhere fails.
// A name run is two or more capitalized words (Title or SHOUTED, so
// "Ricardo Manuel Santos" and "ANGELICA MAE VILLAROSA" both count), with
// the small connectors Philippine/Spanish names carry ("de la Cruz")
// allowed inside — but a run needs at least two genuinely capitalized words,
// so "Vehicle KJ-48213" is a vehicle plus its plate (checked as a code),
// not a person.
const NAME_WORD = String.raw`(?:[A-Z][A-Za-z'’-]*|[A-Z]{3,}|de|la|del|las|los|van|von|y|bin|binti|mc|mac)`;
const NAME_RUN_RE = new RegExp(`\\b${NAME_WORD}(?:\\s+${NAME_WORD})+\\b`, 'g');
const NAMEY_WORD = /^(?:[A-Z][a-z'’-]+|[A-Z]{3,})$/;
const CODE_RUN_RE = /[A-Za-z]{2,}[\s-]*\d[\dA-Za-z-]*|\bV\d+\b|\b(?:OR|CR)\s*#?\s*\d[\d-]*/gi;
// Month words are never plate/code evidence: "Oct 24" for the account's
// "October 24" is the model's harmless shortening, not a guessed code.
const MONTH_WORD_RE = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i;

export function arrangeOutputIsFaithful(output, account) {
  const src = String(account ?? '')
    .replace(/₱/g, 'PHP ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (src.trim() === '') return false;
  const out = String(output ?? '').replace(/₱/g, 'PHP ');
  if (out.trim() === '') return false;
  const seen = new Set();
  for (const m of out.matchAll(NAME_RUN_RE)) {
    const words = m[0].split(/\s+/);
    // Connectors alone are not a name: "de la" without a capitalized word
    // beside it is prose, and a lone capitalized word is a sentence start.
    if (words.filter((w) => NAMEY_WORD.test(w)).length < 2) continue;
    const norm = m[0].toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (!src.includes(norm)) return false;
  }
  const flat = src.replace(/[^a-z0-9]+/g, '');
  const seenCode = new Set();
  for (const m of out.matchAll(CODE_RUN_RE)) {
    const letters = (/^[A-Za-z]+/.exec(m[0]) ?? [''])[0];
    if (MONTH_WORD_RE.test(letters)) continue;
    const code = m[0].toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (code === '' || seenCode.has(code)) continue;
    seenCode.add(code);
    if (!flat.includes(code)) return false;
  }
  return true;
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
  // preserveLayout (owner request): Enhance is a copy-edit of the arranged
  // page, never a rearrangement — the source's own section order and breaks
  // are kept, so the enhanced paper reads like the page it was written from.
  const cleaned = cleanAccountText(enhancedText);
  const source = cleanAccountText(sourceText);
  const html = formatIncidentReportHtml(cleaned, {
    allowedLabels: extractFieldLabels(source),
    preserveLayout: true,
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
