// BlueWrite — station settings rules (tests/rules/).
//
// The screen and the server have to agree on two rule sets: the letterhead
// field limits (StationController::update's Validator) and the shape of a legal
// incident-type list (sanitizeTypes). These tests pin the second one in
// particular, because the failure it prevents is quiet — a list the screen
// accepts and the server refuses reads as "the save button does nothing".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_NOTED_BY,
  buildTypeRows,
  CANONICAL_TYPES,
  changedContactFields,
  changedHeaderFields,
  changedLetterheadStyle,
  composeLetterheadHtml,
  contactError,
  CONTACT_FIELDS,
  headerError,
  HEADER_FIELDS,
  LETTERHEAD_STYLE_ALIGN,
  LETTERHEAD_STYLE_DEFAULTS,
  LETTERHEAD_STYLE_FONTS,
  LETTERHEAD_STYLE_SEALS,
  letterheadCss,
  letterheadHtmlError,
  letterheadStyleError,
  LETTERHEAD_MAX_WORDS,
  resolveLetterheadStyle,
  isCanonical,
  MAX_TYPE_COUNT,
  MAX_TYPE_NAME,
  normaliseTypes,
  resolveContact,
  resolveHeader,
  sameTypes,
  STATION_DEFAULTS,
  typeListError,
} from '../../src/lib/stationSettings.js';

// ---------------------------------------------------------------------------
// The letterhead
// ---------------------------------------------------------------------------

test('resolveHeader fills every line from the built-in defaults', () => {
  const h = resolveHeader(null);
  for (const { key } of HEADER_FIELDS) {
    assert.equal(typeof h[key], 'string');
    assert.ok(h[key].length > 0, `${key} must not be blank`);
  }
  assert.equal(h.station_name, STATION_DEFAULTS.station_name);
});

test('resolveHeader takes the stored value and ignores blank/absent ones', () => {
  const h = resolveHeader({
    station_name: 'CITY of CEBU POLICE STATION',
    office_code: '   ', // blank → the default stands, not an empty line on the sheet
    province: 'nonsense', // not a header field → ignored
  });
  assert.equal(h.station_name, 'CITY of CEBU POLICE STATION');
  assert.equal(h.office_code, STATION_DEFAULTS.office_code);
  assert.equal(h.agency, STATION_DEFAULTS.agency);
  assert.ok(!('province' in h));
});

test('changedHeaderFields sends only what differs, trimmed', () => {
  const saved = resolveHeader(null);
  assert.deepEqual(changedHeaderFields(saved, saved), {});

  const edited = { ...saved, station_name: '  CITY of CEBU POLICE STATION  ' };
  assert.deepEqual(changedHeaderFields(edited, saved), {
    station_name: 'CITY of CEBU POLICE STATION',
  });
});

test('headerError mirrors the server: nothing blank, nothing over the limit', () => {
  assert.equal(headerError(resolveHeader(null)), null);

  const blank = { ...resolveHeader(null), station_name: '   ' };
  assert.match(headerError(blank), /Station name cannot be blank/);

  const long = { ...resolveHeader(null), office_code: 'x'.repeat(41) };
  assert.match(headerError(long), /at most 40 characters/);

  // A field AT its limit is legal — the server's Validator allows the max.
  const atLimit = { ...resolveHeader(null), office_code: 'x'.repeat(40) };
  assert.equal(headerError(atLimit), null);
});

// ---------------------------------------------------------------------------
// The incident-type list
// ---------------------------------------------------------------------------

test('normaliseTypes trims, drops blanks, dedupes and keeps order', () => {
  assert.deepEqual(normaliseTypes(['  Theft  ', '', 'Robbery', 'Theft', null, 'Theft']), [
    'Theft',
    'Robbery',
  ]);
  assert.deepEqual(normaliseTypes('not a list'), []);
  assert.deepEqual(normaliseTypes(undefined), []);
});

test('typeListError refuses an empty list and an over-long name', () => {
  assert.equal(typeListError(['Theft']), null);
  assert.match(typeListError([]), /at least one/);
  assert.match(typeListError(['Theft', 'A'.repeat(MAX_TYPE_NAME + 1)]), /longer than 60/);
  assert.equal(typeListError(['A'.repeat(MAX_TYPE_NAME)]), null);

  // The server caps the list at 40; a 41st name is a 422.
  const many = Array.from({ length: MAX_TYPE_COUNT + 1 }, (_, i) => `Type ${i}`);
  assert.match(typeListError(many), /At most 40/);
  assert.equal(typeListError(many.slice(0, MAX_TYPE_COUNT)), null);
});

test('sameTypes treats order as part of the datum', () => {
  assert.equal(sameTypes(['Theft', 'Robbery'], ['Theft', 'Robbery']), true);
  // Same members, different order: the station chose that order for its dropdown,
  // so it IS a change and must be saved.
  assert.equal(sameTypes(['Theft', 'Robbery'], ['Robbery', 'Theft']), false);
  assert.equal(sameTypes(['Theft'], ['Theft', 'Robbery']), false);
});

test('buildTypeRows keeps the stored order and appends the rest canonically', () => {
  const { rows, unknown } = buildTypeRows(['Robbery', 'Theft']);
  assert.deepEqual(unknown, []);
  // The two stored types keep their stored order and are offered...
  assert.deepEqual(rows.slice(0, 2), [
    { name: 'Robbery', enabled: true },
    { name: 'Theft', enabled: true },
  ]);
  // ...and every other canonical type follows, switched off, in canonical order.
  assert.equal(rows.length, CANONICAL_TYPES.length);
  assert.deepEqual(
    rows.slice(2).map((r) => r.name),
    CANONICAL_TYPES.filter((t) => t !== 'Robbery' && t !== 'Theft'),
  );
  assert.ok(rows.slice(2).every((r) => r.enabled === false));
});

test('buildTypeRows reports a configured name no schema knows, and keeps it', () => {
  const { rows, unknown } = buildTypeRows(['Theft', 'Curfew Violation']);
  assert.deepEqual(unknown, ['Curfew Violation']);
  // Not a row: the form never offered it, so there is nothing to switch off.
  assert.ok(!rows.some((r) => r.name === 'Curfew Violation'));
});

test('an empty stored list means the built-in 14, not "no types"', () => {
  // The server stores null for an empty list and Station::incidentTypes() then
  // answers with the built-in list — so the screen must draw them all as
  // OFFERED. Drawing them switched off would show the opposite of the form.
  for (const empty of [null, undefined, [], 'not a list', ['  ', '']]) {
    const { rows, unknown } = buildTypeRows(empty);
    assert.deepEqual(unknown, []);
    assert.deepEqual(
      rows.map((r) => r.name),
      CANONICAL_TYPES,
      `stored=${JSON.stringify(empty)} must be offered in canonical order`,
    );
    assert.ok(rows.every((r) => r.enabled));
  }
});

test('resolveContact fills the contact block with blanks, not letterhead defaults', () => {
  assert.deepEqual(resolveContact(null), { station_email: '', station_phone: '', noted_by: '' });
  const c = resolveContact({
    station_email: 'naga.invest@example.test',
    station_phone: '+63 (32) 123 4567',
    noted_by: 'Test Officer',
    agency: 'Republic of the Philippines', // a letterhead line → not a contact line
  });
  assert.equal(c.station_email, 'naga.invest@example.test');
  assert.equal(c.station_phone, '+63 (32) 123 4567');
  assert.equal(c.noted_by, 'Test Officer');
  assert.ok(!('agency' in c));
  assert.equal(resolveContact({ station_email: '   ' }).station_email, '');
});

test('changedContactFields sends only what differs, trimmed', () => {
  const saved = resolveContact(null);
  assert.deepEqual(changedContactFields(saved, saved), {});

  const edited = { ...saved, noted_by: '  Test Officer  ' };
  assert.deepEqual(changedContactFields(edited, saved), {
    noted_by: 'Test Officer',
  });
});

test('contactError mirrors the server: everything optional, malformed refused', () => {
  assert.equal(contactError(resolveContact(null)), null);

  const longNoted = { ...resolveContact(null), noted_by: 'x'.repeat(121) };
  assert.match(contactError(longNoted), /at most 120 characters/);

  // Blank clears the line — never an error — and the limit itself is legal.
  assert.equal(contactError({ noted_by: '' }), null);
  assert.equal(contactError({ noted_by: 'x'.repeat(120) }), null);
  // Legacy Gmail/telephone keys are no longer offered by the form and are
  // ignored by the validator, so an old row carrying them still passes.
  assert.equal(contactError({ noted_by: '', station_email: 'not-an-address', station_phone: '1'.repeat(41) }), null);
});

test('the built-in Noted By fallback is a real fallback, not a blank', () => {
  assert.ok(typeof BUILT_IN_NOTED_BY === 'string' && BUILT_IN_NOTED_BY.trim() !== '');
  assert.ok(CONTACT_FIELDS.some((f) => f.key === 'noted_by' && f.kind === 'officer'));
});

test('composeLetterheadHtml seeds the document from the standard lines', () => {
  const html = composeLetterheadHtml(resolveHeader(null), resolveContact(null));
  assert.match(html, /Republic of the Philippines/);
  assert.match(html, /<strong>/);
  assert.match(html, /align="center"/);
  // Contact lines ride along when set, each on its own line.
  const withContact = composeLetterheadHtml(resolveHeader(null), {
    station_email: 'naga.invest@example.test',
    station_phone: 'Tel No. 272-1166 (FAX)',
    noted_by: '',
  });
  assert.match(withContact, /Tel No\. 272-1166/);
  assert.match(withContact, /Email Add: naga\.invest@example\.test/);
  // Field text is escaped, never trusted as markup.
  const evil = composeLetterheadHtml({ ...resolveHeader(null), station_name: '<script>x</script>' }, null);
  assert.ok(!evil.includes('<script>'));
});

test('resolveLetterheadStyle fills the presentation from the built-in defaults', () => {
  const s = resolveLetterheadStyle(null);
  assert.deepEqual(s, LETTERHEAD_STYLE_DEFAULTS);
  assert.ok(LETTERHEAD_STYLE_FONTS.includes(s.font));
  assert.ok(LETTERHEAD_STYLE_ALIGN.includes(s.align));
  assert.ok(LETTERHEAD_STYLE_SEALS.includes(s.seals));
});

test('resolveLetterheadStyle keeps valid values and falls back on the rest', () => {
  const s = resolveLetterheadStyle({
    font: 'Georgia',
    size_px: 99, // out of range → default stands
    line_height: 1.75,
    color: 'red', // not a hex → default stands
    align: 'right',
    seals: 'stacked',
    evil: 'x', // unknown key → ignored
  });
  assert.equal(s.font, 'Georgia');
  assert.equal(s.size_px, LETTERHEAD_STYLE_DEFAULTS.size_px);
  assert.equal(s.line_height, 1.75);
  assert.equal(s.color, LETTERHEAD_STYLE_DEFAULTS.color);
  assert.equal(s.align, 'right');
  assert.equal(s.seals, 'stacked');
  assert.ok(!('evil' in s));
});

test('letterheadStyleError mirrors the server: ranges, hex, allowlists', () => {
  assert.equal(letterheadStyleError({}), null);
  assert.equal(letterheadStyleError({ font: 'Georgia', size_px: 16, color: '#fff', align: 'left', seals: 'swapped' }), null);
  assert.match(letterheadStyleError({ font: 'Comic Sans' }), /not offered/);
  assert.match(letterheadStyleError({ size_px: 9 }), /between 10 and 22/);
  assert.match(letterheadStyleError({ line_height: 3 }), /between 1.0 and 2.5/);
  assert.match(letterheadStyleError({ letter_spacing_px: -1 }), /between 0 and 3/);
  assert.match(letterheadStyleError({ color: 'red' }), /hex/);
  assert.match(letterheadStyleError({ align: 'top' }), /not offered/);
  assert.match(letterheadStyleError({ seals: 'left' }), /not offered/);
  assert.match(letterheadStyleError({ unknown: 1 }), /unknown setting/);
});

test('changedLetterheadStyle sends only what differs, and letterheadCss wears it', () => {
  const saved = resolveLetterheadStyle(null);
  assert.deepEqual(changedLetterheadStyle(saved, saved), {});
  const edited = { ...saved, size_px: 16, seals: 'stacked' };
  assert.deepEqual(changedLetterheadStyle(edited, saved), { size_px: 16, seals: 'stacked' });
  const css = letterheadCss(edited);
  assert.equal(css.fontSize, '16px');
  assert.equal(css.lineHeight, '1.5');
  assert.equal(css.color, LETTERHEAD_STYLE_DEFAULTS.color);
  assert.equal(css.textAlign, 'center');
  assert.match(css.fontFamily, /Arial/);
});

test('letterheadHtmlError reads length in words, not markup', () => {
  assert.equal(letterheadHtmlError(''), null);
  assert.equal(letterheadHtmlError('<div align="center"><p>Short</p></div>'), null);
  assert.match(letterheadHtmlError(`<p>${'w'.repeat(LETTERHEAD_MAX_WORDS + 1)}</p>`), /at most 2000/);
  // A long document of pure formatting still fits: only words count.
  assert.equal(letterheadHtmlError(`<div>${'<b></b>'.repeat(5000)}ok</div>`), null);
});

test('every canonical type has a schema, and only canonical names do', () => {
  // This is the invariant the screen rests on: a type is not a label, it is a
  // set of fields and repeatable groups. If a name were added to the list
  // without a schema, the form would silently render no details section for it.
  for (const t of CANONICAL_TYPES) {
    assert.ok(isCanonical(t), `${t} has no TYPE_FIELDS entry`);
  }
  assert.equal(isCanonical('Curfew Violation'), false);
});
