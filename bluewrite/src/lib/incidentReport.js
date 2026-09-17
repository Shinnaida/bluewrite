// BlueWrite — display identifiers for the Write Report screen.
//
// The spec's screen header shows a case number and a date:
//     CASE NO: #IR-2026-9082
//     DATE: SEPTEMBER 16, 2026
//
// BlueWrite already has a stable internal identifier (BW-####) that the
// blotter list, the audit browser, the CSV export and the print sheet all
// use, so it is NOT replaced. The IR- number is a presentation-layer alias
// derived from the report itself: same underlying row, same persistence,
// nothing to migrate.
//
//   * only an existing report has a number: a report that has not been
//     saved yet prints "#IR-<year>-PENDING" rather than inventing a
//     sequence that another officer's report could later claim.
//
// Pure functions, no DOM — covered by node:test.

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** Split a date / datetime string (or Date) into its literal parts. */
export function dateParts(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      y: value.getFullYear(),
      m: value.getMonth() + 1,
      d: value.getDate(),
      hh: value.getHours(),
      mm: value.getMinutes(),
    };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value).trim());
  if (!m) return null;
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: m[4] === undefined ? null : Number(m[4]),
    mm: m[5] === undefined ? null : Number(m[5]),
  };
}

/** "2026-09-16" -> "SEPTEMBER 16, 2026". Blank/invalid input -> ''. */
export function specDate(value) {
  const p = dateParts(value);
  if (!p) return '';
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** "2026-09-16 15:05:00" -> "SEPTEMBER 16, 2026, 3:05 PM". */
export function specTimestamp(value) {
  const p = dateParts(value);
  if (!p) return '';
  const date = `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
  if (p.hh === null || p.mm === null) return date;
  const suffix = p.hh < 12 ? 'AM' : 'PM';
  const hour12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${date}, ${hour12}:${String(p.mm).padStart(2, '0')} ${suffix}`;
}

/** The date the report is dated with: the report's own date when recorded. */
export function reportDateValue(report, fallback = null) {
  const candidates = [
    report?.report_date,
    report?.created_at,
    report?.incident_date,
    report?.incident_datetime,
  ];
  for (const c of candidates) {
    const p = dateParts(c);
    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  return fallback ?? '';
}

/** Year used in the case number: from the report's own date, else today. */
export function reportYear(report, today = new Date()) {
  const p = dateParts(reportDateValue(report, null)) ?? dateParts(today);
  return p ? p.y : today.getFullYear();
}

/**
 * "#IR-2026-0292" for a saved report, "#IR-2026-PENDING" for one that has
 * not been written to the database yet.
 */
export function caseNumber(report, today = new Date()) {
  const year = reportYear(report ?? {}, today);
  const id = Number(report?.id);
  const sequence = Number.isInteger(id) && id > 0 ? String(id).padStart(4, '0') : 'PENDING';
  return `#IR-${year}-${sequence}`;
}
