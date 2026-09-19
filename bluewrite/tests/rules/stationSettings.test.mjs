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
  buildTypeRows,
  CANONICAL_TYPES,
  changedHeaderFields,
  headerError,
  HEADER_FIELDS,
  isCanonical,
  MAX_TYPE_COUNT,
  MAX_TYPE_NAME,
  normaliseTypes,
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

test('every canonical type has a schema, and only canonical names do', () => {
  // This is the invariant the screen rests on: a type is not a label, it is a
  // set of fields and repeatable groups. If a name were added to the list
  // without a schema, the form would silently render no details section for it.
  for (const t of CANONICAL_TYPES) {
    assert.ok(isCanonical(t), `${t} has no TYPE_FIELDS entry`);
  }
  assert.equal(isCanonical('Curfew Violation'), false);
});
