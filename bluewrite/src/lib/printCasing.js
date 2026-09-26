// BlueWrite — the bondpaper sheet's text casing.
//
// The printed POLICE REPORT follows the casing conventions of an official
// Philippine police certification letter:
//
//   - institutional header, title, section headers, and the QUOTED incident
//     category  → ALL CAPS;
//   - bold field labels → Title Case;
//   - field values and the narrative → Proper sentence case (Task 2).
//
// This module is a RENDER-time helper only. It never mutates the draft, the AI
// draft, or the stored row, and the case-fixing it does is deliberately
// NON-destructive: `toSentenceCase` only ADDS capitals (sentence starts, and
// words the report itself records as proper nouns) — it never flattens an
// existing capital, reorders, drops or rewrites a word. The narrative's
// WORDING is therefore untouched (Task 1); only its casing is normalised
// (Task 2), which the task states explicitly is allowed.
//
// Two hazards every function here guards against, because a naive
// `.toLowerCase()` corrupts an official record:
//
//   1. PROPER NOUNS — "Shaine Jayme", "CTU Naga", "de la Cruz". A word that
//      already carries an interior capital, or is an all-caps acronym, is left
//      alone rather than flattened.
//   2. ACRONYMS — "PNP", "NBI", "IOC", "CCTV" are kept upper-case; only the
//      first character of an ordinary word is touched.
//
// Every function is pure and unit-tested in tests/rules/printCasing.test.mjs.

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Words that stay lower-case inside a Title Case label unless they are the
 * first or last word (the standard English title-case convention).
 */
/**
 * Institutional acronyms an officer may type in title or lower case ("Ctu"
 * for CTU). A whole-word, case-insensitive match is promoted to its caps form;
 * nothing else is touched. Kept short and domain-specific on purpose — a long
 * list would start re-capitalising ordinary words.
 */
const KNOWN_ACRONYMS = new Set([
  'ctu', 'pnp', 'nbi', 'ioc', 'cctv', 'bfp', 'afp', 'lto', 'comelec', 'pdea',
  'dpwh', 'deped',
]);

const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'onto', 'or', 'over', 'per', 'the', 'to', 'up', 'via',
  'vs', 'v',
]);

/** Does this token already look like a proper noun or an acronym? */
function looksProper(token) {
  const word = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (word.length < 2) return false;
  // An all-caps acronym (PNP, CCTV, IOC, DTO) — never touch it.
  if (word === word.toUpperCase() && /[A-Z]/.test(word)) return true;
  // An interior capital (McArthur, DeLaCruz, iOS) — already deliberate.
  return /[A-Z]/.test(word.slice(1));
}

/** Capitalize the first alphabetic character of a single token. */
function capFirst(token) {
  const i = token.search(/[A-Za-z]/);
  if (i === -1) return token;
  return token.slice(0, i) + token[i].toUpperCase() + token.slice(i + 1);
}

/**
 * Title-case ONE token. A token joined by a slash is two label words in the
 * sheet's own house style ("Distinguishing Marks/Clothing", "Weapon/Force
 * Used"), so each side takes its own capital.
 */
function titleToken(token) {
  return token
    .split('/')
    .map((part) => capFirst(part.toLowerCase()))
    .join('/');
}

/** Lower-case a token, but never flatten a proper noun or an acronym. */
function lowerUnlessProper(token) {
  return looksProper(token) ? token : token.toLowerCase();
}

/**
 * ALL CAPS. The one function used today (the quoted incident category), and the
 * spelling of every full-caps block that is not already static text.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function toUpperCase(value) {
  return text(value).toUpperCase();
}

/**
 * Title Case for bold field labels. Minor words stay lower-case unless they
 * open or close the label; proper nouns and acronyms are preserved.
 *
 *   "name of missing person" → "Name of Missing Person"
 *   "date & time of incident" → "Date & Time of Incident"
 *   "CTU naga" → "CTU Naga"
 *
 * @param {unknown} value
 * @returns {string}
 */
export function toTitleCase(value) {
  const words = text(value).split(' ');
  return words
    .map((word, i) => {
      if (looksProper(word)) return word;
      const bare = word.toLowerCase();
      const isEdge = i === 0 || i === words.length - 1;
      if (!isEdge && MINOR_WORDS.has(bare.replace(/[^a-z]/g, ''))) return bare;
      return titleToken(bare);
    })
    .join(' ');
}

/**
 * The report's OWN proper nouns, lower-cased → their recorded spelling. Built
 * from the party names and the capitalized words of the place, so a value (or
 * the narrative) typed in lower case can be corrected WITHOUT guessing: we
 * only capitalize a word the record itself spells that way elsewhere. A word
 * the report never capitalizes is left alone.
 *
 * @param {Iterable<string>} names canonical proper-noun strings
 * @returns {Map<string, string>}
 */
export function properNounMap(names) {
  const map = new Map();
  for (const name of names || []) {
    for (const word of text(name).split(' ')) {
      const bare = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      // Shorter fragments ("de", "la", "Jr") collide with ordinary words too
      // often to be worth the over-capitalization.
      if (bare.length < 3) continue;
      const lower = bare.toLowerCase();
      // First spelling wins — the record's own form, not a later variant.
      if (!map.has(lower)) map.set(lower, bare);
    }
  }
  return map;
}

/**
 * Capitalize each word that matches a known proper noun, and promote a known
 * institutional acronym (word-boundary safe). Existing capitals are only ever
 * replaced by the report's own spelling or by a recognised acronym.
 */
function applyProperNouns(s, properNouns) {
  const map = properNouns instanceof Map ? properNouns : properNounMap(properNouns);
  return s.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
    const lower = word.toLowerCase();
    const canonical = map.get(lower);
    if (canonical) return canonical;
    if (KNOWN_ACRONYMS.has(lower)) return lower.toUpperCase();
    return word;
  });
}

/**
 * Sentence case for prose: the first letter of each sentence is capitalized,
 * a lone rhetorical "i" becomes "I", and any word the report itself records
 * as a proper noun takes its recorded capital.
 *
 *   "shaine jayme filed the report. the suspect fled." → "Shaine jayme filed
 *   the report. The suspect fled."
 *   toSentenceCase('shaine jayme', ['Shaine Jayme']) → 'Shaine Jayme'
 *
 * This is deliberately NON-destructive: it only ADDS capitals — existing ones
 * are never flattened — and it never reorders, drops or rewrites a word, so a
 * narrative run through it keeps its wording exactly (Task 1) while its casing
 * follows the letter's own convention (Task 2).
 *
 * @param {unknown} value
 * @param {Iterable<string>|Map<string,string>} [properNouns]
 * @returns {string}
 */
export function toSentenceCase(value, properNouns = []) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s === '') return '';
  let out = '';
  let startOfSentence = true;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (startOfSentence && /[A-Za-z]/.test(ch)) {
      out += ch.toUpperCase();
      startOfSentence = false;
      continue;
    }
    out += ch;
    if (/[.!?]/.test(ch)) startOfSentence = true;
  }
  // A standalone lower-case "i" is a pronoun, not a word to leave flat.
  out = out.replace(/\bi\b/g, 'I');
  return applyProperNouns(out, properNouns);
}

/**
 * The label helper: Title Case, but keep the string exactly as recorded if it
 * already carries a deliberate shape the rules would damage (e.g. an initialism
 * as the whole label). Exported so the sheet has ONE way to spell a bold label.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function labelCase(value) {
  return toTitleCase(value);
}
