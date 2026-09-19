import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REVIEW_FIELD_PREFIX,
  REVIEW_SCALAR_PATHS,
  changedReviewPaths,
  fieldIdCandidates,
  groupBlockIdCandidates,
  groupItemPath,
  groupKeyVariants,
  incidentDatePart,
  incidentTimePart,
  isEditableReviewPath,
  reviewFieldId,
  reviewRowForPath,
  reviewRowValueId,
  sameReviewValue,
  setIncidentDate,
  setIncidentTime,
  valueAtPath,
} from '../../src/lib/reviewFields.js';

// ---------------------------------------------------------------------------
// The id scheme. This is the part that cannot be caught by clicking around:
// when the review and the form are both mounted, a wrong id means an error jump
// or a label lands on the HIDDEN copy of the field, and the officer sees a
// button that does nothing.
// ---------------------------------------------------------------------------

test('the review id is the form id behind the prefix', () => {
  assert.deepEqual(fieldIdCandidates('narrative'), ['r-narr']);
  assert.deepEqual(fieldIdCandidates('narrative', REVIEW_FIELD_PREFIX), ['rv-r-narr']);
  assert.deepEqual(fieldIdCandidates('incident_type'), ['r-type']);
  // The review's id keeps the whole form id and puts the prefix in front, so
  // which field a review control shadows is legible in the DOM.
  assert.deepEqual(fieldIdCandidates('incident_type', REVIEW_FIELD_PREFIX), ['rv-r-type']);
});

test('reviewFieldId names the id the review control must carry', () => {
  // The review renders its own controls; this is the id it puts on them, and the
  // one the resolver will find for the review copy.
  assert.equal(reviewFieldId('narrative'), 'rv-r-narr');
  assert.equal(reviewFieldId('incident_type'), 'rv-r-type');
  assert.equal(reviewFieldId('type_specific.cctv_available'), 'rv-ts-cctv_available');
  assert.equal(reviewFieldId('vehicles[0].plate_number'), 'rv-vehicles-0-plate_number');
  // A path with no single control yields no id, rather than a bogus one that a
  // reviewer would have to debug as a missing focus.
  assert.equal(reviewFieldId('vehicles'), '');
  assert.equal(reviewFieldId(''), '');
});

test('every aliased field resolves to the id the form actually uses', () => {
  // The alias table exists because `<key>` → `r-<key>` does not hold for these;
  // a wrong entry here is a link that scrolls nowhere.
  assert.deepEqual(fieldIdCandidates('reporter_name'), ['r-reporter-name']);
  assert.deepEqual(fieldIdCandidates('reporter_id_no'), ['r-reporter-id']);
  assert.deepEqual(fieldIdCandidates('reporter_contact'), ['r-reporter-contact']);
  assert.deepEqual(fieldIdCandidates('reporter_email'), ['r-reporter-email']);
  assert.deepEqual(fieldIdCandidates('reporter_address'), ['r-reporter-address']);
  assert.deepEqual(fieldIdCandidates('officer_initials'), ['r-officer-initials']);
  assert.deepEqual(fieldIdCandidates('action_taken'), ['r-act']);
  assert.deepEqual(fieldIdCandidates('ioc_name'), ['r-ioc']);
});

test('incident_datetime names the date half of the pair', () => {
  // It is TWO controls; the date is the one an error jump focuses, and `r-dt`
  // has never existed.
  assert.deepEqual(fieldIdCandidates('incident_datetime'), ['r-date']);
  assert.notDeepEqual(fieldIdCandidates('incident_datetime'), ['r-dt']);
});

test('location resolves to r-loc, the id the form actually renders', () => {
  // A rule-emitted path (COMMON_RULES: required, minLength 4) whose id does not
  // follow `<key>` → `r-<key>`. Untested, it was the second instance of the
  // `r-dt` bug: the blocked-Submit banner offered a link for the missing place
  // of incident that scrolled nowhere.
  assert.deepEqual(fieldIdCandidates('location'), ['r-loc']);
  assert.notDeepEqual(fieldIdCandidates('location'), ['r-location']);
});

test('incident_ keys strip the prefix, and the approximate checkbox is abbreviated', () => {
  assert.deepEqual(fieldIdCandidates('incident_time'), ['r-time']);
  assert.deepEqual(fieldIdCandidates('incident_type'), ['r-type']);
  // Neither rule reaches `r-time-approx`, so it is named: the review's date/time
  // row carries this checkbox and both copies have to agree on its id.
  assert.deepEqual(fieldIdCandidates('incident_time_approximate'), ['r-time-approx']);
});

test('type-specific paths map to the ts- control, in both copies', () => {
  assert.deepEqual(fieldIdCandidates('type_specific.cctv_available'), ['ts-cctv_available']);
  assert.deepEqual(fieldIdCandidates('type_specific.cctv_available', REVIEW_FIELD_PREFIX), [
    'rv-ts-cctv_available',
  ]);
});

test('a group row maps to RepeatableGroup ids in both spellings, both copies', () => {
  // RepeatableGroup builds its ids from the key it is handed, and the rule
  // engine's key for a group is not always the config's spelling — so both are
  // searched, exactly as the resolver always has.
  assert.deepEqual(fieldIdCandidates('vehicles[0].plate_number'), [
    'vehicles-0-plate_number',
    'vehicle-0-plate_number',
    'vehicless-0-plate_number',
  ]);
  assert.deepEqual(fieldIdCandidates('vehicles[0].plate_number', REVIEW_FIELD_PREFIX), [
    'rv-vehicles-0-plate_number',
    'rv-vehicle-0-plate_number',
    'rv-vehicless-0-plate_number',
  ]);
  // A singular engine key gets its plural: "respondent" → "respondents".
  assert.deepEqual(fieldIdCandidates('respondent[2].name'), [
    'respondent-2-name',
    'respondents-2-name',
  ]);
});

test('the group block id is the one RepeatableGroup wraps itself in', () => {
  assert.deepEqual(groupBlockIdCandidates('vehicles'), ['g-vehicles', 'g-vehicle', 'g-vehicless']);
  assert.deepEqual(groupBlockIdCandidates('vehicles', REVIEW_FIELD_PREFIX), [
    'rv-g-vehicles',
    'rv-g-vehicle',
    'rv-g-vehicless',
  ]);
});

test('group key variants are the key, a trailing-s strip, and the key plus s', () => {
  // Deliberately NOT a pluraliser. The middle spelling only strips a trailing
  // "s" and the third only appends one, so for a singular key neither produces
  // the real plural — and that is fine: today's GROUP_CONFIG keys already match
  // the engine's spelling on the first try, so these variants never fire. They
  // are pinned here so that "tidying" them is a visible, deliberate change to
  // which ids the resolver searches rather than a silent one.
  assert.deepEqual(groupKeyVariants('vehicles'), ['vehicles', 'vehicle', 'vehicless']);
  assert.deepEqual(groupKeyVariants('witness'), ['witness', 'witnes', 'witnesss']);
  assert.deepEqual(groupKeyVariants('witnesses'), ['witnesses', 'witnesse', 'witnessess']);
  assert.equal(groupKeyVariants('witness').includes('witnesses'), false);
  assert.deepEqual(groupKeyVariants(''), ['', 's']);
});

test('a path with no control is named by an empty list, never a guess', () => {
  assert.deepEqual(fieldIdCandidates(''), []);
  assert.deepEqual(fieldIdCandidates(null), []);
  assert.deepEqual(fieldIdCandidates('something.unknown'), []);
  // A bare key is not a group row, so it falls to the `r-<key>` guess like any
  // other column — the resolver matches a group BLOCK by [data-group] long
  // before it ever asks for an id, so this guess never decides a group's fate.
  assert.deepEqual(fieldIdCandidates('vehicles'), ['r-vehicles']);
});

test('groupItemPath parses the engine spelling and rejects everything else', () => {
  assert.deepEqual(groupItemPath('vehicles[12].driver_name'), {
    groupKey: 'vehicles',
    index: 12,
    fieldKey: 'driver_name',
  });
  assert.equal(groupItemPath('vehicles'), null);
  assert.equal(groupItemPath('type_specific.cctv_available'), null);
  assert.equal(groupItemPath('narrative'), null);
  assert.equal(groupItemPath(undefined), null);
});

// ---------------------------------------------------------------------------
// Which paths the review can edit. Getting this wrong in the permissive
// direction means offering an editor for a value that is derived, and the
// officer's typing would silently vanish on the next save.
// ---------------------------------------------------------------------------

test('the editable set is the typed fields, not the derived read-outs', () => {
  for (const path of REVIEW_SCALAR_PATHS) {
    assert.equal(isEditableReviewPath(path), true, `${path} should be editable in the review`);
  }
  // Derived rows: a badge number, the signed name, the submit timestamp.
  for (const path of ['badge_number', 'party_signed_at', 'created_by_name', 'status', 'report_date']) {
    assert.equal(isEditableReviewPath(path), false, `${path} must stay a read-out`);
  }
});

test('editable set covers the type fields and group rows, but not a bare group', () => {
  assert.equal(isEditableReviewPath('type_specific.notable_findings'), true);
  assert.equal(isEditableReviewPath('type_specific.estimated_value'), true);
  assert.equal(isEditableReviewPath('stolen_items[0].item_description'), true);
  // The group as a whole is edited through its block, which is not a field path.
  assert.equal(isEditableReviewPath('vehicles'), false);
  assert.equal(isEditableReviewPath(''), false);
});

// ---------------------------------------------------------------------------
// Which ROW of the review carries a path's control. The date & time row is the
// one that does not name itself: the approximate checkbox lives inside it, so a
// lookup for that key has to open the date & time row or the officer is sent to
// a row that does not exist.
// ---------------------------------------------------------------------------

test('a path opens its own row, except the approximate checkbox', () => {
  assert.equal(reviewRowForPath('location'), 'location');
  assert.equal(reviewRowForPath('incident_datetime'), 'incident_datetime');
  assert.equal(reviewRowForPath('incident_time_approximate'), 'incident_datetime');
  // Every scalar path maps to a row, and the row it maps to is itself a scalar
  // path — otherwise `beginReviewEdit` would refuse a path the review renders.
  for (const path of REVIEW_SCALAR_PATHS) {
    assert.equal(REVIEW_SCALAR_PATHS.includes(reviewRowForPath(path)), true, path);
  }
});

test('the row-value id is prefixed, like every other review id', () => {
  assert.equal(reviewRowValueId('location'), 'rv-row-location');
  assert.equal(reviewRowValueId('incident_type'), 'rv-row-incident_type');
  // Distinct from the id of the control the row opens, so the two never collide.
  assert.notEqual(reviewRowValueId('narrative'), reviewFieldId('narrative'));
});

// ---------------------------------------------------------------------------
// The date/time halves. The form and the review both write this column through
// these, and the failure they prevent is quiet: a review edit that dropped the
// time (or the date) the officer had already entered.
// ---------------------------------------------------------------------------

test('the date and time halves read back out of one stored datetime', () => {
  assert.equal(incidentDatePart('2026-09-18T14:30'), '2026-09-18');
  assert.equal(incidentTimePart('2026-09-18T14:30'), '14:30');
  assert.equal(incidentDatePart('2026-09-18'), '2026-09-18');
  assert.equal(incidentTimePart('2026-09-18'), '');
  // Nothing recorded yet reads as nothing, not as today.
  assert.equal(incidentDatePart(''), '');
  assert.equal(incidentTimePart(''), '');
  assert.equal(incidentDatePart(undefined), '');
  assert.equal(incidentTimePart(null), '');
});

test('changing the date keeps the time that was already entered', () => {
  assert.equal(setIncidentDate('2026-09-18T14:30', '2026-09-19'), '2026-09-19T14:30');
  assert.equal(setIncidentDate('2026-09-18', '2026-09-19'), '2026-09-19');
  assert.equal(setIncidentDate('', '2026-09-19'), '2026-09-19');
  // Clearing the date clears the whole value — a time with no date is not a
  // datetime the server can store.
  assert.equal(setIncidentDate('2026-09-18T14:30', ''), '');
});

test('changing the time keeps the date, or borrows today when there is none', () => {
  assert.equal(setIncidentTime('2026-09-18T14:30', '15:00'), '2026-09-18T15:00');
  assert.equal(setIncidentTime('2026-09-18', '15:00'), '2026-09-18T15:00');
  assert.equal(setIncidentTime('', '15:00', '2026-09-18'), '2026-09-18T15:00');
  // Clearing the time leaves the date, which is how "date known, time not"
  // gets stored.
  assert.equal(setIncidentTime('2026-09-18T14:30', ''), '2026-09-18');
  assert.equal(setIncidentTime('2026-09-18T14:30', '', '2026-09-01'), '2026-09-18');
});

// ---------------------------------------------------------------------------
// Reading values. The `type_specific.` gap between the engine's spelling of a
// group row and the stored blob is the whole reason this function exists.
// ---------------------------------------------------------------------------

const DRAFT = {
  id: 7,
  incident_type: 'Theft',
  narrative: 'On or about 0200H…',
  location: 'Rizal Street',
  action_taken: '',
  type_specific: {
    cctv_available: 'No',
    estimated_value: '18500',
    vehicles: [{ plate_number: 'ABC-1234' }, { plate_number: '' }],
  },
};

test('valueAtPath reads plain columns, the blob, and both group shapes', () => {
  assert.equal(valueAtPath(DRAFT, 'narrative'), 'On or about 0200H…');
  assert.equal(valueAtPath(DRAFT, 'type_specific.cctv_available'), 'No');
  assert.equal(valueAtPath(DRAFT, 'vehicles[0].plate_number'), 'ABC-1234');
  assert.equal(valueAtPath(DRAFT, 'vehicles[1].plate_number'), '');
  // A bare group key reads the list itself.
  assert.deepEqual(valueAtPath(DRAFT, 'vehicles'), [{ plate_number: 'ABC-1234' }, { plate_number: '' }]);
  // An index that is not there is undefined, not a throw.
  assert.equal(valueAtPath(DRAFT, 'vehicles[9].plate_number'), undefined);
});

test('valueAtPath tolerates a null draft and a missing blob', () => {
  assert.equal(valueAtPath(null, 'narrative'), undefined);
  assert.equal(valueAtPath({}, 'type_specific.cctv_available'), undefined);
  assert.equal(valueAtPath({}, 'vehicles[0].plate_number'), undefined);
  assert.equal(valueAtPath(DRAFT, ''), undefined);
});

test('sameReviewValue treats the three spellings of empty as one absence', () => {
  assert.equal(sameReviewValue('', null), true);
  assert.equal(sameReviewValue(undefined, ''), true);
  assert.equal(sameReviewValue('   ', null), true);
  assert.equal(sameReviewValue('x', ''), false);
  // false is a value, not an absence: the approximate-time checkbox.
  assert.equal(sameReviewValue(false, ''), false);
  assert.equal(sameReviewValue(false, false), true);
});

test('sameReviewValue compares group rows structurally, not by identity', () => {
  const a = [{ plate_number: 'ABC-1234' }];
  const b = [{ plate_number: 'ABC-1234' }];
  assert.equal(sameReviewValue(a, b), true);
  assert.equal(sameReviewValue(a, [{ plate_number: 'XYZ-9999' }]), false);
  assert.equal(sameReviewValue(a, []), false);
  // One more row that is entirely blank is still a different list.
  assert.equal(sameReviewValue([], [{}]), false);
});

test('numbers and their typed spellings are the same value', () => {
  assert.equal(sameReviewValue(18500, '18500'), true);
  assert.equal(sameReviewValue(18500, '18,500'), false);
});

test('changedReviewPaths reports only what moved since the snapshot', () => {
  const snapshot = {
    narrative: 'first',
    location: 'Rizal Street',
    type_specific: { cctv_available: 'No', vehicles: [{ plate_number: 'ABC-1234' }] },
  };
  const draft = {
    narrative: 'second',
    location: 'Rizal Street',
    type_specific: { cctv_available: 'Yes', vehicles: [{ plate_number: 'ABC-1234' }] },
  };
  assert.deepEqual(
    changedReviewPaths(snapshot, draft, ['narrative', 'location', 'type_specific.cctv_available', 'vehicles[0].plate_number']),
    ['narrative', 'type_specific.cctv_available'],
  );
});

test('changedReviewPaths is empty when nothing changed, and safe with no snapshot', () => {
  assert.deepEqual(changedReviewPaths(DRAFT, DRAFT, REVIEW_SCALAR_PATHS), []);
  // A row that goes undefined → '' is not a change; an untouched group is not a
  // change; adding a row is.
  assert.deepEqual(changedReviewPaths({ action_taken: null }, { action_taken: '' }, ['action_taken']), []);
  assert.deepEqual(
    changedReviewPaths({ type_specific: { vehicles: [{}] } }, { type_specific: { vehicles: [{}, {}] } }, ['vehicles']),
    ['vehicles'],
  );
  assert.deepEqual(changedReviewPaths(null, DRAFT, REVIEW_SCALAR_PATHS), []);
});
