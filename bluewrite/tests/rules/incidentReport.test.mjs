import test from 'node:test';
import assert from 'node:assert/strict';

import {
  caseNumber,
  dateParts,
  reportDateValue,
  reportYear,
  specDate,
  specTimestamp,
  stationClock,
  CUSTOM_TYPE,
  incidentTypeBoxValue,
  resolveIncidentTypeInput,
} from '../../src/lib/incidentReport.js';

// The station's own list, as the form receives it. "Other Incident" is the
// catch-all the custom path resolves to.
const TYPES = [
  'Theft',
  'Traffic Accident',
  'Missing Person',
  'Other Incident',
];

const TODAY = new Date('2026-09-16T10:00:00');

test('specDate formats a date the way the screen header shows it', () => {
  assert.equal(specDate('2026-09-16'), 'SEPTEMBER 16, 2026');
  assert.equal(specDate('2026-01-01'), 'JANUARY 1, 2026');
  assert.equal(specDate('2026-12-31'), 'DECEMBER 31, 2026');
});

test('specDate tolerates a datetime, a Date and junk', () => {
  assert.equal(specDate('2026-09-16 15:05:00'), 'SEPTEMBER 16, 2026');
  assert.equal(specDate('2026-09-16T15:05:00'), 'SEPTEMBER 16, 2026');
  assert.equal(specDate(new Date('2026-09-16T15:05:00')), 'SEPTEMBER 16, 2026');
  assert.equal(specDate(''), '');
  assert.equal(specDate(null), '');
  assert.equal(specDate('not a date'), '');
});

test('specTimestamp adds a 12-hour clock, and drops it when absent', () => {
  assert.equal(specTimestamp('2026-09-16 15:05:00'), 'SEPTEMBER 16, 2026, 3:05 PM');
  assert.equal(specTimestamp('2026-09-16 09:07:00'), 'SEPTEMBER 16, 2026, 9:07 AM');
  assert.equal(specTimestamp('2026-09-16 00:30:00'), 'SEPTEMBER 16, 2026, 12:30 AM');
  assert.equal(specTimestamp('2026-09-16 12:00:00'), 'SEPTEMBER 16, 2026, 12:00 PM');
  assert.equal(specTimestamp('2026-09-16'), 'SEPTEMBER 16, 2026');
});

test('stationClock reads the STATION clock, not the machine clock', () => {
  // 06:08:21 UTC is 14:08:21 in Manila, in whatever zone the test machine runs.
  // The save line reports a time the record has to agree with, so it is pinned
  // to Philippine Standard Time rather than to the officer's browser.
  assert.equal(stationClock(new Date('2026-09-16T06:08:21Z')), '14:08:21');
  assert.equal(stationClock(new Date('2026-09-16T06:08:21Z').getTime()), '14:08:21');
  // Nothing to say rather than "Invalid Date" — the caller renders no line.
  assert.equal(stationClock(''), '');
  assert.equal(stationClock('not a date'), '');
  assert.equal(stationClock(null), '');
});

test('dateParts never shifts the day through a timezone', () => {
  // A naive Date() parse of a bare date is UTC midnight, which would read as
  // the previous day west of Greenwich — the parser must not do that.
  assert.deepEqual(dateParts('2026-09-16'), { y: 2026, m: 9, d: 16, hh: null, mm: null });
  assert.deepEqual(dateParts('2026-09-16T00:00'), { y: 2026, m: 9, d: 16, hh: 0, mm: 0 });
});

test('reportDateValue prefers the report date, then when it was written', () => {
  assert.equal(reportDateValue({ report_date: '2026-09-15' }), '2026-09-15');
  assert.equal(reportDateValue({ report_date: null, created_at: '2026-09-14 08:00:00' }), '2026-09-14');
  assert.equal(
    reportDateValue({ report_date: null, created_at: null, incident_datetime: '2026-09-13 22:00:00' }),
    '2026-09-13',
  );
  assert.equal(reportDateValue({}, '2026-09-16'), '2026-09-16');
});

test('reportYear and caseNumber use the report date, not the clock', () => {
  assert.equal(reportYear({ report_date: '2025-12-31' }, TODAY), 2025);
  assert.equal(reportYear({}, TODAY), 2026);
});

test('caseNumber numbers saved reports and marks unsaved ones pending', () => {
  assert.equal(caseNumber({ id: 292, report_date: '2026-09-15' }, TODAY), '#IR-2026-0292');
  assert.equal(caseNumber({ id: 5 }, TODAY), '#IR-2026-0005');
  // A brand-new draft has no id: it must not borrow another report's number.
  assert.equal(caseNumber({ report_date: '2026-09-16' }, TODAY), '#IR-2026-PENDING');
  assert.equal(caseNumber(null, TODAY), '#IR-2026-PENDING');
});

// ---------------------------------------------------------------------------
// The Type of Incident box: typeable, but never a type the server would refuse.
// ---------------------------------------------------------------------------

test('typed text that names a type resolves to that type, whatever its case', () => {
  assert.deepEqual(resolveIncidentTypeInput('Theft', TYPES), { type: 'Theft', custom: null });
  // Typing is how the box is filtered, so the officer's casing must not create a
  // second, near-identical type on the register.
  assert.deepEqual(resolveIncidentTypeInput('theft', TYPES), { type: 'Theft', custom: null });
  assert.deepEqual(resolveIncidentTypeInput('  TRAFFIC ACCIDENT ', TYPES), {
    type: 'Traffic Accident',
    custom: null,
  });
});

test('text that is not a type becomes an Other Incident, specified', () => {
  // The whole point of the typeable box: an incident the station has no type for
  // is typed here rather than hunted for, and its words are kept as the Other
  // Incident's Category — where that type already keeps its specification.
  assert.deepEqual(resolveIncidentTypeInput('Illegal Gambling', TYPES), {
    type: CUSTOM_TYPE,
    custom: 'Illegal Gambling',
  });
});

test('an empty box clears the type and carries no specification', () => {
  assert.deepEqual(resolveIncidentTypeInput('', TYPES), { type: '', custom: null });
  assert.deepEqual(resolveIncidentTypeInput('   ', TYPES), { type: '', custom: null });
  assert.deepEqual(resolveIncidentTypeInput(null, TYPES), { type: '', custom: null });
});

test('a station without the catch-all is never handed a custom type', () => {
  // A type the station's own list does not carry cannot be handed to a server
  // that validates against that list, so unmatched text resolves to nothing and
  // the officer picks from the list instead of getting a report the API refuses.
  const noCatchAll = ['Theft', 'Robbery'];
  assert.deepEqual(resolveIncidentTypeInput('Illegal Gambling', noCatchAll), {
    type: '',
    custom: null,
  });
  // A real type still resolves as usual.
  assert.deepEqual(resolveIncidentTypeInput('Robbery', noCatchAll), { type: 'Robbery', custom: null });
});

test('the box shows the specification back for an Other Incident that has one', () => {
  // The officer typed "Illegal Gambling" into that box, so it has to still read
  // that way when they return to it — and it is the SAME value the Category
  // field in the type-specific block shows, not a second one.
  assert.equal(
    incidentTypeBoxValue({
      incident_type: 'Other Incident',
      type_specific: { incident_category: 'Illegal Gambling' },
    }),
    'Illegal Gambling',
  );
  // An Other Incident with nothing specified still reads as its own name, so the
  // box is never blank while a type exists.
  assert.equal(
    incidentTypeBoxValue({ incident_type: 'Other Incident', type_specific: {} }),
    'Other Incident',
  );
  // Every other type reads back as itself.
  assert.equal(incidentTypeBoxValue({ incident_type: 'Theft' }), 'Theft');
  assert.equal(incidentTypeBoxValue({ incident_type: '', type_specific: {} }), '');
  assert.equal(incidentTypeBoxValue(null), '');
});
