// BlueWrite — Harper-backed grammar check (offline, privacy-first).
//
// Harper (Automattic, Rust → WASM via harper.js) runs entirely on the station
// PC: no text ever leaves the machine, no key, no server. The WASM binary is
// bundled inline (harper.js/binaryInlined), so it works offline and behind the
// station's XAMPP box the same as on localhost.
//
// PRECISION OVER RECALL, same as src/lib/grammarCheck.js: a police record must
// never be "corrected" into a different fact. Harper's dictionary does not
// know blotter identifiers, Filipino names or Naga places, so every Harper
// lint that touches one is dropped before it can reach the officer:
//
//   * spans touching a digit or '#' (plates, OR/CR + numbers, DOB, licence,
//     times, V1:, amounts) — Harper wants en-dashes in OR numbers and
//     "corrections" for V1/NMAX/SR, none of which may change;
//   * spelling lints on a word the record capitalizes (Porol, Purok, Naga) —
//     a capitalized unknown is a name until proven otherwise; only a pure
//     lowercase alpha word (teh, recieve) is offered a spelling fix;
//   * lints with no suggestion — advisory only, nothing to apply.
//
// The deterministic rule checker stays FIRST: it paints instantly and covers
// the mechanical slips (spacing, doubling, casing). Harper loads async (WASM
// compile) and its surviving lints are merged in — nothing is ever applied
// unasked; the officer picks from the same right-click menu.
//
// Shape everywhere: { start, end, message, suggestions[] } — [start, end) is
// the exact slice to replace. Pure and unit-tested beside grammarCheck
// (see tests/rules/harperGrammar.test.mjs); the WASM path itself is lazy so
// tests never compile it.

import { checkGrammar, GRAMMAR_ISSUE_CAP } from './grammarCheck.js';
import { properNounMap } from './printCasing.js';

export { GRAMMAR_ISSUE_CAP };
export { applyGrammarSuggestion } from './grammarCheck.js';

/** Harper lint kinds surfaced to the officer — mechanical, never meaning. */
const ALLOWED_KINDS = new Set([
  'Agreement',
  'Capitalization',
  'Grammar',
  'Punctuation',
  'Repetition',
  'Typo',
  'Usage',
  // Spelling is filtered further below: lowercase words only.
  'Spelling',
]);

const isWordChar = (c) => /[A-Za-z0-9_]/.test(c || '');

/**
 * Does [start, end) touch a blotter identifier? True when the span itself
 * holds a digit or '#', or sits inside a token that does (V1, OR# 0716-…,
 * 2-25-1990, G04-16-000471, 8:40).
 */
export function isRecordTouching(text, start, end) {
  const src = String(text ?? '');
  if (!(end > start)) return false;
  const slice = src.slice(Math.max(0, start), Math.max(0, end));
  if (/[#0-9]/.test(slice)) return true;
  let left = Math.max(0, start);
  while (left > 0 && /[A-Za-z0-9_#:.\\-]/.test(src[left - 1])) left -= 1;
  let right = Math.min(src.length, end);
  while (right < src.length && /[A-Za-z0-9_#:.\\-]/.test(src[right])) right += 1;
  return /[#0-9]/.test(src.slice(left, right));
}

/**
 * Keep only the Harper lints an officer may safely be offered for a police
 * draft. Pure — takes { start, end, kind, message, suggestions[] } objects.
 */
export function filterHarperLints(text, lints) {
  const src = String(text ?? '');
  const out = [];
  for (const lint of lints || []) {
    if (!lint || typeof lint.start !== 'number' || typeof lint.end !== 'number') continue;
    if (lint.end <= lint.start) continue;
    const suggestions = Array.isArray(lint.suggestions) ? lint.suggestions.filter((s) => typeof s === 'string' && s !== '') : [];
    if (suggestions.length === 0) continue;
    if (!ALLOWED_KINDS.has(lint.kind)) continue;
    if (isRecordTouching(src, lint.start, lint.end)) continue;
    if (lint.kind === 'Spelling') {
      const word = src.slice(lint.start, lint.end);
      // A capitalized unknown is a name/place until proven otherwise.
      if (!/^[a-z]+$/.test(word)) continue;
    }
    out.push({ start: lint.start, end: lint.end, message: String(lint.message || 'Grammar.'), suggestions });
  }
  return out;
}

/**
 * Merge two issue lists: sorted, non-overlapping, capped. The base list
 * (deterministic rules) wins an overlap — it is the precise one.
 */
export function mergeGrammarIssues(base, extra) {
  const all = [...(base || []), ...(extra || [])];
  all.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  let frontier = -1;
  for (const issue of all) {
    if (issue.start < frontier || issue.end <= issue.start) continue;
    if (!Array.isArray(issue.suggestions) || issue.suggestions.length === 0) continue;
    kept.push(issue);
    frontier = issue.end;
    if (kept.length >= GRAMMAR_ISSUE_CAP) break;
  }
  return kept;
}

// British spellings the blotter writes every day — accepted station usage,
// never flagged, whatever the American dictionary says.
const BRITISH_REPORT_WORDS = [
  'travelling', 'travelled', 'traveller',
  'cancelled', 'cancelling', 'counselled', 'counselling', 'counsellor',
  'labelled', 'labelling', 'modelled', 'modelling', 'quarrelled',
  'fuelled', 'fuelling', 'signalled', 'signalling', 'equalled',
  'initialled', 'totalled', 'behaviour', 'favour', 'favourite', 'honour',
  'labour', 'neighbour', 'odour', 'rumour', 'cheque', 'kerb', 'pyjamas',
  'enrol', 'enrolment', 'fulfil', 'fulfilment', 'focused',
];

/**
 * Words Harper must accept for THIS report: its own recorded names/places
 * (capitalized words the draft itself spells that way) plus station
 * spellings. Pure — no WASM — so the sheet can reason about it in tests.
 */
export function extractSeedWords(text) {
  const seeds = new Set();
  for (const word of BRITISH_REPORT_WORDS) {
    const w = String(word).trim();
    if (w !== '') seeds.add(w);
  }
  for (const canonical of properNounMap([text]).values()) {
    seeds.add(canonical);
    seeds.add(String(canonical).toLowerCase());
  }
  return [...seeds];
}

// What this page load already taught the linter (lower-cased). Bounded:
// past ~500 the oldest reports' names are forgotten rather than hoarded.
const seededWords = new Set();
const MAX_SEEDED_WORDS = 500;

async function seedReportWords(linter, text) {
  const words = extractSeedWords(text).filter((w) => !seededWords.has(String(w).toLowerCase()));
  if (words.length === 0) return;
  try {
    if (seededWords.size + words.length > MAX_SEEDED_WORDS) {
      await linter.clearWords();
      seededWords.clear();
    }
    await linter.importWords(words);
    for (const w of words) seededWords.add(String(w).toLowerCase());
  } catch {
    // Seeding is a courtesy — an unseeded lint still runs.
  }
}

// One linter per page load — WASM compiles once, then every keystroke reuses
// it. A null promise means "tried and unavailable": fall back to rules only.
let linterPromise = null;

function loadLinter() {
  if (!linterPromise) {
    linterPromise = (async () => {
      const harper = await import('harper.js');
      const { binaryInlined } = await import('harper.js/binaryInlined');
      const linter = new harper.LocalLinter({ binary: binaryInlined, dialect: harper.Dialect.American });
      await linter.setup();
      return { harper, linter };
    })().catch(() => null);
  }
  return linterPromise;
}

/** Warm the WASM binary while the officer is still reading — no lint yet. */
export function warmHarper() {
  try {
    loadLinter();
  } catch {
    // A warmer that throws is worse than no warmer.
  }
}

/**
 * Harper's surviving lints for the text, in issue shape. Never rejects:
 * [] means "Harper has nothing (or is unavailable)" and the caller keeps
 * the deterministic rules.
 */
export async function checkHarperGrammar(text) {
  const src = String(text ?? '');
  if (src.trim() === '') return [];
  if (src.length > 20000) return [];
  try {
    const loaded = await loadLinter();
    if (!loaded) return [];
    const { linter } = loaded;
    await seedReportWords(linter, src);
    const lints = await linter.lint(src, { language: 'plaintext' });
    const mapped = [];
    for (const lint of lints) {
      try {
        const span = lint.span();
        const suggestions = lint.suggestions().map((s) => {
          try {
            return s.get_replacement_text();
          } catch {
            return '';
          }
        }).filter((s) => typeof s === 'string' && s !== '');
        mapped.push({
          start: span.start,
          end: span.end,
          kind: lint.lint_kind(),
          message: lint.message(),
          suggestions,
        });
      } catch {
        // One unreadable lint is skipped, never fatal.
      }
    }
    return filterHarperLints(src, mapped);
  } catch {
    return [];
  }
}

/**
 * The full draft check: deterministic rules now, Harper merged in when it
 * loads. Used by the sheet proofreader and the AI draft hint alike.
 */
export async function checkDraftGrammarEnhanced(text) {
  const base = checkGrammar(text);
  const extra = await checkHarperGrammar(text);
  if (extra.length === 0) return base;
  return mergeGrammarIssues(base, extra);
}
