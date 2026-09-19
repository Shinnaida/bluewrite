// BlueWrite — Phase 6 Stage 2: the bilingual report-terminology table.
//
// Runs with Node's built-in runner (node --test tests/rules/). Three jobs:
//
//   1. FORMAT VALIDATION — every rule the glossary §13 spec states has a
//      passing and a failing case, using test-only fixtures (never the real
//      glossary content).
//   2. DERIVATION + DRIFT GUARD — the committed derived file must equal a
//      fresh derivation of the real glossary, drafts must never reach it, and
//      the derivation must be deterministic.
//   3. LOOKUP MATCHING — prefix, case- and diacritic-insensitive matching, the
//      language filter, and the empty/too-short paths. This is the pure half of
//      the officer lookup; the React rendering has no test infrastructure in
//      this project and is covered by a manual procedure in the Stage 2 record.
//
// These fixtures exist to exercise the rules. They are NOT legal renderings of
// anything — the real table ships with zero approved entries on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setLanguageRegistry } from '../../src/lib/languageRegistry.js';
import {
  GLOSSARY_SECTION_HEADING,
  TERM_CATEGORIES,
  TERM_CATEGORY_LABELS,
  termLanguages,
  categoryLabel,
  groupByCategory,
  termsInText,
  MIN_QUERY_LENGTH,
  parseGlossaryTerms,
  validateEntries,
  deriveApproved,
  serialiseDerived,
  searchTerms,
  foldForSearch,
  defaultLookupLanguage,
} from '../../src/lib/narrativeTerms.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const glossaryPath = resolve(root, 'docs/bluewrite-police-terminology-glossary.md');
const derivedPath = resolve(root, 'resources/ai/narrative_terms.json');

// Phase 6 Stage 5 (Track A) — the covered languages come from the language
// registry's glossary_supported flag, so install it before validating.
setLanguageRegistry(
  JSON.parse(readFileSync(resolve(root, 'resources/ai/language_registry.json'), 'utf8')).languages,
);

// ---- fixtures ---------------------------------------------------------------

/** A valid approved entry, then per-rule mutations of it. */
function approvedEntry(overrides = {}) {
  return {
    id: 'ceb-sakpan',
    language: 'ceb',
    term: 'sakpan',
    forms: ['sakpan', 'nasakpan', 'gisakpan'],
    category: 'act-or-offence',
    english: 'apprehended',
    do_not_render_as: ['arrested'],
    note: 'The source says the person was caught.',
    status: 'approved',
    approved_by: 'Records/Legal Officer',
    approved_on: '2026-09-19',
    ...overrides,
  };
}

function draftEntry(overrides = {}) {
  return {
    id: 'ceb-natulog',
    language: 'ceb',
    term: 'natulog',
    forms: [],
    category: 'act-or-offence',
    english: 'slept',
    do_not_render_as: [],
    note: '',
    status: 'draft',
    approved_by: '',
    approved_on: '',
    ...overrides,
  };
}

const PENA = {
  id: 'tl-pena',
  language: 'tl',
  term: 'Peña',
  forms: ['Peña', 'pena'],
  category: 'other',
  english: 'Peña',
  do_not_render_as: [],
  note: '',
  status: 'approved',
  approved_by: 'Records/Legal Officer',
  approved_on: '2026-09-19',
};

// ---- 1. format validation ---------------------------------------------------

test('a well-formed approved entry validates cleanly', () => {
  assert.deepEqual(validateEntries([approvedEntry()]), []);
});

test('a well-formed draft entry validates cleanly', () => {
  assert.deepEqual(validateEntries([draftEntry()]), []);
});

test('duplicate ids are rejected', () => {
  const errors = validateEntries([approvedEntry(), approvedEntry()]);
  assert.ok(errors.some((e) => e.includes('duplicate id')), JSON.stringify(errors));
});

test('an approved entry requires approved_by and approved_on', () => {
  assert.ok(validateEntries([approvedEntry({ approved_by: '' })]).some((e) => e.includes('approved_by')));
  assert.ok(validateEntries([approvedEntry({ approved_on: '' })]).some((e) => e.includes('approved_on')));
  assert.ok(
    validateEntries([approvedEntry({ approved_on: '19/09/2026' })])
      .some((e) => e.includes('YYYY-MM-DD')),
  );
});

test('a draft must not carry approver fields', () => {
  const errors = validateEntries([draftEntry({ approved_by: 'Someone' })]);
  assert.ok(errors.some((e) => e.includes('must not carry')), JSON.stringify(errors));
});

test('an entry missing english is rejected', () => {
  assert.ok(validateEntries([approvedEntry({ english: '' })]).some((e) => e.includes('english is required')));
});

test('do_not_render_as may not contain the english rendering', () => {
  const errors = validateEntries([approvedEntry({ do_not_render_as: ['apprehended'] })]);
  assert.ok(errors.some((e) => e.includes('must not contain the english')), JSON.stringify(errors));
});

test('an unknown category is rejected, and the fixed set is what we think it is', () => {
  assert.deepEqual(TERM_CATEGORIES, ['act-or-offence', 'statute', 'evidence-or-injury', 'report-part', 'other']);
  assert.ok(validateEntries([approvedEntry({ category: 'felony' })]).some((e) => e.includes('category')));
});

test('an unknown language is rejected, and only ceb/tl are covered', () => {
  // Registry-derived: the glossary_supported flag is deliberately narrower than
  // the narrative languages, so en/mixed/other can never carry a term.
  assert.deepEqual(termLanguages(), ['ceb', 'tl']);
  for (const code of ['en', 'mixed', 'other']) {
    assert.ok(
      validateEntries([approvedEntry({ language: code, id: `${code}-x` })]).some((e) => e.includes('language must be')),
      `${code} must not be an allowed terminology language`,
    );
  }
});

// ---- Track B: the full panel's browse and "found in your text" ------------

test('browsing groups by category in the fixed order, and omits empty ones', () => {
  const a = approvedEntry({ id: 'ceb-saksi', term: 'saksi', category: 'report-part' });
  const b = approvedEntry({ id: 'ceb-sakpan', category: 'act-or-offence' });
  const groups = groupByCategory([a, b]);
  assert.deepEqual(groups.map((g) => g.code), ['act-or-offence', 'report-part']);
  assert.deepEqual(groups.map((g) => g.label), ['Act or offence', 'Part of the report']);
  assert.deepEqual(groups[1].entries.map((e) => e.id), ['ceb-saksi']);
  // An empty table produces no headings at all.
  assert.deepEqual(groupByCategory([]), []);
  assert.deepEqual(groupByCategory(null), []);
});

test('a category renders in plain words, and never as a bare code', () => {
  assert.deepEqual(Object.keys(TERM_CATEGORY_LABELS), TERM_CATEGORIES);
  for (const c of TERM_CATEGORIES) {
    assert.ok(categoryLabel(c).length > 2, `${c} needs a readable label`);
    assert.ok(!categoryLabel(c).includes('-'), `${c} must not surface its spelling`);
  }
  assert.equal(categoryLabel('unknown-thing'), 'unknown-thing');
});

test('"terms found in your text" matches a term, a form, and folds diacritics', () => {
  const entries = [
    approvedEntry({ id: 'ceb-sakpan', term: 'sakpan', forms: ['sakpan', 'nasakpan'] }),
    approvedEntry({ id: 'ceb-saksi', term: 'saksi', forms: ['saksi', 'mga saksi'], category: 'report-part' }),
    approvedEntry({ id: 'tl-pena', language: 'tl', id: 'tl-pena', term: 'Peña', forms: ['peña'], english: 'pena' }),
  ];
  // The plain term, and an inflected form.
  assert.deepEqual(termsInText(entries, 'Nasakpan ang suspek.').map((e) => e.id), ['ceb-sakpan']);
  assert.deepEqual(termsInText(entries, 'Sakpan siya.').map((e) => e.id), ['ceb-sakpan']);
  // A diacritic on both sides folds the same way.
  assert.deepEqual(termsInText(entries, 'Naa sa Pena Street.').map((e) => e.id), ['tl-pena']);
  // Several terms, and one entry is reported once however many forms hit.
  assert.deepEqual(
    termsInText(entries, 'Nasakpan siya; duha ka saksi.').map((e) => e.id),
    ['ceb-sakpan', 'ceb-saksi'],
  );
});

test('"terms found in your text" is WHOLE-TOKEN, not a substring search', () => {
  // This is the recorded limitation, asserted rather than assumed: an affixed
  // form that is not in `forms` does NOT match.
  const entries = [approvedEntry({ id: 'ceb-huli', term: 'huli', forms: ['huli', 'nahuli'] })];
  assert.deepEqual(termsInText(entries, 'Ang nahulian sa bagyo.'), []);
  assert.deepEqual(termsInText(entries, 'Nahuli ang suspek.').map((e) => e.id), ['ceb-huli']);
  // Punctuation and line breaks are token boundaries, as on the server.
  assert.deepEqual(termsInText(entries, 'huli,\nsa wakas').map((e) => e.id), ['ceb-huli']);
});

test('"terms found in your text" is empty when there is nothing to match', () => {
  const entries = [approvedEntry({ id: 'ceb-huli', term: 'huli', forms: ['huli', 'nahuli'] })];
  assert.deepEqual(termsInText([], 'huli'), []);
  assert.deepEqual(termsInText(entries, ''), []);
  assert.deepEqual(termsInText(entries, '   '), []);
  assert.deepEqual(termsInText(entries, null), []);
  assert.deepEqual(termsInText(entries, ['', undefined, 'Walay labot.']), []);
  // An array of the officer's texts is joined, so a term in any of them counts.
  assert.deepEqual(
    termsInText(entries, ['Walay labot.', 'Nahuli siya.']).map((e) => e.id),
    ['ceb-huli'],
  );
});

test('"terms found in your text" applies the server\'s cap', () => {
  const entries = Array.from({ length: 40 }, (_, i) =>
    approvedEntry({ id: `ceb-w${String(i).padStart(2, '0')}`, term: `word${i}` }),
  );
  const text = entries.map((e) => e.term).join(' ');
  assert.equal(termsInText(entries, text).length, 25);
});

test('an id must start with the entry language', () => {
  assert.ok(validateEntries([approvedEntry({ id: 'tl-sakpan' })]).some((e) => e.includes('must start with')));
});

test('a note may not contain a pipe (it would break the table)', () => {
  assert.ok(validateEntries([approvedEntry({ note: 'a | b' })]).some((e) => e.includes('|')));
});

test('the same headword may exist in both languages as two separate entries', () => {
  const both = [
    approvedEntry({ id: 'ceb-saksi', term: 'saksi' }),
    approvedEntry({ id: 'tl-saksi', language: 'tl', term: 'saksi' }),
  ];
  assert.deepEqual(validateEntries(both), []);
});

// ---- 2. derivation ----------------------------------------------------------

test('only approved entries are derived; a draft is inert', () => {
  const out = deriveApproved([approvedEntry(), draftEntry(), PENA]);
  assert.deepEqual(out.map((e) => e.id), ['ceb-sakpan', 'tl-pena']);
  assert.ok(!out.some((e) => e.id === 'ceb-natulog'), 'a draft must never be published');
});

test('the derivation is deterministic and idempotent', () => {
  const entries = [PENA, approvedEntry(), draftEntry()];
  const a = serialiseDerived(deriveApproved(entries));
  const b = serialiseDerived(deriveApproved([...entries].reverse()));
  assert.equal(a, b, 'order of the input must not change the output bytes');
});

test('the published shape drops approver fields and keeps the display fields', () => {
  const [e] = deriveApproved([approvedEntry()]);
  assert.deepEqual(
    Object.keys(e).sort(),
    ['category', 'do_not_render_as', 'english', 'forms', 'id', 'language', 'note', 'term'].sort(),
  );
});

// ---- 3. drift guard (the real repository files) -----------------------------

const glossary = readFileSync(glossaryPath, 'utf8');
const derivedRaw = readFileSync(derivedPath, 'utf8');

test('the glossary §13 section is present and parses without error', () => {
  const { entries, errors } = parseGlossaryTerms(glossary);
  assert.deepEqual(errors, []);
  assert.ok(entries.length > 0, `no entries parsed under ${GLOSSARY_SECTION_HEADING}`);
});

test('every §13 entry in the real glossary passes validation', () => {
  const { entries, errors } = parseGlossaryTerms(glossary);
  assert.deepEqual(errors, []);
  assert.deepEqual(validateEntries(entries), []);
});

test('DRIFT: the committed derived file equals a fresh derivation of the glossary', () => {
  const { entries, errors } = parseGlossaryTerms(glossary);
  assert.deepEqual(errors, []);
  const fresh = serialiseDerived(deriveApproved(entries));
  assert.equal(
    derivedRaw,
    fresh,
    'resources/ai/narrative_terms.json is out of date — run `node scripts/derive-narrative-terms.mjs`',
  );
});

test('DRIFT: no draft id appears anywhere in the derived file', () => {
  const { entries } = parseGlossaryTerms(glossary);
  const drafts = entries.filter((e) => e.status === 'draft').map((e) => e.id);
  for (const id of drafts) {
    assert.ok(!derivedRaw.includes(`"${id}"`), `draft "${id}" leaked into the derived file`);
  }
});

test('the derived file is valid JSON and holds only fully-formed entries', () => {
  const parsed = JSON.parse(derivedRaw);
  assert.ok(Array.isArray(parsed.entries));
  for (const e of parsed.entries) {
    assert.ok(e.id && e.language && e.term && e.english, `entry ${e.id} is missing a required field`);
    assert.ok(termLanguages().includes(e.language), `entry ${e.id} has an unknown language`);
    assert.ok(TERM_CATEGORIES.includes(e.category), `entry ${e.id} has an unknown category`);
    assert.ok(Array.isArray(e.forms) && Array.isArray(e.do_not_render_as));
  }
});

// ---- 4. lookup matching -----------------------------------------------------

const TABLE = deriveApproved([approvedEntry(), PENA, draftEntry()]);

test('matches on the headword', () => {
  const { results } = searchTerms(TABLE, 'sakpan', 'all');
  assert.deepEqual(results.map((e) => e.id), ['ceb-sakpan']);
});

test('matches on an inflected form (nasakpan)', () => {
  const { results } = searchTerms(TABLE, 'nasak', 'all');
  assert.deepEqual(results.map((e) => e.id), ['ceb-sakpan']);
});

test('prefix matching: a short prefix finds the term', () => {
  const { results } = searchTerms(TABLE, 'sak', 'all');
  assert.equal(results.length, 1);
});

test('matching is case-insensitive', () => {
  assert.equal(searchTerms(TABLE, 'SAKPAN', 'all').results.length, 1);
});

test('matching is diacritic-insensitive, and the display keeps the stored accent', () => {
  const { results } = searchTerms(TABLE, 'Pena', 'all');
  assert.deepEqual(results.map((e) => e.id), ['tl-pena']);
  assert.equal(results[0].term, 'Peña', 'display must show the exact stored text');
});

test('the language filter narrows the results', () => {
  assert.equal(searchTerms(TABLE, 's', 'ceb').results.every((e) => e.language === 'ceb'), true);
  assert.deepEqual(searchTerms(TABLE, 'pena', 'ceb').results, []);
  assert.deepEqual(searchTerms(TABLE, 'pena', 'tl').results.map((e) => e.id), ['tl-pena']);
});

test('a query below the minimum length matches nothing and is reported as too short', () => {
  const one = searchTerms(TABLE, 's', 'all');
  assert.equal(one.results.length, 0);
  assert.equal(one.tooShort, true);
  assert.equal(MIN_QUERY_LENGTH, 2);
});

test('no match for a term outside the table (no fuzzy, no suggestions)', () => {
  const { results } = searchTerms(TABLE, 'gidala', 'all');
  assert.deepEqual(results, []);
});

test('a draft fixture is never returned by the lookup', () => {
  assert.deepEqual(searchTerms(TABLE, 'natulog', 'all').results, []);
});

test('the lookup works with zero approved entries (the state at ship)', () => {
  const { results, tooShort } = searchTerms([], 'sakpan', 'all');
  assert.deepEqual(results, []);
  assert.equal(tooShort, false);
});

test('the filter default follows the report language only when the table covers it', () => {
  assert.equal(defaultLookupLanguage('ceb'), 'ceb');
  assert.equal(defaultLookupLanguage('tl'), 'tl');
  assert.equal(defaultLookupLanguage('en'), 'all');
  assert.equal(defaultLookupLanguage('mixed'), 'all');
  assert.equal(defaultLookupLanguage(undefined), 'all');
});

test('foldForSearch is the only normalisation, and it never alters display text', () => {
  assert.equal(foldForSearch('  Peña  '), 'pena');
  assert.equal(foldForSearch('SAKPAN'), 'sakpan');
});

test('the parse only reads the §13 section, not the rest of the glossary', () => {
  const html = `${GLOSSARY_SECTION_HEADING} Title\n\n${'| id | language | term | forms | category | english | do_not_render_as | note | status | approved_by | approved_on |'}\n${'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'}\n${'| ceb-x | ceb | x | | other | X | | | draft | | |'}\n\n## §14 Something else\n| ceb-y | ceb | y | | other | Y | | | draft | | |\n`;
  const { entries } = parseGlossaryTerms(html);
  assert.deepEqual(entries.map((e) => e.id), ['ceb-x']);
});
