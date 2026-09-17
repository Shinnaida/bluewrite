import test from 'node:test';
import assert from 'node:assert/strict';

import {
  caseNumber,
  dateParts,
  reportDateValue,
  reportYear,
  specDate,
  specTimestamp,
} from '../../src/lib/incidentReport.js';

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
