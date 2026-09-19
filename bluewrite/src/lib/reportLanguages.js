// BlueWrite — the language an officer DECLARES for the narrative.
// Phase 6 Stage 1 (docs/PHASE6_MULTILINGUAL.md §5.4); Stage 5 Track A (D3) made
// the language SET a registry read rather than a list held here.
// Pure functions, no React, no DOM — covered by node:test.
//
// Things about this module that are deliberate and worth not "fixing":
//
//   * The language is DECLARED, never detected. §8 Q2 of the plan settles it:
//     detection by function words is unreliable — ang, sa and nga are shared
//     between Tagalog and Cebuano — and a wrong guess would silently apply the
//     wrong terminology table in Stage 2. Nothing here inspects the narrative
//     text, and nothing here ever should.
//
//   * "Untranslated" is DERIVED, not stored. It is exactly
//     `language !== 'en'`, so it cannot come to disagree with the language it
//     describes.
//
//   * Selecting a language RELABELS. It never converts, translates or
//     re-processes a single character of the narrative — so the officer's words
//     survive a change of mind about what they were written in.
//
//   * THE LIST IS NOT HERE ANY MORE (Stage 5, Track A). The codes, labels and
//     printed short forms come from src/lib/languageRegistry.js, whose content
//     is the server's resources/ai/language_registry.json. Adding a language is
//     a data change on the server; this module needs no edit for it. The one
//     thing that stays local is the DEGRADED reading (see normaliseLanguage).
//
// Stored codes mirror the registry; the server is what rejects an unknown code
// with a 422.

import { findLanguage, getLanguageRegistry } from './languageRegistry.js';

/** English: the stored default, and what an absent value means. */
export const DEFAULT_LANGUAGE = 'en';

/** The label shown when nothing better is known — the default language's name. */
const DEFAULT_LABEL = 'English';

/**
 * The languages the selector offers, in the registry's order.
 *
 * Reads the live registry, so a language the server added appears on the next
 * sign-in with no client change. Returns `{ code, label, short }` — the same
 * shape this module used to hard-code.
 *
 * @returns {Array<{code: string, label: string, short: string}>}
 */
export function narrativeLanguageOptions() {
  return getLanguageRegistry().map((l) => ({
    code: l.code,
    label: l.label,
    short: l.short,
  }));
}

/**
 * Is this one of the registry's codes?
 *
 * The column is a VARCHAR, so it can hold anything — the API is what rejects an
 * unknown code. This function exists because a value can also arrive from
 * outside the API: a stored report read back, a restored draft in
 * sessionStorage, an old row.
 *
 * @param {unknown} code
 * @returns {boolean}
 */
export function isKnownLanguage(code) {
  return typeof code === 'string' && findLanguage(code) !== null;
}

/**
 * A usable code from anything.
 *
 * With the registry loaded, a known code passes through and everything else
 * becomes 'en' — the read-side guard, and NOT the same job as the API's
 * validation. The API REJECTS an unknown code from a client (422, never
 * coerced) because a wrong declaration is the officer's to fix. A READ has no
 * officer to ask, so it falls back to the only safe reading.
 *
 * BEFORE THE REGISTRY LANDS the rule is deliberately different: an unknown
 * string is passed through unchanged rather than called English. Calling a
 * stored 'ceb' English would mislabel a Bisaya narrative as an English one —
 * exactly the fact Stage 1 exists to state — and a brief window (the bootstrap
 * read) is not worth that risk. The name is then missing, which is honest; the
 * language is never wrong.
 *
 * @param {unknown} code
 * @returns {string}
 */
export function normaliseLanguage(code) {
  if (isKnownLanguage(code)) return code;
  if (getLanguageRegistry().length === 0 && typeof code === 'string' && code !== '') {
    return code;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * The plain-words name of a language, for anything a person reads.
 * @param {unknown} code
 * @returns {string}
 */
export function languageLabel(code) {
  const entry = findLanguage(normaliseLanguage(code));
  return entry?.label ?? DEFAULT_LABEL;
}

/**
 * The compact name for printed lines, so a line does not read
 * "Bisaya (Cebuano) (not translated)".
 * @param {unknown} code
 * @returns {string}
 */
export function languageShort(code) {
  const normalised = normaliseLanguage(code);
  const entry = findLanguage(normalised);
  return entry?.short ?? entry?.label ?? normalised;
}

/**
 * Is this narrative NOT in English — i.e. is the report untranslated?
 * @param {unknown} code
 * @returns {boolean}
 */
export function isUntranslated(code) {
  return normaliseLanguage(code) !== DEFAULT_LANGUAGE;
}

/**
 * The calm note shown beside the narrative in the editor, or null for
 * English. Stated as a fact about the record, not as an alarm: filing in
 * Bisaya is a supported thing to do here, not a mistake.
 *
 * @param {unknown} code
 * @returns {string|null}
 */
export function untranslatedNotice(code) {
  if (!isUntranslated(code)) return null;
  return (
    `Written in ${languageLabel(code)} and not translated to English. ` +
    'It is saved, printed and filed exactly as written.'
  );
}

/**
 * Why AI drafting and tightening are unavailable (D3), or null when they are.
 *
 * The wording is the brief's, because it is the honest reason: the tools work
 * on English text, and running the English economy rules over a Bisaya
 * narrative would rewrite prose in the wrong language rather than improve it.
 *
 * @param {unknown} code
 * @returns {string|null}
 */
export function aiBlockedReason(code) {
  if (!isUntranslated(code)) return null;
  return 'AI drafting and tightening currently work on English text only.';
}

/**
 * D5 — the finalize warning for a non-English narrative, or null for English.
 *
 * It states plainly that the narrative is not in English and has not been
 * translated, and it is a WARNING: finalizing is never blocked because of
 * language (§2 invariant 2 — the AI can be off, and a report that cannot be
 * filed is a worse outcome than one filed in Bisaya and flagged).
 *
 * @param {unknown} code
 * @returns {string|null}
 */
export function finalizeLanguageWarning(code) {
  if (!isUntranslated(code)) return null;
  return (
    `The narrative is written in ${languageLabel(code)} and has NOT been translated to English. ` +
    'Confirm only if the station accepts an untranslated narrative — it will be filed and printed as written.'
  );
}

/**
 * D6 — the line the printed sheet carries, or null for English.
 *
 * The sheet is the document of record, and a reader of it cannot tell a Bisaya
 * narrative from a badly-written English one. Only a non-English declaration
 * prints this, so an English report's sheet is byte-for-byte what it was.
 *
 * @param {unknown} code
 * @returns {string|null}
 */
export function printLanguageLine(code) {
  if (!isUntranslated(code)) return null;
  return `Narrative language: ${languageShort(code)} (not translated)`;
}

/**
 * D7 — the language suggested for a NEW report: the one that officer last
 * used, or English.
 *
 * A SUGGESTION only. It is put in the selector, visible and changeable, and it
 * is never applied to an existing report (the editor always shows a stored
 * report's own value) and never applied silently.
 *
 * "Most recent" is the greatest `id`, not the top of the list. The reports
 * list is sorted by INCIDENT date, which is not when the report was written,
 * and — for an Admin — it is the whole station's blotter rather than that
 * officer's own, so the rows are filtered to the author first.
 *
 * @param {Array<object>|null} reports rows from GET /reports (need id, created_by, narrative_language)
 * @param {number|string|null} userId the officer creating the report
 * @returns {string} a known code
 */
export function suggestedLanguage(reports, userId) {
  const own = (Array.isArray(reports) ? reports : []).filter(
    (r) => r && Number(r.created_by) === Number(userId),
  );
  if (own.length === 0) return DEFAULT_LANGUAGE;

  let newest = null;
  for (const r of own) {
    if (newest === null || Number(r.id) > Number(newest.id)) newest = r;
  }
  // A row whose language is missing or unrecognised (an old client's, a bad
  // restore) suggests nothing — English, rather than a language it never had.
  return normaliseLanguage(newest?.narrative_language);
}

/**
 * The hint under the selector. Says the one thing an officer might otherwise
 * get wrong: this field records what the text IS, and changing it does not
 * change the text.
 * @returns {string}
 */
export function languageHint() {
  return 'The language you wrote the narrative in. This is a label for the record — changing it never alters the text.';
}
