// BlueWrite v3 — rule engine + legacy normalization tests (groups addendum
// deliverable 7). Runs with Node's built-in runner: node --test tests/rules/
// Covers: schema validation per item, count floors, cross-field checks,
// count-sync helpers, legacy normalization (old shape / v3 no-op / mixed),
// and the three required scenarios (multi-vehicle, group robbery, legacy
// read-only load).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReport,
  validateReporterParty,
  resizeGroup,
  allItemsBlank,
  stolenItemsTotal,
  deriveMirrors,
  syncMirrors,
} from '../../src/lib/reportRules.js';
import { normalizeLegacyTypeSpecific, hasLegacyShape } from '../../src/lib/normalizeLegacy.js';
import {
  GROUP_CONFIG,
  GROUP_ROW_RULES,
  INCIDENT_TYPES,
  TYPE_FIELDS,
} from '../../src/lib/incidentTypes.js';

// ---- helpers ---------------------------------------------------------------

function validBase(type, overrides = {}) {
  return {
    incident_type: type,
    incident_datetime: '2026-09-01T10:30',
    location: 'Barangay Dagatan, Calamba City',
    narrative:
      'Responding team proceeded to the scene after a phone call from a concerned citizen. ' +
      'Upon arrival, officers interviewed the parties involved and secured the area. ' +
      'All persons present were accounted for and medical personnel assessed the injured on site.',
    // Required at finalize (migration 004): a finalizable report must record
    // how the incident was handled and who carries the case.
    action_taken:
      'Subject turned over to the station for proper disposition. Follow-up investigation ongoing.',
    ioc_name: 'Sgt. Test Investigator',
    type_specific: {},
    ...overrides,
  };
}

// ---- 1. Gate levels ---------------------------------------------------------

test('draft gate is lenient: missing narrative and empty groups still pass', () => {
  const draft = {
    incident_type: 'Theft',
    incident_datetime: '2026-09-01T10:30',
    location: 'Some place',
    narrative: '',
    type_specific: {},
  };
  const { errors } = validateReport(draft, 'draft');
  assert.equal(errors.length, 0);
});

test('finalize gate blocks: no victims recorded, short narrative', () => {
  const draft = validBase('Theft', { narrative: 'too short' });
  const { errors } = validateReport(draft, 'finalize');
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes('complainant'), 'missing victims group flagged');
  assert.ok(paths.includes('narrative'), 'short narrative flagged');
});

test('finalize gate blocks: no action taken / status recorded', () => {
  for (const level of ['draft', 'finalize']) {
    const { errors } = validateReport(
      validBase('Theft', { action_taken: '' }),
      level,
    );
    const flagged = errors.some((e) => e.path === 'action_taken');
    if (level === 'finalize') {
      assert.ok(flagged, 'finalize must be blocked without the action taken');
    } else {
      assert.equal(flagged, false, 'a draft may omit the action taken');
    }
  }
});

test('finalize gate blocks: no investigator-on-case recorded', () => {
  for (const level of ['draft', 'finalize']) {
    const { errors } = validateReport(validBase('Theft', { ioc_name: '' }), level);
    const flagged = errors.some((e) => e.path === 'ioc_name');
    if (level === 'finalize') {
      assert.ok(flagged, 'finalize must be blocked without the IOC');
    } else {
      assert.equal(flagged, false, 'a draft may omit the IOC');
    }
  }
});

test('incident datetime in the future is rejected at finalize', () => {
  const draft = validBase('Lost Property', {
    incident_datetime: '2099-01-01T00:00',
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.ok(errors.some((e) => e.path === 'incident_datetime'));
});

// ---- 2. Per-item group validation --------------------------------------------

test('blank items are ignored; minCount counts only meaningful entries', () => {
  const draft = validBase('Theft', {
    type_specific: {
      complainant: [{}, { name: 'Maria Santos' }],
      respondent: [{}, {}],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.ok(!errors.some((e) => e.path.startsWith('complainant')), 'one filled victim satisfies minCount 1');
  assert.ok(!errors.some((e) => e.path.startsWith('respondent')), 'suspects optional for theft');
});

test('per-item error paths address the exact item field', () => {
  const draft = validBase('Traffic Accident', {
    type_specific: {
      complainant: [{ name: 'Driver One' }],
      vehicles: [
        { plate_number: 'ABC1234', driver_name: 'Driver One' },
        { make_model: 'Honda Beat' }, // no plate, no driver
      ],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes('vehicles[1].plate_number'));
  assert.ok(paths.includes('vehicles[1].driver_name'));
});

test('invalid plate number format is rejected per item', () => {
  const draft = validBase('Traffic Accident', {
    type_specific: {
      complainant: [{ name: 'X' }],
      vehicles: [{ plate_number: 'NOT A PLATE!!', driver_name: 'D' }],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.ok(errors.some((e) => e.path === 'vehicles[0].plate_number'));
});

test('NO PLATE is accepted', () => {
  const draft = validBase('Traffic Accident', {
    type_specific: {
      complainant: [{ name: 'X' }],
      vehicles: [{ plate_number: 'NO PLATE', driver_name: 'Unknown' }],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.ok(!errors.some((e) => e.path.includes('plate_number')));
});

test('age out of range rejected per item', () => {
  const draft = validBase('Theft', {
    type_specific: {
      complainant: [{ name: 'Maria', age: '250' }],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.ok(errors.some((e) => e.path === 'complainant[0].age'));
});

// ---- 3. Cross-field checks ---------------------------------------------------

test('casualty without medical mention in narrative is a warning, not an error', () => {
  const draft = validBase('Traffic Accident', {
    narrative:
      'The collision occurred at the intersection. Units responded and documented the scene. ' +
      'Photographs were taken and the roadway was cleared. Statements were collected from both drivers.',
    type_specific: {
      complainant: [{ name: 'A' }],
      vehicles: [{ plate_number: 'ABC1234', driver_name: 'A' }],
      injured_persons: [{ name: 'B', injury_status: 'Minor Injury' }],
    },
  });
  const { errors, warnings } = validateReport(draft, 'finalize');
  assert.equal(errors.filter((e) => e.level === 'error').length, errors.length);
  assert.ok(warnings.some((w) => w.path === 'narrative' && /medical/i.test(w.message)));
});

test('casualty WITH medical mention produces no warning', () => {
  const draft = validBase('Traffic Accident', {
    type_specific: {
      complainant: [{ name: 'A' }],
      vehicles: [{ plate_number: 'ABC1234', driver_name: 'A' }],
      injured_persons: [{ name: 'B', injury_status: 'Serious Injury' }],
    },
  });
  const { warnings } = validateReport(draft, 'finalize');
  assert.ok(!warnings.some((w) => /medical/i.test(w.message)));
});

// ---- 4. Soft warning threshold -------------------------------------------------

test('group above softWarnAt yields a warning but no error', () => {
  const suspects = Array.from({ length: 9 }, (_, i) => ({ name: `Suspect ${i + 1}` }));
  const draft = validBase('Theft', {
    type_specific: { complainant: [{ name: 'V' }], respondent: suspects },
  });
  const { errors, warnings } = validateReport(draft, 'finalize');
  assert.ok(!errors.some((e) => e.path === 'respondent'));
  assert.ok(warnings.some((w) => w.path === 'respondent' && /9 recorded/.test(w.message)));
});

// ---- 5. Count-sync helpers -------------------------------------------------------

test('resizeGroup grows with blank items and shrinks from the end', () => {
  const blank = () => ({});
  let arr = resizeGroup([], 3, blank);
  assert.equal(arr.length, 3);
  arr[0].name = 'kept';
  arr = resizeGroup(arr, 1, blank);
  assert.deepEqual(arr, [{ name: 'kept' }]);
});

test('allItemsBlank detects fully-blank arrays only', () => {
  assert.equal(allItemsBlank([{}, { name: '' }]), true);
  assert.equal(allItemsBlank([{}, { name: 'x' }]), false);
  assert.equal(allItemsBlank(null), true);
});

// ---- 6. Legacy normalization --------------------------------------------------------

test('legacy vehicle_1_*/vehicle_2_* flat keys reshape into vehicles[]', () => {
  const legacy = {
    vehicle_1_plate_number: 'XYZ9999',
    vehicle_1_driver_name: 'Maria Santos',
    vehicle_2_plate_number: 'ABC1234',
    vehicle_2_driver_name: 'Juan Dela Cruz',
  };
  const out = normalizeLegacyTypeSpecific(legacy, 'Traffic Accident');
  assert.equal(out.vehicles.length, 2);
  assert.deepEqual(out.vehicles[0], {
    plate_number: 'XYZ9999',
    driver_name: 'Maria Santos',
  });
  assert.deepEqual(out.vehicles[1], {
    plate_number: 'ABC1234',
    driver_name: 'Juan Dela Cruz',
  });
  // Original flat keys remain untouched in the in-memory copy.
  assert.equal(out.vehicle_1_plate_number, 'XYZ9999');
});

test('v3-shaped input is a no-op', () => {
  const v3 = {
    complainant: [{ name: 'Maria' }],
    vehicles: [{ plate_number: 'ABC1234', driver_name: 'Maria' }],
  };
  const out = normalizeLegacyTypeSpecific(v3, 'Traffic Accident');
  assert.deepEqual(out, v3);
});

test('singular complainant column fills empty complainant group via report row', () => {
  const out = normalizeLegacyTypeSpecific({}, 'Theft', {
    complainant: 'Maria Santos',
    respondent: '',
  });
  assert.deepEqual(out.complainant, [{ name: 'Maria Santos' }]);
  assert.equal(out.respondent, undefined);
});

test('normalization never overwrites existing v3 group data', () => {
  const out = normalizeLegacyTypeSpecific(
    { complainant: [{ name: 'New Data' }] },
    'Theft',
    { complainant: 'Old Legacy Name' },
  );
  assert.deepEqual(out.complainant, [{ name: 'New Data' }]);
});

test('mixed legacy + partial new shape normalizes safely', () => {
  const mixed = {
    vehicle_1_plate_number: 'OLD0001',
    vehicle_1_driver_name: 'Old Driver',
    vehicles: [{ plate_number: 'NEW0001', driver_name: 'New Driver' }],
  };
  const out = normalizeLegacyTypeSpecific(mixed, 'Traffic Accident');
  // Existing vehicles[] wins; legacy keys left as-is (read-time only).
  assert.equal(out.vehicles.length, 1);
  assert.equal(out.vehicles[0].plate_number, 'NEW0001');
});

test('hasLegacyShape detects both old and new', () => {
  assert.equal(hasLegacyShape({ vehicle_1_driver: 'x' }), true);
  assert.equal(hasLegacyShape({ complainant: 'text' }), true);
  assert.equal(hasLegacyShape({ complainant: [{ name: 'x' }] }), false);
  assert.equal(hasLegacyShape({}), false);
});

// ---- 7. Required scenarios -----------------------------------------------------

test('SCENARIO: multi-vehicle accident (3 vehicles, 2 drivers, 1 pedestrian)', () => {
  const draft = validBase('Traffic Accident', {
    type_specific: {
      // The type's own required fields (TYPE_FIELDS): a traffic report has to
      // say what kind of collision it was and what is suspected to have caused
      // it. The groups below are what this scenario is actually about.
      accident_type: 'Multiple-vehicle collision',
      suspected_cause: 'Overspeeding on a wet road',
      complainant: [
        { name: 'Driver One', injury_status: 'Uninjured' },
        { name: 'Driver Two', injury_status: 'Minor Injury' },
      ],
      vehicles: [
        { plate_number: 'ABC1234', driver_name: 'Driver One', make_model: 'Toyota Vios' },
        { plate_number: 'DEF5678', driver_name: 'Driver Two', make_model: 'Honda City' },
        { plate_number: 'NO PLATE', driver_name: 'Unknown', make_model: 'Motorcycle' },
      ],
      injured_persons: [{ name: 'Pedestrian', injury_status: 'Serious Injury' }],
    },
  });
  const { errors, warnings } = validateReport(draft, 'finalize');
  assert.equal(errors.length, 0, `expected clean finalize, got: ${JSON.stringify(errors)}`);
  // Pedestrian injured + narrative mentions medical personnel → no warning.
  assert.ok(!warnings.some((w) => /medical/i.test(w.message)));
});

test('SCENARIO: group robbery (4 suspects, 1 complainant, 2 witnesses)', () => {
  const draft = validBase('Robbery', {
    type_specific: {
      // Robbery's required fields. Weapon Involved is answered "No", which is
      // also what keeps the conditional Weapon Description out of the picture.
      property_taken: 'Cash and a mobile phone from the counter',
      method_used: 'Threat of a bladed weapon; the cash was handed over',
      weapon_involved: 'No',
      complainant: [{ name: 'Store Owner', injury_status: 'Minor Injury' }],
      respondent: [
        { name: 'Suspect One' },
        { name: 'Suspect Two' },
        { name: 'Suspect Three' },
        { name: 'Suspect Four' },
      ],
      witness: [
        { name: 'Bystander One', statement_summary: 'Saw the getaway direction' },
        { name: 'Bystander Two', statement_summary: 'Heard the commotion' },
      ],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.equal(errors.length, 0, `expected clean finalize, got: ${JSON.stringify(errors)}`);
});

test('SCENARIO: legacy 2-vehicle accident loads read-only through the adapter', () => {
  // Simulates what ReportEditor does at load: raw stored JSON + report row.
  const rawTs = {
    vehicle_1_type: 'Sedan',
    vehicle_1_plate_number: 'XYZ9999',
    vehicle_1_driver_name: 'Maria Santos',
    vehicle_1_damage: 'Front bumper crushed',
    vehicle_2_type: 'Motorcycle',
    vehicle_2_plate_number: 'ABC1234',
    vehicle_2_driver_name: 'Juan Dela Cruz',
    vehicle_2_damage: 'Scratches on the right side',
  };
  const reportRow = { complainant: 'Maria Santos', respondent: 'Juan Dela Cruz' };

  // Legacy shape goes through the adapter and lands in the editor.
  assert.equal(hasLegacyShape(rawTs), true);
  const ts = normalizeLegacyTypeSpecific(rawTs, 'Traffic Accident', reportRow);
  assert.equal(ts.vehicles.length, 2);
  assert.deepEqual(ts.complainant, [{ name: 'Maria Santos' }]);
  assert.deepEqual(ts.respondent, [{ name: 'Juan Dela Cruz' }]);

  // The normalized draft passes finalize validation once the per-type fields
  // the legacy row predates are filled. That is the honest shape of this: the
  // adapter restores the GROUPS, and the type's own requirements apply on top,
  // so an old DRAFT has to be completed like any other before it can be
  // finalized. (A report already finalized is never re-validated.)
  const draft = validBase('Traffic Accident', {
    type_specific: {
      ...ts,
      accident_type: 'Rear-end collision',
      suspected_cause: 'Following too closely',
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.equal(errors.length, 0, `expected clean finalize, got: ${JSON.stringify(errors)}`);
});

// ---- 8. GROUP_CONFIG sanity across all 14 types -----------------------------

test('every incident type has a GROUP_CONFIG entry with valid schemas', async () => {
  const { INCIDENT_TYPES } = await import('../../src/lib/incidentTypes.js');
  for (const type of INCIDENT_TYPES) {
    const cfg = GROUP_CONFIG[type];
    assert.ok(cfg, `${type} missing GROUP_CONFIG`);
    for (const [role, g] of Object.entries(cfg)) {
      assert.ok(Array.isArray(g.itemSchema) && g.itemSchema.length > 0, `${type}.${role} empty itemSchema`);
      assert.ok(typeof g.label === 'string' && g.label, `${type}.${role} missing label`);
      assert.ok(g.minCount >= 0, `${type}.${role} bad minCount`);
    }
  }
});

// ---- 9. Part 1: victim / suspect / stolen-item schemas (§1.3–§1.5) ----------

const keysOf = (type, role) => GROUP_CONFIG[type][role].itemSchema.map((f) => f.key);

// Theft's own required fields, reused by the fixtures in this section so each
// test stays about the thing it names (item rows, victim shapes) rather than
// about the type's requirement list.
const theftFields = {
  item_stolen: 'None taken — the attempt was interrupted',
  owner_of_property: 'Ana Cruz',
  how_property_was_taken: 'Reached over the counter while the till was closed',
};

test('victim groups carry victim type + representative; suspect groups carry status + description', () => {
  assert.ok(keysOf('Theft', 'complainant').includes('victim_type'));
  assert.ok(keysOf('Theft', 'complainant').includes('representative_name'));
  assert.ok(keysOf('Theft', 'complainant').includes('representative_position'));
  assert.ok(keysOf('Theft', 'respondent').includes('suspect_status'));
  assert.ok(keysOf('Theft', 'respondent').includes('suspect_description'));

  // Drivers are parties, not victims — the victim document fields stay off
  // that group. "Reported By" on a missing-person case is the relator, not
  // the victim either.
  assert.ok(!keysOf('Traffic Accident', 'complainant').includes('victim_type'));
  assert.ok(!keysOf('Missing Person', 'complainant').includes('victim_type'));
});

test('a victim with no representative and an identified/organization mix is valid', () => {
  const draft = validBase('Theft', {
    type_specific: {
      ...theftFields,
      complainant: [{ name: 'Ana Cruz', victim_type: 'Individual' }],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test('an unidentified suspect is valid with only a description', () => {
  const draft = validBase('Theft', {
    type_specific: {
      complainant: [{ name: 'Ana Cruz' }],
      respondent: [
        { suspect_status: 'Unidentified', suspect_description: 'Rode a black motorcycle, no plate' },
      ],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.equal(errors.filter((e) => e.path.startsWith('respondent')).length, 0, JSON.stringify(errors));
});

test('stolen items take free-text quantities and may be absent entirely', () => {
  const attempted = validBase('Theft', {
    type_specific: { ...theftFields, complainant: [{ name: 'Ana Cruz' }] },
  });
  assert.equal(validateReport(attempted, 'finalize').errors.length, 0, 'nothing taken is valid');

  const withItems = validBase('Theft', {
    type_specific: {
      ...theftFields,
      complainant: [{ name: 'Ana Cruz' }],
      stolen_items: [
        { item_description: 'Copper wire', quantity: '128m', unit: 'meters', estimated_value: '8,500' },
        { item_description: 'Assorted tools', quantity: 'several, exact count unknown', estimated_value: '' },
      ],
    },
  });
  const { errors } = validateReport(withItems, 'finalize');
  assert.equal(errors.filter((e) => e.path.startsWith('stolen_items')).length, 0, JSON.stringify(errors));
});

test('a malformed estimated value is flagged at finalize, not silently accepted', () => {
  const draft = validBase('Theft', {
    type_specific: {
      complainant: [{ name: 'Ana Cruz' }],
      stolen_items: [{ item_description: 'Wallet', estimated_value: 'value pending' }],
    },
  });
  const { errors } = validateReport(draft, 'finalize');
  assert.ok(
    errors.some((e) => e.path.endsWith('estimated_value')),
    `expected an estimated_value error, got ${JSON.stringify(errors)}`,
  );
});

// ---- 10. Part 1: stolen-item totals (§1.5) ---------------------------------

test('stolenItemsTotal sums what is known and labels a partial total', () => {
  assert.deepEqual(stolenItemsTotal([{ estimated_value: '8,500' }, { estimated_value: '1500' }]), {
    total: 10000,
    partial: false,
    rows: 2,
    valued: 2,
  });

  const partial = stolenItemsTotal([{ estimated_value: '₱8,500' }, { estimated_value: '' }]);
  assert.equal(partial.total, 8500, 'rows without a value are summed around, not treated as zero');
  assert.equal(partial.partial, true, 'the total is partial when any row has no value');
  assert.equal(partial.rows, 2);
  assert.equal(partial.valued, 1);

  assert.deepEqual(stolenItemsTotal([]), { total: 0, partial: false, rows: 0, valued: 0 });
});

// ---- 11. Part 1: reporting party + officer initials (Panels I / IV) --------

test('the reporting party fields are optional and never block a blank report', () => {
  assert.deepEqual(validateReporterParty({}), []);
  assert.deepEqual(validateReporterParty({ reporter_name: 'Juan Dela Cruz' }), []);
  // A report filed in person may have no ID, no email, no address at all.
  assert.deepEqual(
    validateReporterParty({
      reporter_name: 'Nita B. Ramos',
      reporter_id_no: 'N01-23-456789',
      reporter_contact: '(032) 555-1234',
      reporter_email: 'nita.ramos@example.gov.ph',
      reporter_address: 'Poblacion, City of Naga, Cebu',
      officer_initials: 'J.D.C.',
    }),
    [],
  );
});

test('a malformed reporting-party value is named, not silently accepted', () => {
  const problems = validateReporterParty({
    reporter_email: 'nita.ramos@',
    reporter_contact: 'call the station',
    officer_initials: 'JDC 123',
  });
  assert.deepEqual(
    problems.map((p) => p.path).sort(),
    ['officer_initials', 'reporter_contact', 'reporter_email'],
  );
  assert.ok(problems.every((p) => p.level === 'error'));
});

test('the reporting-party shapes are a finalize check, not a draft nag', () => {
  const draft = validBase('Theft', { reporter_email: 'not-an-email' });
  const asDraft = validateReport(draft, 'draft');
  assert.equal(asDraft.errors.filter((e) => e.path === 'reporter_email').length, 0);
  const atFinalize = validateReport(draft, 'finalize');
  assert.equal(atFinalize.errors.filter((e) => e.path === 'reporter_email').length, 1);
});

// ---- 12. Per-type requirements: what each incident KIND must record --------
//
// The requirements live on the field metadata (TYPE_FIELDS in incidentTypes.js)
// and are mirrored in ReportRules::TYPE_RULES in app/rules/report_rules.php.
// This section pins them: the exact list per type, that filling exactly that
// list passes, that blanking any one of them is caught, and that the
// conditional ones follow their controlling field.
//
// A change to REQUIRED_OF is a deliberate change to what the station will
// refuse to submit, so it should be made on purpose, in both engines.

// NOTE: a field the v3 groups auto-fill (mirrorOf) is deliberately NOT on its
// type's list — it is not a field the officer can be held to, because the row
// that carries it is. Owner of Property comes from the Victims row, and the
// Missing Person's description from the Missing Persons row (see section 13).
const REQUIRED_OF = {
  'Theft': ['item_stolen', 'how_property_was_taken'],
  'Robbery': ['property_taken', 'method_used', 'weapon_involved'],
  'Assault / Physical Injury': ['type_of_injury', 'body_part_injured', 'cause_of_injury'],
  'Traffic Accident': ['accident_type', 'suspected_cause'],
  'Rape / Sexual Assault': ['relationship_to_victim', 'medical_examination'],
  'Domestic Violence': ['relationship_between_parties', 'type_of_abuse', 'children_involved'],
  'Missing Person': ['date_last_seen', 'location_last_seen'],
  'Lost Property': ['property_type', 'property_description', 'circumstances_of_loss'],
  'Fraud / Estafa': ['transaction_date', 'amount_involved', 'promised_service_or_item'],
  'Property Damage / Malicious Mischief': ['damaged_property', 'type_of_damage', 'cause_of_damage'],
  'Fire Incident': ['type_of_property', 'possible_cause', 'extent_of_damage'],
  'Drug-Related Incident': ['incident_classification', 'items_seized', 'evidence_turnover'],
  'Burglary / Break-In': ['establishment_or_residence', 'entry_point', 'signs_of_forced_entry'],
  'Other Incident': ['incident_category', 'additional_information'],
};

/** A value that satisfies a field descriptor. */
function sampleValue(fld) {
  // For a select, the LAST option: these are the "none / unknown / declined"
  // answers, which also keep that field's dependents off screen.
  if (fld.select) return fld.select[fld.select.length - 1];
  if (fld.date) return '2026-08-30';
  if (fld.time) return '09:15';
  if (fld.type === 'number') return String(fld.min ?? 20);
  if (fld.type === 'plate') return 'ABC1234';
  if (fld.type === 'phone') return '0917 555 1234';
  if (fld.type === 'name') return 'Ana Cruz';
  return 'Recorded in detail by the responding officer.';
}

/** A row that satisfies a group's row rules and the vehicle cross-check. */
function sampleRow(groupKey, schema) {
  const row = {};
  for (const key of GROUP_ROW_RULES[groupKey]?.require ?? []) {
    row[key] = sampleValue(schema.find((f) => f.key === key) ?? {});
  }
  for (const options of GROUP_ROW_RULES[groupKey]?.requireAny ?? []) {
    row[options[0]] = 'Ana Cruz';
  }
  if (schema.some((f) => f.key === 'plate_number')) row.plate_number = 'ABC1234';
  if (schema.some((f) => f.key === 'driver_name')) row.driver_name = 'Ana Cruz';
  if (schema.some((f) => f.key === 'circumstances')) {
    row.circumstances = 'Last seen leaving the house at seven in the morning.';
  }
  return row;
}

/** The draft a type needs: required fields, conditional ones, count floors. */
function completeDraftFor(type) {
  const ts = {};
  for (const fld of TYPE_FIELDS[type] ?? []) {
    const shown = !fld.showIf || fld.showIf.values.includes(ts[fld.showIf.key] ?? '');
    if (shown && (fld.required || fld.requireWhenShown)) ts[fld.key] = sampleValue(fld);
  }
  for (const [groupKey, cfg] of Object.entries(GROUP_CONFIG[type] ?? {})) {
    if (cfg.minCount < 1) continue;
    ts[groupKey] = [sampleRow(groupKey, cfg.itemSchema)];
  }
  return validBase(type, { type_specific: ts });
}

const typeErrorsOf = (draft) =>
  validateReport(draft, 'finalize')
    .errors.filter((e) => e.path.startsWith('type_specific.'))
    .map((e) => e.path.slice('type_specific.'.length));

test('the required per-type fields are exactly the agreed set', () => {
  for (const type of INCIDENT_TYPES) {
    const declared = (TYPE_FIELDS[type] ?? []).filter((f) => f.required === true).map((f) => f.key);
    assert.deepEqual(declared, REQUIRED_OF[type], `${type} requirement list changed`);
  }
});

test('no incident type is satisfied by an empty type_specific', () => {
  // The hole this exists to close: a type whose fields are all optional reads as
  // nothing to fill in the moment the type is chosen.
  for (const type of INCIDENT_TYPES) {
    const errors = typeErrorsOf(validBase(type, { type_specific: {} }));
    assert.deepEqual(errors, REQUIRED_OF[type], `${type} flagged an unexpected set`);
  }
});

test('filling exactly the required fields clears them, for every type', () => {
  for (const type of INCIDENT_TYPES) {
    const { errors } = validateReport(completeDraftFor(type), 'finalize');
    assert.equal(errors.length, 0, `${type}: ${JSON.stringify(errors)}`);
  }
});

test('blanking any one required field is caught, once, on its own path', () => {
  for (const type of INCIDENT_TYPES) {
    for (const key of REQUIRED_OF[type]) {
      const draft = completeDraftFor(type);
      draft.type_specific = { ...draft.type_specific, [key]: '' };
      const hits = validateReport(draft, 'finalize').errors.filter(
        (e) => e.path === `type_specific.${key}`,
      );
      assert.equal(
        hits.length,
        1,
        `${type}.${key}: expected exactly one error for it, got ${JSON.stringify(validateReport(draft, 'finalize').errors)}`,
      );
    }
  }
});

test('a conditional requirement follows its controlling field', () => {
  const base = {
    property_taken: 'Cash and a mobile phone',
    method_used: 'Intimidation at knife point',
  };
  const armed = validBase('Robbery', { type_specific: { ...base, weapon_involved: 'Yes' } });
  assert.ok(
    typeErrorsOf(armed).includes('weapon_description'),
    'a weapon means the weapon has to be described',
  );

  const unarmed = validBase('Robbery', { type_specific: { ...base, weapon_involved: 'No' } });
  assert.ok(
    !typeErrorsOf(unarmed).includes('weapon_description'),
    'no weapon, nothing to describe',
  );
});

test('the per-type requirements are a finalize check, not a draft nag', () => {
  const draft = validBase('Drug-Related Incident', { type_specific: {} });
  const asDraft = validateReport(draft, 'draft').errors.filter((e) =>
    e.path.startsWith('type_specific.'),
  );
  assert.deepEqual(asDraft, [], 'a draft may be half-written');
  assert.deepEqual(typeErrorsOf(draft), REQUIRED_OF['Drug-Related Incident']);
});

test('a recorded row has to be a record: a name — or, for a suspect, a description', () => {
  const unnamedVictim = validBase('Theft', {
    type_specific: { ...theftFields, complainant: [{ address: 'Poblacion, City of Naga' }] },
  });
  assert.ok(
    validateReport(unnamedVictim, 'finalize').errors.some((e) => e.path === 'complainant[0].name'),
    'a victim with no name is a placeholder, not a record',
  );

  const unidentifiedSuspect = validBase('Theft', {
    type_specific: {
      ...theftFields,
      complainant: [{ name: 'Ana Cruz' }],
      respondent: [{ suspect_status: 'Unidentified', suspect_description: 'Black motorcycle, no plate' }],
    },
  });
  assert.equal(validateReport(unidentifiedSuspect, 'finalize').errors.length, 0);

  const emptySuspect = validBase('Theft', {
    type_specific: {
      ...theftFields,
      complainant: [{ name: 'Ana Cruz' }],
      respondent: [{ suspect_status: 'Unidentified' }],
    },
  });
  assert.ok(
    validateReport(emptySuspect, 'finalize').errors.some((e) => e.path === 'respondent[0].name'),
    'a suspect row with neither name nor description is caught',
  );
});

test('a stolen-item row has to say what was taken', () => {
  const draft = validBase('Theft', {
    type_specific: { ...theftFields, complainant: [{ name: 'Ana Cruz' }], stolen_items: [{ quantity: '2' }] },
  });
  assert.ok(
    validateReport(draft, 'finalize').errors.some((e) => e.path === 'stolen_items[0].item_description'),
    JSON.stringify(validateReport(draft, 'finalize').errors),
  );
});

// ---- 13. Auto-filled scalars: the group is the record ----------------------
//
// v2 asked the same fact twice: once in a repeatable group, once as a flat
// scalar beside it (Item, Vehicle 1 — Plate Number, Physical Description…).
// The group wins and the scalar is DERIVED from it (mirrorOf in
// incidentTypes.js, mirrored by ReportRules::applyMirrors in PHP). Three
// properties make that swap safe, and each one is pinned here: the value
// travels, an empty group never blanks anything, and a fact the group records
// is never demanded a second time.

/** A Theft report whose items and victim are recorded the v3 way — as rows. */
const theftWithItemRows = (extra = {}) =>
  validBase('Theft', {
    type_specific: {
      how_property_was_taken: 'The padlock was cut at the bicycle rack',
      complainant: [{ name: 'Ana Cruz' }],
      stolen_items: [
        { item_description: 'Copper wire', quantity: '128m', unit: 'meters', estimated_value: '8500' },
        { item_description: 'Assorted tools', quantity: 'several, exact count unknown' },
      ],
      ...extra,
    },
  });

test('a group row fills the flat scalars the sheet still reads', () => {
  const ts = deriveMirrors(theftWithItemRows().type_specific, 'Theft');
  assert.equal(ts.item_stolen, 'Copper wire', 'Item mirrors the first Stolen Items row');
  assert.equal(ts.item_description, 'Copper wire');
  assert.equal(ts.quantity, '128m');
  assert.equal(ts.estimated_value, '8500');
  assert.equal(ts.owner_of_property, 'Ana Cruz', 'Owner of Property mirrors the recorded victim');
});

test('an empty or blank group never blanks a scalar', () => {
  // A report filed before the groups existed keeps exactly what it was filed
  // with — deriving from nothing must not erase a value.
  const legacy = deriveMirrors(
    { item_stolen: 'One shoulder bag', owner_of_property: 'Ana Lopez' },
    'Theft',
  );
  assert.equal(legacy.item_stolen, 'One shoulder bag');
  assert.equal(legacy.owner_of_property, 'Ana Lopez');

  // Nor does a blank row the officer left behind count as a record.
  const blankRow = deriveMirrors(
    { item_stolen: 'One shoulder bag', stolen_items: [{}, {}] },
    'Theft',
  );
  assert.equal(blankRow.item_stolen, 'One shoulder bag');
  assert.equal(deriveMirrors({ item_stolen: '', stolen_items: [{ item_description: 'Wallet' }] }, 'Theft').item_stolen, 'Wallet');
});

test('a fact the group records is never demanded twice', () => {
  // No item row at all: the single Item field is still the record — which is
  // how an ATTEMPTED theft states "None taken" without inventing a row.
  const noRows = validBase('Theft', {
    type_specific: { how_property_was_taken: 'Forced window, nothing taken', complainant: [{ name: 'Ana Cruz' }] },
  });
  assert.ok(
    typeErrorsOf(noRows).includes('item_stolen'),
    'with no Stolen Items row, the Item field carries the requirement',
  );

  // With rows, the rows carry it: nothing on the type block is left to fill.
  const withRows = theftWithItemRows();
  assert.deepEqual(validateReport(withRows, 'finalize').errors, []);

  // And a row that says nothing about the item is still caught on the ROW —
  // per-item paths, which is where the officer can actually fix it.
  const silentRow = theftWithItemRows({ stolen_items: [{ quantity: '2' }] });
  assert.ok(
    validateReport(silentRow, 'finalize').errors.some(
      (e) => e.path === 'stolen_items[0].item_description',
    ),
    JSON.stringify(validateReport(silentRow, 'finalize').errors),
  );
});

test('deleting the last row takes its auto-filled copy with it', () => {
  const withRow = theftWithItemRows().type_specific;
  const rowsIn = deriveMirrors(withRow, 'Theft');
  assert.equal(rowsIn.item_stolen, 'Copper wire');

  // The officer removes the row: the copy goes too, or the report (and the
  // sheet, which falls back to the flat pair once no rows are left) would keep
  // stating an item they just deleted.
  const cleared = syncMirrors(rowsIn, { ...rowsIn, stolen_items: [] }, 'Theft');
  assert.equal(cleared.item_stolen, undefined);
  assert.equal(cleared.quantity, undefined);
  assert.equal(cleared.item_description, undefined);

  // A value the officer typed is not a ghost: the group never held a row, so it
  // never spoke for this field.
  const typed = syncMirrors({ item_stolen: 'None taken' }, { item_stolen: 'None taken' }, 'Theft');
  assert.equal(typed.item_stolen, 'None taken');

  // Nor is a legacy value whose row never knew about it (the old flat vehicle
  // keys do not all line up with the group schema, and losing them would be
  // data loss on the first edit after load).
  const legacy = { vehicle_1_damage: 'Dented rear door', vehicles: [{ plate_number: 'XYZ9999' }] };
  const after = syncMirrors(legacy, { ...legacy, vehicles: [] }, 'Traffic Accident');
  // The scalar that described the deleted row goes with it…
  assert.equal(after.vehicle_1_plate_number, undefined);
  // …while one the row schema never covered is not something the row can
  // retract, so it stays: losing it would be data loss on the first edit.
  assert.equal(after.vehicle_1_damage, 'Dented rear door');
});

test('the derived counts follow the casualty list, not the other way round', () => {
  const ts = deriveMirrors(
    {
      vehicles: [{ plate_number: 'ABC1234' }, { plate_number: 'XYZ9999' }],
      injured_persons: [
        { name: 'Ana Cruz', injury_status: 'Minor Injury' },
        { name: 'Pedro Reyes', injury_status: 'Deceased' },
        { name: 'Lita Ramos', injury_status: 'Uninjured' },
      ],
    },
    'Traffic Accident',
  );
  assert.equal(ts.number_of_vehicles, '2', 'the count comes from the rows');
  assert.equal(ts.fatalities, '1', 'only the recorded Deceased counts');
  assert.equal(ts.vehicle_1_plate_number, 'ABC1234');
  assert.equal(ts.vehicle_2_plate_number, 'XYZ9999', 'the second vehicle mirrors the second row');
});

test('a casualty count is a count of people, never a number typed twice', () => {
  const fire = validBase('Fire Incident', {
    type_specific: {
      type_of_property: 'Two-storey residential house',
      possible_cause: 'Electrical short circuit',
      extent_of_damage: 'Second floor gutted',
      complainant: [{ name: 'Ana Cruz', victim_type: 'Individual' }],
      injured_persons: [
        { name: 'Ana Cruz', injury_status: 'Serious Injury' },
        { name: 'Pedro Reyes', injury_status: 'Deceased' },
        { name: 'Lita Ramos', injury_status: 'Uninjured' },
      ],
    },
  });
  const ts = deriveMirrors(fire.type_specific, 'Fire Incident');
  assert.equal(ts.injuries, '2', 'the Uninjured are not casualties');
  assert.equal(ts.fatalities, '1');
  assert.deepEqual(validateReport(fire, 'finalize').errors, []);
});
