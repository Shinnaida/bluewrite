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

// ---------------------------------------------------------------------------
// The Type of Incident box: what it shows, and what it stores.
//
// The box is TYPABLE — the officer types into one control rather than hunting
// through a menu. The station's configured types are its suggestions, but an
// officer whose incident is not on the list types it in the same box rather than
// hunting for a second field — and the answer lands where such a report ALREADY
// keeps it: the Other Incident's "Category" (type_specific.incident_category),
// which is a required field of that type and is not a new field of any kind.
//
// The one thing the box may NOT do is store a type the server does not know.
// The incident type is what every downstream reader keys on — the per-type
// fields, the party groups, the AI prompt, the dashboard bands, the printed
// block headings — and the API refuses a type outside the station's list, so a
// report filed as "Illegal Gambling" would have no type-specific fields at all
// and could not be saved. Hence resolveIncidentTypeInput: free text resolves to
// the catch-all type, never to a type of the officer's own invention.
//
// Pure functions, no DOM — covered by node:test.
// ---------------------------------------------------------------------------

/** The catch-all type. A type this station may configure away, hence the guard. */
export const CUSTOM_TYPE = 'Other Incident';

/**
 * What the Type of Incident box DISPLAYS for a draft.
 *
 * An Other Incident that carries a specification shows the SPECIFICATION, not
 * the catch-all's name: the officer typed "Illegal Gambling" into that box and
 * it has to still read that way when they come back to it — and the Category
 * field in the type-specific block, which shows the same value, is then visibly
 * the same answer rather than a second one.
 */
export function incidentTypeBoxValue(draft) {
  const type = String(draft?.incident_type ?? '');
  if (type === CUSTOM_TYPE) {
    const custom = String(draft?.type_specific?.incident_category ?? '').trim();
    if (custom !== '') return custom;
  }
  return type;
}

/**
 * What a typed value in that box means for the report.
 *
 * @param {string} typed  exactly what is in the box
 * @param {string[]} types  the station's configured types (the box's suggestions)
 * @returns {{type: string, custom: string|null}} `type` is a canonical type, ''
 *   when the box was cleared, or CUSTOM_TYPE; `custom` is the specification to
 *   store as that type's Category, else null.
 *
 * A station whose list does not carry the catch-all gets no custom handling: a
 * type it would refuse cannot be handed to it, so unmatched text resolves to
 * nothing and the officer picks from the list. (`typeOptions` falls back to the
 * built-in 14 whenever the station has configured none, and the catch-all is in
 * that list, so this is the guarded edge rather than the ordinary case.)
 */
export function resolveIncidentTypeInput(typed, types) {
  const raw = String(typed ?? '').trim();
  if (raw === '') return { type: '', custom: null };

  const list = Array.isArray(types) ? types : [];
  const known = list.find((t) => String(t).toLowerCase() === raw.toLowerCase());
  if (known) return { type: String(known), custom: null };

  if (!list.includes(CUSTOM_TYPE)) return { type: '', custom: null };
  return { type: CUSTOM_TYPE, custom: raw };
}
