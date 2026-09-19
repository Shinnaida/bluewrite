// BlueWrite — Phase 6 Stage 2: the bilingual report-terminology table.
// docs/PHASE6_MULTILINGUAL.md §4, and the glossary's §13.
//
// WHAT THIS IS, AND WHAT IT IS NOT. It is a table of APPROVED report terms —
// domain words where the choice of English changes legal meaning (nasakpan →
// "apprehended", never "arrested"). It is NOT a translator. There is no
// sentence handling, no fuzzy matching, no suggested translations of words
// outside the table. §4 of the plan is explicit that a dictionary read as a
// translator mistranslates confidently, and the whole point of this stage is
// to not build that.
//
// Pure functions only: no React, no DOM, no network. The same module is used
// by the derivation script (Node), the drift guard (node:test) and the officer
// lookup (browser), so none of the three can disagree about what an entry means
// or which entries are publishable.
//
// The covered languages come from the language registry (Phase 6 Stage 5,
// Track A): the Node entry points must install it once with
// setLanguageRegistry() before validating — see scripts/derive-narrative-terms.mjs.
import { glossaryCodes } from './languageRegistry.js';
import { languageLabel } from './reportLanguages.js';

/**
 * The languages this table covers — Bisaya (Cebuano) and Tagalog today.
 *
 * Phase 6 Stage 5 (Track A, D3): read from the LANGUAGE REGISTRY's
 * `glossary_supported` flag, not held here. The flag is deliberately narrower
 * than the narrative language list: `en`, `mixed` and `other` are storable
 * narrative languages but can never carry a glossary entry (there is no single
 * source language to translate a term FROM). A language becomes covered here
 * only when the owner marks it `glossary_supported` in the registry.
 *
 * @returns {string[]}
 */
export function termLanguages() {
  return glossaryCodes();
}

/** The fixed category set. A value outside this set is a validation error. */
export const TERM_CATEGORIES = [
  'act-or-offence',
  'statute',
  'evidence-or-injury',
  'report-part',
  'other',
];

/** An entry is either an inert draft or an approved, publishable term. */
export const TERM_STATUSES = ['draft', 'approved'];

/**
 * The glossary section this module parses. Only this section is read, so the
 * rest of the glossary (the prompt rules) can never be mistaken for entries.
 */
export const GLOSSARY_SECTION_HEADING = '## §13';

/** Columns of the §13 table, in order. */
export const COLUMNS = [
  'id',
  'language',
  'term',
  'forms',
  'category',
  'english',
  'do_not_render_as',
  'note',
  'status',
  'approved_by',
  'approved_on',
];

/** Minimum characters before the lookup will match anything. */
export const MIN_QUERY_LENGTH = 2;

/**
 * The sentence that sits under the lookup box, always visible. It is the
 * scope rule in one line: this is a terminology table, not a translator, and
 * absence means "not covered", not "no such word".
 */
export const SCOPE_TEXT =
  'Approved report terminology — not a translator. A word not listed here is not covered.';

// ---------------------------------------------------------------------------
// Parsing the glossary
// ---------------------------------------------------------------------------

const EMPTY_ROW = new Set(['', '-', '—']);

/** Split a `;`-separated cell into a trimmed, non-empty list. */
function splitList(cell) {
  return String(cell ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** A cell value, trimmed; the visible em-dash placeholder means "empty". */
function cell(value) {
  const v = String(value ?? '').trim();
  return EMPTY_ROW.has(v) ? '' : v;
}

/**
 * Parse the §13 markdown table out of the glossary document.
 *
 * Returns `{ entries, errors }`. A malformed row becomes an error (never a
 * silently dropped entry — a dropped entry is an approved term that would
 * vanish from the lookup with nobody noticing).
 *
 * @param {string} markdown the whole glossary document
 * @returns {{entries: Array<object>, errors: Array<string>}}
 */
export function parseGlossaryTerms(markdown) {
  const errors = [];
  const lines = String(markdown ?? '').split(/\r?\n/);

  const start = lines.findIndex((l) => l.trim().startsWith(GLOSSARY_SECTION_HEADING));
  if (start === -1) {
    return { entries: [], errors: [`glossary: section "${GLOSSARY_SECTION_HEADING}" not found`] };
  }

  // Collect the section body: from after the heading to the next `## ` heading.
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }

  // The table rows are the lines that look like `| ... |`.
  const tableLines = body.filter((l) => l.trim().startsWith('|'));
  if (tableLines.length === 0) {
    return { entries: [], errors: [`glossary: no table rows under "${GLOSSARY_SECTION_HEADING}"`] };
  }

  const entries = [];
  let sawHeader = false;
  for (const line of tableLines) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    // Header row then the `---` separator row.
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    if (cells.length !== COLUMNS.length) {
      errors.push(
        `glossary: table row has ${cells.length} cells, expected ${COLUMNS.length} ` +
        `(row starts "${cells.slice(0, 3).join(' | ')}")`,
      );
      continue;
    }

    const raw = Object.fromEntries(COLUMNS.map((col, i) => [col, cells[i]]));
    entries.push({
      id: cell(raw.id),
      language: cell(raw.language),
      term: cell(raw.term),
      forms: splitList(raw.forms),
      category: cell(raw.category),
      english: cell(raw.english),
      do_not_render_as: splitList(raw.do_not_render_as),
      note: cell(raw.note),
      status: cell(raw.status),
      approved_by: cell(raw.approved_by),
      approved_on: cell(raw.approved_on),
    });
  }

  return { entries, errors };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate parsed entries against every rule the §13 spec states. Returns a
 * list of human-readable problems, each naming the entry and the rule, or an
 * empty array when the table is sound.
 *
 * @param {Array<object>} entries
 * @returns {Array<string>}
 */
export function validateEntries(entries) {
  const errors = [];
  const seenIds = new Map();

  for (const e of entries) {
    const id = e.id || '(no id)';
    const where = (rule) => `entry "${id}": ${rule}`;

    if (!e.id) {
      errors.push('entry with no id');
    } else {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) {
        errors.push(where('id must be lowercase letters, digits and hyphens'));
      }
      if (seenIds.has(e.id)) {
        errors.push(where('duplicate id'));
      } else {
        seenIds.set(e.id, true);
      }
    }

    if (!termLanguages().includes(e.language)) {
      errors.push(where(`language must be one of ${termLanguages().join(', ')}`));
    } else if (e.id && !e.id.startsWith(`${e.language}-`)) {
      errors.push(where(`id must start with "${e.language}-"`));
    }

    if (!e.term) errors.push(where('term is required'));

    if (!TERM_CATEGORIES.includes(e.category)) {
      errors.push(where(`category must be one of ${TERM_CATEGORIES.join(', ')}`));
    }

    if (!e.english) errors.push(where('english is required'));

    if (e.do_not_render_as.some((d) => d.toLowerCase() === e.english.toLowerCase())) {
      errors.push(where('do_not_render_as must not contain the english rendering'));
    }

    if (String(e.note ?? '').includes('|')) {
      errors.push(where('note must not contain a "|" (it would break the table row)'));
    }

    if (!TERM_STATUSES.includes(e.status)) {
      errors.push(where(`status must be one of ${TERM_STATUSES.join(', ')}`));
    }

    if (e.status === 'approved') {
      if (!e.approved_by) errors.push(where('an approved entry requires approved_by'));
      if (!e.approved_on) errors.push(where('an approved entry requires approved_on'));
      if (e.approved_on && !/^\d{4}-\d{2}-\d{2}$/.test(e.approved_on)) {
        errors.push(where('approved_on must be written YYYY-MM-DD'));
      }
    } else if (e.status === 'draft') {
      if (e.approved_by || e.approved_on) {
        errors.push(where('a draft entry must not carry approved_by / approved_on'));
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** The published shape: what a consumer of the derived file sees. */
function published(entry) {
  return {
    id: entry.id,
    language: entry.language,
    term: entry.term,
    forms: entry.forms,
    category: entry.category,
    english: entry.english,
    do_not_render_as: entry.do_not_render_as,
    note: entry.note,
  };
}

/**
 * The approved entries only, as published objects, sorted by id so the output
 * is deterministic. Drafts never appear here — this is the one guarantee that
 * makes a draft inert everywhere that matters.
 *
 * @param {Array<object>} entries
 * @returns {Array<object>}
 */
export function deriveApproved(entries) {
  return entries
    .filter((e) => e.status === 'approved')
    .map(published)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The header written at the top of the derived JSON. */
export const DERIVED_COMMENT =
  'DERIVED FILE — do not edit here first. Approved bilingual report terminology, ' +
  'derived from docs/bluewrite-police-terminology-glossary.md §13 by ' +
  'scripts/derive-narrative-terms.mjs. Only status:approved entries appear; this ' +
  'is report terminology, NOT a translator. Update the glossary first, then re-derive.';

/**
 * Serialise the derived file. Byte-deterministic: same entries in, same bytes
 * out, which is what lets the drift guard compare a fresh derivation against
 * the committed file with a string equality.
 *
 * @param {Array<object>} approved
 * @returns {string}
 */
export function serialiseDerived(approved) {
  const payload = {
    _comment: DERIVED_COMMENT,
    generated_from: 'docs/bluewrite-police-terminology-glossary.md §13',
    entries: approved,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// The officer lookup (offline, exact-term, prefix matching only)
// ---------------------------------------------------------------------------

/**
 * Fold text for MATCHING only: lowercase, strip diacritics, collapse spaces.
 * The stored text is never altered for DISPLAY — typing "Pena" finds "Peña"
 * and the result still reads "Peña".
 *
 * @param {unknown} input
 * @returns {string}
 */
export function foldForSearch(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search the approved table. Exact-term lookup with PREFIX matching only:
 * "sakp" finds "sakpan" / "nasakpan". No fuzzy, no semantic, no suggestions
 * for words outside the table.
 *
 * @param {Array<object>} entries approved entries (the derived table)
 * @param {string} query what the officer typed
 * @param {string} language 'all', 'ceb' or 'tl'
 * @returns {{results: Array<object>, tooShort: boolean, query: string}}
 */
export function searchTerms(entries, query, language = 'all') {
  const q = foldForSearch(query);
  const list = Array.isArray(entries) ? entries : [];
  const filtered = language && language !== 'all'
    ? list.filter((e) => e.language === language)
    : list;

  if (q.length < MIN_QUERY_LENGTH) {
    return { results: [], tooShort: q.length > 0, query: q };
  }

  const results = filtered
    .filter((e) => {
      const hay = [e.term, ...(Array.isArray(e.forms) ? e.forms : [])].map(foldForSearch);
      return hay.some((h) => h.startsWith(q));
    })
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { results, tooShort: false, query: q };
}

/**
 * The languages offered in the lookup's filter. 'all' first, then the ones the
 * table covers, with the same plain-words labels the report editor uses — both
 * read from the registry, so the filter cannot offer a language the server
 * would reject an entry for.
 *
 * @returns {Array<{code: string, label: string}>}
 */
export function lookupLanguages() {
  return [
    { code: 'all', label: 'All languages' },
    ...termLanguages().map((code) => ({ code, label: languageLabel(code) })),
  ];
}

/**
 * The filter the lookup opens on: the report's own language when it is one the
 * table covers, otherwise "all languages". A suggestion, always changeable.
 *
 * @param {unknown} reportLanguage
 * @returns {string}
 */
/**
 * The plain-words name of a category, for the full panel's browse control. The
 * stored category codes (act-or-offence, …) mean nothing to a desk officer.
 */
export const TERM_CATEGORY_LABELS = {
  'act-or-offence': 'Act or offence',
  statute: 'Statute',
  'evidence-or-injury': 'Evidence or injury',
  'report-part': 'Part of the report',
  other: 'Other',
};

/** @param {unknown} code @returns {string} */
export function categoryLabel(code) {
  return TERM_CATEGORY_LABELS[code] ?? String(code ?? '');
}

/**
 * The approved entries grouped for browsing, in the fixed category order and
 * omitting categories with no entries (so an empty table shows no headings).
 *
 * @param {Array<object>} entries approved entries
 * @returns {Array<{code: string, label: string, entries: Array<object>}>}
 */
export function groupByCategory(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return TERM_CATEGORIES
    .filter((c) => list.some((e) => e.category === c))
    .map((c) => ({
      code: c,
      label: categoryLabel(c),
      entries: list.filter((e) => e.category === c),
    }));
}

/**
 * The tokens of a text, folded — the unit `termsInText` matches against.
 * Splits on anything that is not a letter or a digit, exactly as the server's
 * pinned-term matcher does (GeminiNarrativeProvider::matchPinnedTerms).
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenSet(text) {
  const tokens = new Set();
  for (const tok of foldForSearch(text).split(/[^\p{L}\p{N}]+/u)) {
    if (tok !== '') tokens.add(tok);
  }
  return tokens;
}

/**
 * "Terms found in your text" — the approved terms whose `term` or a `forms`
 * entry appears, as a WHOLE token, in what the officer has written.
 *
 * This is the Stage 3 pinned-term matching, run on the client for the officer
 * to see: deterministic, offline, no model. It has to be the same rule the
 * server uses to pin terms, or the panel would promise something the
 * translation does not do. Two things it is NOT: it is not fuzzy (an affixed
 * form missing from `forms` does not match — the recorded limitation), and it
 * is not a suggestion to put anything into the narrative. The panel copies
 * nothing on its own.
 *
 * The client folds with NFD (foldForSearch) where the server folds with a
 * fixed Latin map; the two agree on the fixture set the tests pin, and a
 * difference could only change what is DISPLAYED here, never the model's
 * instruction.
 *
 * @param {Array<object>} entries approved entries (the derived table)
 * @param {string|Array<string>} texts the officer's own text(s)
 * @param {number} [limit] the same cap the server applies
 * @returns {Array<object>} the matched entries
 */
export function termsInText(entries, texts, limit = 25) {
  const list = Array.isArray(entries) ? entries : [];
  const parts = (Array.isArray(texts) ? texts : [texts]).filter(
    (t) => typeof t === 'string' && t !== '',
  );
  const joined = parts.join('\n');
  if (list.length === 0 || joined.trim() === '') return [];

  const tokens = tokenSet(joined);
  const found = [];
  for (const e of list) {
    const needles = [e?.term, ...(Array.isArray(e?.forms) ? e.forms : [])];
    for (const needle of needles) {
      const folded = foldForSearch(needle);
      if (folded !== '' && tokens.has(folded)) {
        found.push(e);
        break;
      }
    }
  }
  return found.slice(0, limit);
}

/**
 * The filter the lookup opens on: the report's own language when it is one the
 * table covers, otherwise "all languages". A suggestion, always changeable.
 *
 * @param {unknown} reportLanguage
 * @returns {string}
 */
export function defaultLookupLanguage(reportLanguage) {
  return termLanguages().includes(reportLanguage) ? reportLanguage : 'all';
}
