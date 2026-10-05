// BlueWrite — Phase 6 Stage 5 (Track A): the language registry.
//
// Two things are proven here:
//
//   1. BEHAVIOUR-PRESERVING. For the five shipped languages, everything the
//      registry derives (codes, labels, shorts, glossary coverage, native-gloss
//      flags, translatability) equals what the hard-coded lists held before this
//      track. That equality is the whole safety argument for the refactor: the
//      registry replaced a constant, and the constant's values are what came out.
//
//   2. NOTHING IN THE CLIENT CAN ENABLE A LANGUAGE. The registry is installed
//      from the server's bootstrap payload, which deliberately carries no
//      evidence fields; the holder has no setter for enablement, only the whole
//      list. The disabled-language notice is asserted verbatim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  setLanguageRegistry,
  getLanguageRegistry,
  findLanguage,
  registryCodes,
  glossaryCodes,
  translationEnabled,
  translationDisabledNotice,
} from '../../src/lib/languageRegistry.js';
import {
  narrativeLanguageOptions,
  languageLabel,
  languageShort,
  normaliseLanguage,
} from '../../src/lib/reportLanguages.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(readFileSync(resolve(root, 'resources/ai/language_registry.json'), 'utf8'));

// The values the hard-coded lists held BEFORE Track A — the target of proof 1.
const BEFORE_CODES = ['en', 'ceb', 'tl', 'mixed', 'other'];
const BEFORE_LABELS = {
  en: 'English',
  ceb: 'Bisaya (Cebuano)',
  tl: 'Tagalog',
  mixed: 'Mixed',
  other: 'Other',
};
const BEFORE_SHORTS = { en: 'English', ceb: 'Bisaya', tl: 'Tagalog', mixed: 'Mixed', other: 'Other' };
const BEFORE_GLOSSARY = ['ceb', 'tl'];
const BEFORE_PROVIDER_LABELS = {
  en: 'English',
  ceb: 'Bisaya (Cebuano)',
  tl: 'Tagalog',
  mixed: 'a mix of Bisaya and/or Tagalog and English',
  other: 'another language',
};

setLanguageRegistry(registry.languages);

// ---- 1. behaviour-preserving ------------------------------------------------

test('the registry data file is well-formed and every entry is complete', () => {
  assert.ok(Array.isArray(registry.languages), 'the file needs a languages array');
  assert.ok(registry.languages.length > 0);
  for (const l of registry.languages) {
    for (const field of ['code', 'label', 'short', 'provider_label']) {
      assert.equal(typeof l[field], 'string', `${l.code}.${field} must be a string`);
      assert.ok(l[field].length > 0, `${l.code}.${field} must not be empty`);
    }
    for (const flag of ['native_gloss', 'glossary_supported', 'translation_enabled']) {
      assert.equal(typeof l[flag], 'boolean', `${l.code}.${flag} must be a boolean`);
    }
    // Evidence is PRESENT (so the owner has somewhere to record it) and starts
    // unresolved — no language has been reviewed yet.
    assert.ok(l.evidence && typeof l.evidence === 'object', `${l.code} needs an evidence block`);
  }
});

test('BEHAVIOUR-PRESERVING: codes, labels and shorts equal the old constants', () => {
  assert.deepEqual(registryCodes(), BEFORE_CODES);
  assert.deepEqual(narrativeLanguageOptions().map((l) => l.code), BEFORE_CODES);
  for (const code of BEFORE_CODES) {
    assert.equal(languageLabel(code), BEFORE_LABELS[code], `label for ${code}`);
    assert.equal(languageShort(code), BEFORE_SHORTS[code], `short for ${code}`);
  }
});

test('BEHAVIOUR-PRESERVING: the glossary covers exactly ceb/tl, as before', () => {
  assert.deepEqual(glossaryCodes(), BEFORE_GLOSSARY);
});

test('BEHAVIOUR-PRESERVING: translatability matches Stage 3 (en excluded, rest on)', () => {
  assert.equal(translationEnabled('en'), false, 'English is never a source');
  for (const code of ['ceb', 'tl', 'mixed', 'other']) {
    assert.equal(translationEnabled(code), true, `${code} was translatable before this track`);
  }
  assert.equal(translationEnabled('klingon'), false, 'an unknown code is never translatable');
});

test('BEHAVIOUR-PRESERVING: native_gloss matches the prompt\'s stated rule', () => {
  // resources/ai/narrative_system_prompt.txt says to return sourceGloss "in the
  // officer's own language (Bisaya for ceb, Tagalog for tl)" and "an EMPTY
  // string when the source language is mixed or other". The registry must say
  // the same thing — the prompt is not generated from it (invariant 4: prompt
  // additions only), so this test is what stops the two drifting.
  assert.deepEqual(
    BEFORE_CODES.filter((c) => findLanguage(c).native_gloss),
    ['ceb', 'tl'],
  );
  assert.equal(findLanguage('mixed').native_gloss, false);
  assert.equal(findLanguage('other').native_gloss, false);
  assert.equal(findLanguage('en').native_gloss, false);
});

// (A "BEHAVIOUR-PRESERVING: the printed line…" test stood here, and it went with
//  the printed line itself: the sheet no longer carries "Narrative language: …
//  (not translated)" — owner request, 2026-10-06, see ReportSheetBody.jsx. The
//  registry `short` field it read is still asserted above, and the server still
//  sends it (LanguageRegistry::short), so nothing else moved with it.)

test('BEHAVIOUR-PRESERVING: the read-side fallback still reads junk as English', () => {
  assert.equal(normaliseLanguage('ceb'), 'ceb');
  assert.equal(normaliseLanguage('klingon'), 'en');
  assert.equal(normaliseLanguage(undefined), 'en');
  assert.equal(normaliseLanguage(''), 'en');
});

// ---- 2. nothing in the client can enable anything ---------------------------

test('a NEW language is translatable only if the data file says so', () => {
  setLanguageRegistry([
    ...registry.languages,
    {
      code: 'hil',
      label: 'Hiligaynon',
      short: 'Hiligaynon',
      provider_label: 'Hiligaynon',
      native_gloss: true,
      glossary_supported: false,
      translation_enabled: false, // a new language starts DISABLED
    },
  ]);
  assert.equal(translationEnabled('hil'), false, 'a new language starts disabled');
  assert.equal(languageLabel('hil'), 'Hiligaynon', 'but it is still a named language');
  // It is storable/selectable (the code is known), just not translatable.
  assert.equal(normaliseLanguage('hil'), 'hil');
  setLanguageRegistry(registry.languages);
});

test('the registry holder carries no evidence fields from the server payload', () => {
  // The bootstrap payload the client installs deliberately omits `evidence`:
  // an approval must not be displayable as a quality claim.
  const payload = registry.languages.map((l) => ({
    code: l.code,
    label: l.label,
    short: l.short,
    native_gloss: l.native_gloss,
    glossary_supported: l.glossary_supported,
    translation_enabled: l.translation_enabled,
  }));
  setLanguageRegistry(payload);
  for (const l of getLanguageRegistry()) {
    assert.equal(l.evidence, undefined, `${l.code} must not carry evidence client-side`);
  }
  setLanguageRegistry(registry.languages);
});

test('an empty registry is an honest state, not a broken one', () => {
  // Before the bootstrap lands there is no list. A selector with nothing in it
  // beats one offering a code the server would reject — and a stored language
  // is passed through rather than mislabelled English (see normaliseLanguage).
  setLanguageRegistry([]);
  assert.deepEqual(registryCodes(), []);
  assert.deepEqual(narrativeLanguageOptions(), []);
  assert.equal(translationEnabled('ceb'), false);
  assert.equal(normaliseLanguage('ceb'), 'ceb', 'a stored ceb must never read as English');
  assert.equal(normaliseLanguage(''), 'en');
  setLanguageRegistry(registry.languages);
});

// ---- 3. the one wording for a disabled language -----------------------------

test('the disabled-translation notice is the approved sentence, verbatim', () => {
  assert.equal(
    translationDisabledNotice(),
    "Saved as written. AI translation isn't available for this language yet.",
  );
  // Facts first, then the limit — no fault, no jargon.
  assert.match(translationDisabledNotice(), /^Saved as written\./);
  for (const word of ['certif', 'official', 'accurat', 'valid']) {
    assert.ok(!translationDisabledNotice().toLowerCase().includes(word));
  }
});
