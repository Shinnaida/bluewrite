// BlueWrite — Phase 6 Stage 1: the declared narrative language.
//
// Runs with Node's built-in runner (node --test tests/rules/). Two halves:
//
//   1. reportLanguages.js — the pure module the editor, the sheet and the rule
//      engine all read. If the sheet and the form ever disagreed about what
//      "ceb" means, it would be because one of them stopped using this file.
//
//   2. reportRules.js — that exactly ONE rule reads the narrative's own words
//      (the English medical-term casualty check), that it is SKIPPED for a
//      narrative declared in another language, and that English behaviour is
//      bit-for-bit what it was before this phase.
//
// The fixtures here are the brief's §7 strings. They exist to exercise text
// handling and language plumbing, not to be legal renderings of anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateReport } from '../../src/lib/reportRules.js';
import { setLanguageRegistry } from '../../src/lib/languageRegistry.js';
import {
  narrativeLanguageOptions,
  DEFAULT_LANGUAGE,
  isKnownLanguage,
  normaliseLanguage,
  languageLabel,
  isUntranslated,
  untranslatedNotice,
  aiBlockedReason,
  finalizeLanguageWarning,
  printLanguageLine,
  suggestedLanguage,
  languageHint,
} from '../../src/lib/reportLanguages.js';

// Phase 6 Stage 5 (Track A) — the language SET now comes from the registry, so
// every read in this file depends on it being installed. In the app that is the
// POST /login or GET /me bootstrap; here it is the committed data file, read
// directly. The five shipped languages are what the assertions below expect,
// which is the behaviour-preserving proof for Stage 1's module.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLanguageRegistry(
  JSON.parse(readFileSync(resolve(root, 'resources/ai/language_registry.json'), 'utf8')).languages,
);

// ---- fixtures (§7 of the Stage 1 brief) ------------------------------------

const BISAYA = 'Gidala sa ospital ang biktima. Nasakpan ang suspek sa mga pulis.';
const TAGALOG = 'Dinala sa ospital ang biktima. Nahuli ang suspek ng mga pulis sa Peña Street.';
const MIXED = 'The suspek nasakpan sa Barangay Lahug human sa insidente.';

const NON_ENGLISH = ['ceb', 'tl', 'mixed', 'other'];

// ---- 1. the selector and the codes -----------------------------------------

test('the five declarations are offered, English first, in plain words', () => {
  assert.deepEqual(
    narrativeLanguageOptions().map((l) => l.code),
    ['en', 'ceb', 'tl', 'mixed', 'other'],
  );
  assert.equal(narrativeLanguageOptions()[0].code, DEFAULT_LANGUAGE);
  // No bare codes in the selector: "ceb" means nothing to a desk officer.
  for (const l of narrativeLanguageOptions()) {
    assert.ok(l.label.length > 2, `${l.code} needs a readable label`);
    assert.ok(!/^[a-z]{2,5}$/.test(l.label), `${l.label} looks like a code, not a label`);
  }
});

test('a printed line has a short name, so D6 does not nest parentheses', () => {
  const ceb = narrativeLanguageOptions().find((l) => l.code === 'ceb');
  assert.notEqual(ceb.short, ceb.label);
  assert.ok(!ceb.short.includes('('), 'the short form must not carry its own parentheses');
  assert.match(printLanguageLine('ceb'), /\(not translated\)$/);
});

test('isKnownLanguage accepts the five codes and nothing else', () => {
  for (const code of ['en', 'ceb', 'tl', 'mixed', 'other']) assert.ok(isKnownLanguage(code));
  for (const notACode of ['', 'EN', 'Ceb', 'fil', 'bis', 'cebuano', null, undefined, 7, {}, []]) {
    assert.ok(!isKnownLanguage(notACode), `${JSON.stringify(notACode)} must not be a known code`);
  }
});

test('normaliseLanguage falls back to English rather than inventing a language', () => {
  assert.equal(normaliseLanguage('ceb'), 'ceb');
  // The read-side guard: a stored row, a restored draft or an old client can
  // carry anything at all. English is the only safe reading — it is what every
  // report was before this phase.
  assert.equal(normaliseLanguage(undefined), 'en');
  assert.equal(normaliseLanguage(null), 'en');
  assert.equal(normaliseLanguage(''), 'en');
  assert.equal(normaliseLanguage('klingon'), 'en');
  assert.equal(normaliseLanguage(['ceb']), 'en');
});

test('"untranslated" is derived from the language, never stored separately', () => {
  assert.equal(isUntranslated('en'), false);
  assert.equal(isUntranslated(undefined), false);
  for (const code of NON_ENGLISH) assert.equal(isUntranslated(code), true, code);
  // And it is exactly the same question as "is this not English".
  for (const code of [...NON_ENGLISH, 'en', 'bogus', null]) {
    assert.equal(isUntranslated(code), normaliseLanguage(code) !== 'en');
  }
});

test('languageLabel names a language, and never throws on junk', () => {
  assert.equal(languageLabel('en'), 'English');
  assert.equal(languageLabel('ceb'), 'Bisaya (Cebuano)');
  assert.equal(languageLabel('tl'), 'Tagalog');
  assert.equal(languageLabel('mixed'), 'Mixed');
  assert.equal(languageLabel('other'), 'Other');
  assert.equal(languageLabel('nonsense'), 'English');
});

// ---- 2. the messages the officer actually reads -----------------------------

test('English shows no untranslated notice; a non-English declaration does', () => {
  assert.equal(untranslatedNotice('en'), null);
  assert.equal(untranslatedNotice(undefined), null);
  for (const code of NON_ENGLISH) {
    const notice = untranslatedNotice(code);
    assert.ok(notice, `${code} needs a notice`);
    assert.match(notice, /not translated to English/);
    // Calm and factual: filing in Bisaya is supported, not an error.
    assert.match(notice, /saved, printed and filed exactly as written/);
  }
});

test('D3 — the AI reason is the brief\'s wording, and only for non-English', () => {
  assert.equal(aiBlockedReason('en'), null);
  assert.equal(aiBlockedReason(undefined), null);
  for (const code of NON_ENGLISH) {
    assert.equal(
      aiBlockedReason(code),
      'AI drafting and tightening currently work on English text only.',
    );
  }
});

test('D5 — the finalize warning states it is untranslated and never blocks', () => {
  assert.equal(finalizeLanguageWarning('en'), null);
  assert.equal(finalizeLanguageWarning(undefined), null);
  for (const code of NON_ENGLISH) {
    const w = finalizeLanguageWarning(code);
    assert.match(w, /has NOT been translated to English/);
    // A warning the officer can accept, not a refusal.
    assert.match(w, /Confirm only if/);
    assert.doesNotMatch(w, /\b(cannot|must not|blocked|error)\b/i);
  }
});

test('D6 — the sheet says nothing for English', () => {
  assert.equal(printLanguageLine('en'), null);
  assert.equal(printLanguageLine(undefined), null);
  assert.equal(printLanguageLine('bogus'), null);
  assert.equal(printLanguageLine('ceb'), 'Narrative language: Bisaya (not translated)');
  assert.equal(printLanguageLine('tl'), 'Narrative language: Tagalog (not translated)');
  assert.equal(printLanguageLine('mixed'), 'Narrative language: Mixed (not translated)');
  assert.equal(printLanguageLine('other'), 'Narrative language: Other (not translated)');
});

test('the selector hint says the one thing an officer could misread', () => {
  assert.match(languageHint(), /never alters the text/);
});

// ---- 3. D7 — the suggestion for a NEW report --------------------------------

test('D7 suggests the officer\'s own most recent language, by id', () => {
  const rows = [
    // The list is sorted by INCIDENT date, so the highest id is not last, and
    // for an Admin it holds the whole station's blotter — both reasons this
    // cannot just read rows[0].
    { id: 40, created_by: 7, narrative_language: 'en' },
    { id: 12, created_by: 7, narrative_language: 'ceb' },
    { id: 55, created_by: 9, narrative_language: 'tl' }, // another officer
    { id: 90, created_by: 7, narrative_language: 'mixed' }, // newest of my own
    { id: 3, created_by: 7, narrative_language: 'tl' },
  ];
  assert.equal(suggestedLanguage(rows, 7), 'mixed');
});

test('D7 falls back to English, and never suggests an unusable code', () => {
  assert.equal(suggestedLanguage([], 7), 'en');
  assert.equal(suggestedLanguage(null, 7), 'en');
  // No reports of my own: another officer's language is not a suggestion.
  assert.equal(suggestedLanguage([{ id: 1, created_by: 9, narrative_language: 'ceb' }], 7), 'en');
  // An old row (or a bad restore) with no usable language suggests nothing.
  assert.equal(suggestedLanguage([{ id: 5, created_by: 7, narrative_language: 'klingon' }], 7), 'en');
  assert.equal(suggestedLanguage([{ id: 5, created_by: 7 }], 7), 'en');
  // A string id from an URL/param still identifies the author.
  assert.equal(suggestedLanguage([{ id: 2, created_by: '7', narrative_language: 'tl' }], 7), 'tl');
});

// ---- 4. the rule engine is language-aware (§7 test 5) ----------------------

/**
 * A Traffic Accident with a recorded casualty and a narrative that says the
 * victim was taken for treatment — in English it uses none of the words the
 * rule looks for, in Bisaya it says "ospital", which the English regex cannot
 * see. That is precisely the false warning Stage 1 has to stop producing.
 */
function casualtyDraft(narrative, language) {
  return {
    incident_type: 'Traffic Accident',
    incident_datetime: '2026-09-01T10:30',
    location: 'Barangay Lahug, Cebu City',
    narrative,
    action_taken: 'Turned over to the station for proper disposition.',
    ioc_name: 'Sgt. Test Investigator',
    narrative_language: language,
    type_specific: {
      injured_persons: [{ name: 'Juan Dela Cruz', injury_status: 'Serious' }],
    },
  };
}

const medicalWarnings = (result) =>
  result.warnings.filter((w) => /does not mention medical response/i.test(w.message));

test('English: a casualty with no medical mention STILL warns (no regression)', () => {
  const draft = casualtyDraft(
    'The team responded to a road crash and secured the area. ' +
      'The parties were interviewed and their statements recorded in full.',
    'en',
  );
  const found = medicalWarnings(validateReport(draft, 'finalize'));
  assert.equal(found.length, 1, 'the English check must still fire');
  assert.equal(found[0].path, 'narrative');
});

test('English: a narrative that does mention medical response still passes', () => {
  const draft = casualtyDraft(
    'The victim was brought to the hospital by ambulance and handed to the attending physician.',
    'en',
  );
  assert.equal(medicalWarnings(validateReport(draft, 'finalize')).length, 0);
});

test('non-English: a CORRECT native narrative produces no false medical warning', () => {
  const fixtures = { ceb: BISAYA, tl: TAGALOG, mixed: MIXED, other: MIXED };
  for (const code of NON_ENGLISH) {
    const draft = casualtyDraft(fixtures[code], code);
    assert.equal(
      medicalWarnings(validateReport(draft, 'finalize')).length,
      0,
      `${code} must not collect an English-only warning`,
    );
  }
});

test('the language can come from the draft itself, so no caller can forget it', () => {
  // A caller that has a draft and no language argument — the shape every
  // pre-existing caller has — must still skip the check, because the draft
  // knows what language it is.
  const draft = casualtyDraft(BISAYA, 'ceb');
  assert.equal(medicalWarnings(validateReport(draft, 'finalize')).length, 0);

  // An explicit language argument is what the editor passes, and it agrees.
  assert.equal(medicalWarnings(validateReport(draft, 'finalize', 'ceb')).length, 0);

  // The differential: relabel the SAME text English and the warning returns,
  // proving the skip is driven by the declaration and not by the text.
  assert.equal(medicalWarnings(validateReport(draft, 'finalize', 'en')).length, 1);
});

test('an absent or unusable language behaves exactly like English', () => {
  const draft = casualtyDraft(
    'The team responded to a road crash and secured the area. ' +
      'The parties were interviewed and their statements recorded in full.',
    undefined,
  );
  for (const arg of [undefined, null, 'en', 'klingon', '', ['ceb']]) {
    assert.equal(
      medicalWarnings(validateReport(draft, 'finalize', arg)).length,
      1,
      `language ${JSON.stringify(arg)} must fall back to the English check`,
    );
  }
});

test('English reports produce byte-identical findings to before the phase', () => {
  const draft = casualtyDraft(
    'The victim was brought to the hospital by ambulance and handed to the attending physician.',
    'en',
  );
  // The whole result, not just the warnings — an English report must be
  // untouched, which is §2 invariant 3 of the brief.
  assert.deepEqual(
    validateReport(draft, 'finalize'),
    validateReport(draft, 'finalize', 'en'),
  );
  assert.deepEqual(validateReport(draft, 'draft'), validateReport(draft, 'draft', 'en'));
  assert.deepEqual(
    validateReport(draft, 'finalize'),
    validateReport({ ...draft, narrative_language: undefined }, 'finalize'),
  );
});

test('language-independent rules still work in every language', () => {
  // Structure, required fields and dates are not English questions, so a
  // Bisaya report must still be held to them — the skip is one rule wide.
  for (const code of NON_ENGLISH) {
    const draft = casualtyDraft(BISAYA, code);
    const result = validateReport(draft, 'finalize');
    // No location: a missing required field is reported whatever the language.
    assert.ok(
      validateReport({ ...draft, location: '' }, 'finalize').errors.some(
        (e) => e.path === 'location',
      ),
      `${code}: a missing required field must still be an error`,
    );
    // And the narrative's own floor is kept for all languages (Step 0 Q6).
    assert.ok(
      validateReport({ ...draft, narrative: 'too short' }, 'finalize').errors.some(
        (e) => e.path === 'narrative',
      ),
      `${code}: the narrative length rule must keep working`,
    );
    assert.ok(result, `${code}: validation must return a result`);
  }
});
