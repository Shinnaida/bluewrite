// BlueWrite — the language an officer DECLARES for the narrative.
// Phase 6 Stage 1 (docs/PHASE6_MULTILINGUAL.md §5.4); Stage 5 Track A (D3) made
// the language SET a registry read rather than a list held here.
// Pure functions, no React, no DOM — covered by node:test.
//
// Things about this module that are deliberate and worth not "fixing":
//
//   * The language is DETECTED, not declared — the owner's decision, and a
//     REVERSAL of §8 Q2 of the Phase 6 plan, which had settled on declaration
//     because detection by function words is unreliable. The unreliability is
//     real (ang, sa, mga, si, ni, na, wala and forty more belong to BOTH Bisaya
//     and Tagalog) and it is why detectNarrativeLanguage() is built the way it
//     is: only EXCLUSIVE evidence names a language, every ambiguity resolves to
//     English, and 'mixed' is claimed only when the two are in comparable
//     measure. See the section above that function for what that costs.
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
 * The compact name of a language — "Bisaya", not "Bisaya (Cebuano)" — for any
 * one-line label that also has to say something else. The server sends the same
 * form (`LanguageRegistry::short`, `AuthController`), so a client and a server
 * label cannot disagree about what a language is called in one line.
 *
 * IT NO LONGER FEEDS THE SHEET: the printed line it was read for was removed by
 * owner request (2026-10-06, see ReportSheetBody), and this remains the
 * registry's own accessor plus the drift guard in languageRegistry.test.mjs.
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

/* ===========================================================================
   AUTOMATIC DETECTION — the language is READ from the narrative

   This REVERSES §8 Q2 of the Phase 6 plan (see the module header). Detection is
   a heuristic and always will be: Cebuano and Tagalog share their subject
   markers, their linkers' ancestry and most of their function words, so no
   count of words can separate them the way a declaration could. The rules below
   are therefore shaped around which way a mistake should fail:

     * ONLY EXCLUSIVE EVIDENCE NAMES A LANGUAGE. Shared words — ang, sa, mga,
       si, ni, na, pa, ka, ko, wala… — are counted as "not English" and as
       nothing else. They can never make the text Tagalog or Bisaya; only the
       exclusive sets can.

     * EVERY AMBIGUITY RESOLVES TO ENGLISH. A narrative under three words, one
       lone marker, or any text neither list recognises reads as English. That
       is the verdict that changes nothing downstream: no "not translated" note,
       no language line on the printed sheet, no terminology table switched on,
       and no refusal of the English AI tools.

     * A NATIVE NARRATIVE WITH NO MARKER READS AS BISAYA. Text that is plainly
       not English but carries nothing that tells the two apart is filed as the
       station's own language rather than as a third thing.

   THE COST, stated where it is paid: a MISS IS SILENT. Bisaya written with
   mostly shared words — "Gidala sa ospital ang biktima" without gidala in a
   list — reads as English and is filed with no note. That is the direction
   chosen: a quiet miss is a report that looks exactly like one written in
   English, while a false positive labels a narrative, gates Tighten and picks a
   table the officer never asked for.
   =========================================================================== */

/**
 * Function words BOTH Bisaya and Tagalog use. Their presence says the text is
 * not English; it can never say which of the two it is.
 */
const SHARED_MARKERS = new Set([
  'ang', 'sa', 'mga', 'si', 'ni', 'na', 'pa', 'ba', 'ka', 'ko', 'mo',
  'ako', 'kami', 'siya', 'kay', 'niya', 'nila', 'kanila', 'iyo', 'iya', 'ninyo',
  'wala',
]);

/**
 * Words only Bisaya (Cebuano) uses — the marker list, not a dictionary. It
 * carries the function words that have no Tagalog twin and the incident verbs
 * and nouns this station's narratives are actually made of (gidakop, gipusil,
 * nasakpan, sakyanan…), because those are the words a robbery report repeats.
 */
const CEBUANO_MARKERS = new Set([
  'nga', 'ug', 'kaayo', 'gyud', 'gayud', 'ra', 'pud', 'hinuon', 'bahin',
  'nako', 'nimo', 'nato', 'kanako', 'kanimo', 'kaniya',
  'amo', 'amoa', 'amoang', 'atoa', 'among', 'akong', 'imong', 'iyang',
  'naa', 'naay', 'dunay', 'adunay', 'anaa', 'didto', 'dinhi', 'karon',
  'gahapon', 'buntag', 'udto', 'gabii', 'adlaw', 'tuig', 'bulan', 'alas',
  'balay', 'tawo', 'babaye', 'sakyanan', 'sundang', 'pusil',
  'dakop', 'gidakop', 'nasakpan', 'gidala', 'gipusil', 'gidunggab', 'gitulis',
  'gisulong', 'gibunalan', 'gikuha', 'giingon', 'miingon', 'niingon', 'ingon',
  'matod', 'sumala', 'tungod', 'aron', 'sulong', 'sulod', 'gawas', 'dapit',
  'unsa', 'kinsa', 'ngano', 'daghan', 'gamay', 'dako', 'maayo', 'lisod',
  'tabang', 'hubog', 'silingan', 'igsoon', 'ginikanan', 'karsel', 'prisohan',
  'husgado',
]);

/**
 * Words only Tagalog uses. Same rules as the Cebuano list: no shared word
 * appears here either ('mga' is Cebuano's plural marker too, and 'niya' is both
 * languages' possessive).
 */
const TAGALOG_MARKERS = new Set([
  'ng', 'hindi', 'ay', 'lang', 'din', 'rin', 'naman', 'yung', 'iyong', 'iyon',
  'dito', 'doon', 'sino', 'bakit', 'sana', 'po', 'daw', 'mayroon', 'meron',
  'natin', 'tayo', 'namin', 'kasi', 'dahil', 'upang', 'kapag', 'habang',
  'hanggang', 'kanina', 'kahapon', 'ngayon', 'bukas', 'gabi', 'umaga',
  'tanghali', 'araw', 'bahay', 'tao', 'babae', 'sasakyan', 'pera', 'kalsada',
  'presinto', 'bilangguan', 'hukuman', 'ginawa', 'gumawa', 'pinatay',
  'sinaksak', 'ninakaw', 'nagnakaw', 'nakuha', 'nahuli', 'dinala', 'dumating',
  'pumunta', 'umuwi', 'nasugatan', 'usapin', 'reklamo', 'testigo', 'tumawag',
  'tumakbo', 'pinagmulan', 'ibinigay', 'binigay', 'sinabi',
]);

/**
 * ENGLISH function words, and function words only. Content words are
 * deliberately absent: "police", "hospital" and "station" appear in a Bisaya
 * narrative as often as in an English one, so counting them would make the
 * English share of a Bisaya report look like a mix. This set answers exactly
 * one question — is this text partly English as well as native?
 */
const ENGLISH_MARKERS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'was', 'were', 'is', 'are', 'am', 'be',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'that', 'this',
  'these', 'those', 'there', 'here', 'he', 'she', 'they', 'it', 'we', 'i',
  'you', 'his', 'her', 'their', 'our', 'my', 'your', 'its', 'when', 'while',
  'after', 'before', 'then', 'not', 'no', 'had', 'has', 'have', 'did', 'does',
  'do', 'will', 'would', 'could', 'should', 'said', 'told', 'went', 'came',
  'took', 'them', 'him', 'us', 'me', 'if', 'so', 'as', 'about', 'around',
  'into', 'over', 'out', 'up', 'down', 'because', 'during', 'until', 'since',
  'which', 'who', 'what', 'where', 'why', 'how', 'all', 'any', 'some', 'very',
  'also', 'just', 'only',
]);

/** Below this many words there is nothing to read. */
const MIN_WORDS = 3;

/**
 * How much evidence a native reading needs. ONE marker is never a language: an
 * English narrative that borrows a local noun — "brought to the presinto" — is
 * not a Tagalog report, and a single stray function word must not relabel it,
 * disable Tighten and switch the terminology table under the officer's hands.
 */
const MIN_NATIVE_MARKERS = 2;

/** The share of a text that has to be English AND native before it is 'mixed'. */
const MIXED_SHARE = 0.2;

/**
 * The language claimed when the text is plainly not English and carries nothing
 * that tells the two apart. The station writes in Bisaya; a single unanswered
 * question is answered here rather than escalated to 'mixed', which would turn
 * the terminology table off for a report that is very likely Bisaya.
 */
const UNDISCRIMINATED = 'ceb';

/**
 * What language is this narrative IN?
 *
 * Returns one of the registry's codes — 'en', 'ceb' (Bisaya), 'tl' (Tagalog) or
 * 'mixed' — read from the text itself. The rules are the section above: only
 * exclusive evidence names a language, every ambiguity resolves to English, and
 * 'mixed' is claimed only when English and a native language, or Bisaya and
 * Tagalog, are present in comparable measure.
 *
 * It is deliberately NOT a language identifier: it is a six-way decision
 * between the four languages this station files in, made from a fixed word
 * list, and it is honest about the two ways it can be wrong — a miss (native
 * prose read as English) and a tie broken towards Bisaya.
 *
 * A verdict the registry does not carry is never returned. The API REJECTS an
 * unknown code with a 422 rather than coercing it (see normaliseLanguage), so a
 * suggestion the server would refuse has to become English here, not at save
 * time — an officer must never be blocked from filing by a guess.
 *
 * @param {unknown} text the narrative, as typed
 * @returns {'en'|'ceb'|'tl'|'mixed'} a code the registry carries
 */
export function detectNarrativeLanguage(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-zñ]+/g) ?? [];
  if (words.length < MIN_WORDS) return DEFAULT_LANGUAGE;

  let english = 0;
  let shared = 0;
  let cebuano = 0;
  let tagalog = 0;
  for (const word of words) {
    if (CEBUANO_MARKERS.has(word)) cebuano += 1;
    else if (TAGALOG_MARKERS.has(word)) tagalog += 1;
    else if (SHARED_MARKERS.has(word)) shared += 1;
    else if (ENGLISH_MARKERS.has(word)) english += 1;
  }

  const verdict = nativeVerdict({ english, shared, cebuano, tagalog }, words.length);
  return verdict === DEFAULT_LANGUAGE || isKnownLanguage(verdict) ? verdict : DEFAULT_LANGUAGE;
}

/**
 * The verdict half of detectNarrativeLanguage, split out so the rule reads as
 * one sentence: how much of the text is English, how much is native, and which
 * of the two native languages the exclusive markers point at.
 *
 * @param {{english: number, shared: number, cebuano: number, tagalog: number}} counts
 * @param {number} total words in the narrative
 * @returns {'en'|'ceb'|'tl'|'mixed'}
 */
function nativeVerdict({ english, shared, cebuano, tagalog }, total) {
  const native = shared + cebuano + tagalog;

  // Nothing to go on, or one lone marker: English, whatever the text does
  // elsewhere. See MIN_NATIVE_MARKERS.
  if (native < MIN_NATIVE_MARKERS) return DEFAULT_LANGUAGE;

  // English AND a native language, both carrying the text: a narrative that
  // switches language mid-report, which is what 'mixed' is for. The share is
  // there so English loanwords beside a fully native sentence cannot qualify.
  if (english >= MIN_NATIVE_MARKERS && native / total >= MIXED_SHARE) {
    return 'mixed';
  }

  if (cebuano > 0 && tagalog > 0) {
    const lo = Math.min(cebuano, tagalog);
    const hi = Math.max(cebuano, tagalog);
    // Within 2:1 of each other: the text is using both, not leaning on one.
    if (lo / hi >= 0.5) return 'mixed';
  }

  // Equal means neither exclusive set fired (both are zero — comparable pairs
  // were caught above), so the shared words are all the evidence there is.
  if (cebuano === tagalog) return UNDISCRIMINATED;
  return cebuano > tagalog ? 'ceb' : 'tl';
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
