// BlueWrite — the language an officer DECLARES for the narrative.
// Phase 6 Stage 1 (docs/PHASE6_MULTILINGUAL.md §5.4). Pure functions, no React,
// no DOM — covered by node:test.
//
// Three things about this module are deliberate and worth not "fixing":
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
// Stored codes mirror ReportsController::NARRATIVE_LANGUAGES and migration 007.
// Keep the two lists in step, the way REPORTER_FIELDS mirrors
// ReportRules::validateReporterParty().

/**
 * The five declarations, in the order the selector offers them.
 *
 * `label` is what an officer reads in the selector — plain words, because
 * "ceb" tells a desk officer nothing. `short` is for printed lines, where
 * "Bisaya (Cebuano)" would sit inside D6's own parentheses and read as
 * "Bisaya (Cebuano) (not translated)".
 */
export const NARRATIVE_LANGUAGES = [
  { code: 'en', label: 'English', short: 'English' },
  { code: 'ceb', label: 'Bisaya (Cebuano)', short: 'Bisaya' },
  { code: 'tl', label: 'Tagalog', short: 'Tagalog' },
  { code: 'mixed', label: 'Mixed', short: 'Mixed' },
  { code: 'other', label: 'Other', short: 'Other' },
];

/** English: the stored default, and what an absent value means. */
export const DEFAULT_LANGUAGE = 'en';

/** The server's Cebuano/Tagalog label for the "not in English" note. */
const BY_CODE = new Map(NARRATIVE_LANGUAGES.map((l) => [l.code, l]));

/**
 * Is this one of the five codes?
 *
 * The column is a VARCHAR, so it can hold anything — the API is what rejects
 * an unknown code. This function exists because a value can also arrive from
 * outside the API: a stored report read back, a restored draft in
 * sessionStorage, an old row. Anything unrecognised is treated as English
 * (see normaliseLanguage) rather than being shown as a language.
 *
 * @param {unknown} code
 * @returns {boolean}
 */
export function isKnownLanguage(code) {
  return typeof code === 'string' && BY_CODE.has(code);
}

/**
 * A usable code from anything: a known code passes through, everything else
 * becomes 'en'.
 *
 * This is the READ-side guard, and it is not the same job as the API's
 * validation. The API REJECTS an unknown code from a client (422, never
 * coerced) because a wrong declaration is the officer's to fix. A READ has no
 * officer to ask, so it falls back to the only safe reading — the one that
 * prints an English report rather than claiming a language the station has
 * never heard of.
 *
 * @param {unknown} code
 * @returns {string}
 */
export function normaliseLanguage(code) {
  return isKnownLanguage(code) ? code : DEFAULT_LANGUAGE;
}

/**
 * The plain-words name of a language, for anything a person reads.
 * @param {unknown} code
 * @returns {string}
 */
export function languageLabel(code) {
  return (BY_CODE.get(normaliseLanguage(code)) ?? BY_CODE.get(DEFAULT_LANGUAGE)).label;
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
  return `Narrative language: ${(BY_CODE.get(normaliseLanguage(code)) ?? BY_CODE.get(DEFAULT_LANGUAGE)).short} (not translated)`;
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
