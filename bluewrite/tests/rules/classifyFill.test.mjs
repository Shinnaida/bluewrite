// Phase 7 — the account read's merge rules (src/lib/classifyFill.js).
//
// These are the tests for the ONE thing the silent fill must never get wrong:
// it fills blanks and touches nothing else. Every case below is a way that
// could break while the feature still looked like it was working.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClassifyFill,
  buildTypeDetailsFill,
  classifyFillIsEmpty,
} from '../../src/lib/classifyFill.js';
import { INCIDENT_TYPES } from '../../src/lib/incidentTypes.js';

// A full answer, as POST /ai/classify returns it (the `fields` half).
const answer = (over = {}) => ({
  incident_type: 'Theft',
  incident_datetime: '2026-09-19T23:30',
  incident_time_approximate: false,
  location: 'Sta. Cruz Street, Naga City',
  reporter_name: 'Salvacion, Maria Teresa L.',
  reporter_contact: '(0917) 555-0142',
  reporter_address: '12 Rizal St., Brgy. San Francisco, Naga City',
  action_taken: 'For follow-up investigation.',
  parties: [{ role: 'victim', name: 'Salvacion, Maria Teresa L.' }],
  unstated: ['no suspect name given'],
  ...over,
});

const draft = (over = {}) => ({
  incident_type: '',
  incident_datetime: '',
  location: '',
  reporter_name: '',
  reporter_contact: '',
  reporter_address: '',
  action_taken: '',
  type_specific: {},
  ...over,
});

test('an empty draft takes every field the read states', () => {
  const fill = buildClassifyFill(answer(), draft(), INCIDENT_TYPES);
  assert.equal(fill.patch.incident_type, 'Theft');
  assert.equal(fill.patch.incident_datetime, '2026-09-19T23:30');
  assert.equal(fill.patch.location, 'Sta. Cruz Street, Naga City');
  assert.equal(fill.patch.reporter_name, 'Salvacion, Maria Teresa L.');
  assert.equal(fill.patch.reporter_contact, '(0917) 555-0142');
  assert.equal(fill.patch.reporter_address, '12 Rizal St., Brgy. San Francisco, Naga City');
  assert.equal(fill.patch.action_taken, 'For follow-up investigation.');
  assert.deepEqual(fill.groups, { complainant: [{ name: 'Salvacion, Maria Teresa L.' }] });
  assert.equal(fill.type, 'Theft');
  assert.deepEqual(fill.unstated, ['no suspect name given']);
});

test('a field the officer already filled is never touched, even when the read disagrees', () => {
  const fill = buildClassifyFill(
    answer({ location: 'Somewhere the model decided', incident_type: 'Robbery' }),
    draft({ location: 'The officer’s own place', incident_type: 'Lost Property' }),
    INCIDENT_TYPES,
  );
  assert.equal('location' in fill.patch, false, 'the officer’s own answer stands');
  assert.equal('incident_type' in fill.patch, false, 'a chosen type is not re-read');
  assert.equal(fill.type, 'Lost Property', 'the draft’s own type is what the groups are read against');
  assert.equal(fill.filled.includes('Place of incident'), false);
});

test('a type outside the form’s own list is dropped, not repaired', () => {
  // The API allows the legacy Phase 1/2 spellings, which the dropdown no longer
  // offers: writing one into the form would set a value no option matches.
  const fill = buildClassifyFill(answer({ incident_type: 'Physical Injury' }), draft(), [
    'Theft',
    'Lost Property',
  ]);
  assert.equal('incident_type' in fill.patch, false);
  assert.equal(fill.type, '');
  assert.equal(fill.groups.complainant, undefined, 'with no type there is no group to add a row to');
});

test('only a real datetime is taken', () => {
  for (const bad of ['2026-09-19', '23:30', 'september 19 2026', '', '2026-09-19 23:30']) {
    const fill = buildClassifyFill(answer({ incident_datetime: bad }), draft(), INCIDENT_TYPES);
    assert.equal('incident_datetime' in fill.patch, false, `${bad || '(empty)'} is not a datetime`);
  }
  const good = buildClassifyFill(answer(), draft(), INCIDENT_TYPES);
  assert.equal(good.patch.incident_datetime, '2026-09-19T23:30');
});

test('a half-filled date is left alone rather than completed', () => {
  // The date and the time share one stored field, so a date typed with no time
  // is a FILLED field: completing it would write a time the officer left out.
  const fill = buildClassifyFill(answer(), draft({ incident_datetime: '2026-09-19' }), INCIDENT_TYPES);
  assert.equal('incident_datetime' in fill.patch, false);
});

test('the approximate flag is only ever set true', () => {
  const hedged = buildClassifyFill(answer({ incident_time_approximate: true }), draft(), INCIDENT_TYPES);
  assert.equal(hedged.patch.incident_time_approximate, true);
  const plain = buildClassifyFill(answer({ incident_time_approximate: false }), draft(), INCIDENT_TYPES);
  assert.equal('incident_time_approximate' in plain.patch, false, 'false is what an untouched box says');
});

test('a party lands in the group its role names, and only for a type that has it', () => {
  const theft = buildClassifyFill(
    answer({
      parties: [
        { role: 'victim', name: 'Salvacion, Maria Teresa L.' },
        { role: 'suspect', name: 'Unknown male, 5\'6"' },
        { role: 'witness', name: 'Reyes, PO1 Danilo' },
      ],
    }),
    draft(),
    INCIDENT_TYPES,
  );
  assert.deepEqual(theft.groups, {
    complainant: [{ name: 'Salvacion, Maria Teresa L.' }],
    respondent: [{ name: 'Unknown male, 5\'6"' }],
    witness: [{ name: 'Reyes, PO1 Danilo' }],
  });
  assert.deepEqual(theft.filled.slice(-3), ['Victims', 'Suspects', 'Witnesses']);

  // A type with no Witnesses group gets no witness row — the role is real, the
  // place to put it is not.
  const rape = buildClassifyFill(
    answer({
      incident_type: 'Rape / Sexual Assault',
      parties: [{ role: 'witness', name: 'Reyes, PO1 Danilo' }],
    }),
    draft(),
    INCIDENT_TYPES,
  );
  assert.deepEqual(rape.groups, {});
  assert.equal(rape.filled.includes('Witnesses'), false);
});

test('an unnamed role is not a person, and an unknown role has no group', () => {
  const fill = buildClassifyFill(
    answer({ parties: [{ role: 'other', name: 'Somebody' }, { role: 'suspect', name: '   ' }] }),
    draft(),
    INCIDENT_TYPES,
  );
  assert.deepEqual(fill.groups, {});
});

test('a group the officer already used keeps the officer’s rows', () => {
  const fill = buildClassifyFill(
    answer({ parties: [{ role: 'victim', name: 'Salvacion, Maria Teresa L.' }] }),
    draft({ incident_type: 'Theft', type_specific: { complainant: [{ name: 'Bautista, Ana' }] } }),
    INCIDENT_TYPES,
  );
  assert.deepEqual(fill.groups, {});
});

test('the same name twice is one row', () => {
  const fill = buildClassifyFill(
    answer({
      parties: [
        { role: 'victim', name: 'Salvacion, Maria Teresa L.' },
        { role: 'complainant', name: 'salvacion, maria teresa l.' },
      ],
    }),
    draft(),
    INCIDENT_TYPES,
  );
  assert.deepEqual(fill.groups.complainant, [{ name: 'Salvacion, Maria Teresa L.' }]);
});

test('a blank answer changes nothing, and says so', () => {
  const fill = buildClassifyFill(
    { incident_type: '', incident_datetime: '', location: '', reporter_name: '', unstated: ['  ', 'no time given'] },
    draft(),
    INCIDENT_TYPES,
  );
  assert.deepEqual(fill.patch, {});
  assert.deepEqual(fill.groups, {});
  assert.deepEqual(fill.filled, []);
  assert.deepEqual(fill.unstated, ['no time given'], 'blank lines are dropped');
  assert.equal(classifyFillIsEmpty(fill), true);
});

// ---------------------------------------------------------------------------
// The second read: the incident type's OWN fields (POST /ai/classify/details)
// ---------------------------------------------------------------------------

test('type details fill the blanks of the type the draft carries', () => {
  const fill = buildTypeDetailsFill(
    {
      fields: { accident_type: 'vehicular collision', weather_condition: 'rainy' },
      groups: {},
      unstated: ['no insurance details given'],
    },
    { incident_type: 'Traffic Accident', type_specific: {} },
  );
  assert.deepEqual(fill.patch, { accident_type: 'vehicular collision', weather_condition: 'rainy' });
  assert.deepEqual(fill.filled, ['Accident Type', 'Weather Condition']);
  assert.deepEqual(fill.unstated, ['no insurance details given']);
});

test('without an incident type there is nothing to read the details against', () => {
  const fill = buildTypeDetailsFill(
    { fields: { accident_type: 'vehicular collision' }, groups: { vehicles: [{ plate_number: 'ABC 1234' }] } },
    { incident_type: '', type_specific: {} },
  );
  assert.deepEqual(fill.patch, {});
  assert.deepEqual(fill.groups, {});
  assert.deepEqual(fill.filled, []);
});

test('a scalar the officer already filled is kept, and a mirrored one is never written', () => {
  const fill = buildTypeDetailsFill(
    { fields: { accident_type: 'the model’s answer', suspected_cause: 'overspeeding', vehicle_1_plate_number: 'ZZZ 999' } },
    { incident_type: 'Traffic Accident', type_specific: { accident_type: 'the officer’s answer' } },
  );
  assert.deepEqual(fill.patch, { suspected_cause: 'overspeeding' });
  assert.equal('vehicle_1_plate_number' in fill.patch, false, 'a mirror belongs to its group row');
});

test('a select only takes one of its own options, in the option’s own spelling', () => {
  const fill = buildTypeDetailsFill(
    { fields: { cctv_available: 'yes' } },
    { incident_type: 'Theft', type_specific: {} },
  );
  assert.equal(fill.patch.cctv_available, 'Yes');
  const junk = buildTypeDetailsFill(
    { fields: { cctv_available: 'probably' } },
    { incident_type: 'Theft', type_specific: {} },
  );
  assert.equal('cctv_available' in junk.patch, false);
});

test('a conditional field only lands when its controller says so — including a controller from the same answer', () => {
  const together = buildTypeDetailsFill(
    { fields: { cctv_available: 'Yes', cctv_description: 'camera above the door' } },
    { incident_type: 'Theft', type_specific: {} },
  );
  assert.equal(together.patch.cctv_description, 'camera above the door');

  const contradicted = buildTypeDetailsFill(
    { fields: { cctv_available: 'No', cctv_description: 'camera above the door' } },
    { incident_type: 'Theft', type_specific: {} },
  );
  assert.equal('cctv_description' in contradicted.patch, false, 'a description with no camera is dropped');
});

test('an empty group takes the rows the read found', () => {
  const fill = buildTypeDetailsFill(
    {
      groups: {
        vehicles: [{ plate_number: 'ABC 1234', make_model: 'red motorcycle', damage_description: 'front dented' }],
        injured_persons: [{ name: 'Alvarez, Nicanor R. Jr.', injury_status: 'Minor Injury' }],
      },
    },
    { incident_type: 'Traffic Accident', type_specific: {} },
  );
  assert.deepEqual(fill.groups.vehicles, [
    { plate_number: 'ABC 1234', make_model: 'red motorcycle', damage_description: 'front dented' },
  ]);
  assert.deepEqual(fill.groups.injured_persons, [
    { name: 'Alvarez, Nicanor R. Jr.', injury_status: 'Minor Injury' },
  ]);
  assert.deepEqual(fill.filled, ['Vehicles Involved', 'Injured / Deceased Persons']);
});

test('a witness row the type read found without a name lands on its statement alone', () => {
  // The account says a witness exists and what they said, and never a name for
  // them. The row is worth recording on that alone — the rule engine agrees
  // (GROUP_ROW_RULES.witness is name OR statement_summary), so the read must
  // not withhold it for want of an identifier.
  const fill = buildTypeDetailsFill(
    {
      groups: {
        witness: [
          { statement_summary: 'A vendor said the suspect is known in the area but would not give a name.' },
          { name: '' },
        ],
      },
    },
    { incident_type: 'Theft', type_specific: {} },
  );
  assert.deepEqual(fill.groups.witness, [
    { statement_summary: 'A vendor said the suspect is known in the area but would not give a name.' },
  ]);
  assert.deepEqual(fill.filled, ['Witnesses']);
});

test('a row is matched by what identifies it, and only its EMPTY fields are filled', () => {
  const fill = buildTypeDetailsFill(
    {
      groups: {
        vehicles: [
          { plate_number: 'abc 1234', make_model: 'red motorcycle', damage_description: 'front dented' },
          { plate_number: 'XYZ 777', make_model: 'blue sedan' },
        ],
      },
    },
    {
      incident_type: 'Traffic Accident',
      type_specific: { vehicles: [{ plate_number: 'ABC 1234', make_model: 'the officer’s own model' }] },
    },
  );
  assert.deepEqual(fill.groups.vehicles, [
    // The officer's model stands; the empty damage field is filled.
    { plate_number: 'ABC 1234', make_model: 'the officer’s own model', damage_description: 'front dented' },
    // A plate that matched nothing is a second vehicle, added as its own row.
    { plate_number: 'XYZ 777', make_model: 'blue sedan' },
  ]);
});

test('a row is merged into the officer’s only row when that row is missing the field that identifies it', () => {
  // The officer wrote a quantity and never described the item: there is one
  // candidate row and the identifying field is blank, so the read fills it.
  const one = buildTypeDetailsFill(
    { groups: { stolen_items: [{ item_description: 'sling bag with cellphone' }] } },
    { incident_type: 'Theft', type_specific: { stolen_items: [{ quantity: '1' }] } },
  );
  assert.deepEqual(one.groups.stolen_items, [{ quantity: '1', item_description: 'sling bag with cellphone' }]);

  const ambiguous = buildTypeDetailsFill(
    { groups: { vehicles: [{ make_model: 'some motorcycle' }] } },
    {
      incident_type: 'Traffic Accident',
      type_specific: { vehicles: [{ plate_number: 'AAA 111' }, { plate_number: 'BBB 222' }] },
    },
  );
  assert.deepEqual(ambiguous.groups, {}, 'two vehicles and no plate: the officer keeps that one');
});

test('a type detail read only ever touches this type’s own fields and groups', () => {
  const fill = buildTypeDetailsFill(
    {
      // entry_point belongs to Burglary, stolen_items to Theft: neither is a
      // field or group Traffic Accident has.
      fields: { entry_point: 'rear window', accident_type: 'vehicular collision' },
      groups: { stolen_items: [{ item_description: 'a radio' }] },
    },
    { incident_type: 'Traffic Accident', type_specific: {} },
  );
  assert.deepEqual(fill.patch, { accident_type: 'vehicular collision' });
  assert.deepEqual(fill.groups, {});
});

test('a read that changes nothing reports nothing', () => {
  const fill = buildTypeDetailsFill(
    { fields: { accident_type: 'vehicular collision' }, groups: { vehicles: [{ plate_number: 'ABC 1234' }] } },
    {
      incident_type: 'Traffic Accident',
      type_specific: {
        accident_type: 'vehicular collision',
        vehicles: [{ plate_number: 'ABC 1234' }],
      },
    },
  );
  assert.deepEqual(fill.patch, {});
  assert.deepEqual(fill.groups, {});
  assert.equal(classifyFillIsEmpty(fill), true);
});

test('the labels are in the order the form asks for them', () => {
  const fill = buildClassifyFill(answer(), draft(), INCIDENT_TYPES);
  assert.deepEqual(fill.filled, [
    'Type of incident',
    'Date & time of incident',
    'Place of incident',
    'Reporting party name',
    'Contact number',
    'Home address',
    'Action taken / status',
    'Victims',
  ]);
  assert.equal(classifyFillIsEmpty(fill), false);
});
