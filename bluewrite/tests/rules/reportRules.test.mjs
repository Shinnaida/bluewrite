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
} from '../../src/lib/reportRules.js';
import { normalizeLegacyTypeSpecific, hasLegacyShape } from '../../src/lib/normalizeLegacy.js';
import { GROUP_CONFIG } from '../../src/lib/incidentTypes.js';

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

  // The normalized draft passes finalize validation.
  const draft = validBase('Traffic Accident', { type_specific: ts });
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
  const attempted = validBase('Theft', { type_specific: { complainant: [{ name: 'Ana Cruz' }] } });
  assert.equal(validateReport(attempted, 'finalize').errors.length, 0, 'nothing taken is valid');

  const withItems = validBase('Theft', {
    type_specific: {
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
