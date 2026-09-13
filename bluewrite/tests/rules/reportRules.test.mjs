// BlueWrite v3 — rule engine + legacy normalization tests (groups addendum
// deliverable 7). Runs with Node's built-in runner: node --test tests/rules/
// Covers: schema validation per item, count floors, cross-field checks,
// count-sync helpers, legacy normalization (old shape / v3 no-op / mixed),
// and the three required scenarios (multi-vehicle, group robbery, legacy
// read-only load).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, resizeGroup, allItemsBlank } from '../../src/lib/reportRules.js';
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
