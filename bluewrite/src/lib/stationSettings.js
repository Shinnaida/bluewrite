// BLUEWRITE — station settings, as data.
//
// The station is DEPLOYMENT data, not per-request data: one row (id = 1),
// because BlueWrite runs at a single station. What lives there is the letterhead
// that prints on every sheet, the incident types the form offers, and — derived
// from the users table rather than stored — the personnel who can be named as
// IOC / Noted By.
//
// This module holds the two rule sets the Admin screen and the server have to
// agree on, and nothing else:
//
//   HEADER_FIELDS   — the seven editable letterhead fields, each with the
//                     maximum length StationController::update() validates to.
//                     Typed out here so the form can stop an over-long value
//                     BEFORE the round trip; the server remains the authority.
//   the type rules  — mirrors sanitizeTypes(): a plain list of at most 40
//                     non-empty names, each at most 60 characters, deduplicated.
//
// It is deliberately free of React and of the network, so the rules can be
// tested directly (tests/rules/stationSettings.test.mjs).

import { INCIDENT_TYPES, TYPE_FIELDS } from './incidentTypes.js';

// ---------------------------------------------------------------------------
// The letterhead
// ---------------------------------------------------------------------------

/**
 * The editable letterhead, in the order the panel prints it. `max` mirrors the
 * Validator limits in StationController::update() — keep the two in lockstep.
 *
 * The labels here are the OFFICIAL names of the lines, not shorthand: an Admin
 * changing `station_name` is changing a line of the Republic's letterhead, and
 * "Station name" is the only thing that should be typed into it.
 */
export const HEADER_FIELDS = [
  { key: 'agency', label: 'Agency', max: 120 },
  { key: 'commission', label: 'Commission', max: 120 },
  { key: 'regional_office', label: 'Regional office', max: 120 },
  { key: 'provincial_office', label: 'Provincial office', max: 120 },
  { key: 'station_name', label: 'Station name', max: 160 },
  { key: 'station_location', label: 'Station location', max: 160 },
  { key: 'office_code', label: 'Office / unit code', max: 40 },
];

/**
 * The built-in letterhead — the Naga defaults in App\Core\Station::DEFAULTS.
 *
 * Needed in the browser for one reason: the printed sheet must never come out
 * blank. /station can fail (a station whose settings table has not been
 * migrated logs a warning and falls back server-side), and the print payload
 * carries the header only when the read succeeded. These are the same fallback
 * lines, so the sheet degrades to the built-in letterhead instead of to empty
 * space where the Republic's name should be.
 */
export const STATION_DEFAULTS = {
  agency: 'Republic of the Philippines',
  commission: 'National Police Commission',
  regional_office: 'PHILIPPINE NATIONAL POLICE, POLICE REGIONAL OFFICE 7',
  provincial_office: 'CEBU POLICE PROVINCIAL OFFICE',
  station_name: 'CITY of NAGA POLICE STATION',
  station_location: 'City of Naga, Cebu',
  office_code: 'NCPS – INVEST',
};

/** A header block with every key present, filled from the defaults. */
export function resolveHeader(header) {
  const out = { ...STATION_DEFAULTS };
  if (header && typeof header === 'object') {
    for (const { key } of HEADER_FIELDS) {
      const v = header[key];
      if (typeof v === 'string' && v.trim() !== '') out[key] = v;
    }
  }
  return out;
}

/** Which of the seven differ from what is saved — the PATCH sends only these. */
export function changedHeaderFields(current, saved) {
  const body = {};
  for (const { key } of HEADER_FIELDS) {
    const now = String(current?.[key] ?? '').trim();
    const before = String(saved?.[key] ?? '').trim();
    if (now !== before) body[key] = now;
  }
  return body;
}

/**
 * First problem with the editable letterhead, or null.
 *
 * The server rejects a blank field (`$v->require`) — that is why this does too:
 * an Admin who clears the station name should be told here, not by a 422 after
 * a save that looked like it worked.
 */
export function headerError(current) {
  for (const { key, label, max } of HEADER_FIELDS) {
    const v = String(current?.[key] ?? '').trim();
    if (v === '') return `${label} cannot be blank.`;
    if (v.length > max) return `${label} must be at most ${max} characters.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The incident-type list
// ---------------------------------------------------------------------------

/** Mirrors sanitizeTypes() in StationController: at most 40 names… */
export const MAX_TYPE_COUNT = 40;
/** …each at most 60 characters. */
export const MAX_TYPE_NAME = 60;

/**
 * The names that have a SCHEMA — the 14 canonical types, which is the order the
 * form offers them in by default.
 *
 * This is the constraint that shapes the whole screen. A type is not just a
 * label: it carries its own fields (TYPE_FIELDS) and its own repeatable groups
 * (GROUP_CONFIG) on both sides of the wire, mirrored in report_rules.php. A name
 * no schema knows still PASSES the server's list validation — sanitizeTypes only
 * checks that entries are short text — but a report filed under it renders no
 * type-specific section at all, silently. So the screen offers these 14 and
 * nothing else, and says why.
 */
export const CANONICAL_TYPES = INCIDENT_TYPES;

/** Does the form and the rule engine know this type? */
export function isCanonical(type) {
  return Object.prototype.hasOwnProperty.call(TYPE_FIELDS, type);
}

/**
 * The stored list, cleaned the way the server cleans it: trimmed, blanks
 * dropped, duplicates removed (first wins), order preserved.
 *
 * Mirrors sanitizeTypes(), except that it does not report — validation is a
 * separate question (typeListError), because the screen needs to DISPLAY a
 * configured list it would refuse to save.
 */
export function normaliseTypes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (t === '' || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** First problem with a type list, or null. Mirrors the server's 422s. */
export function typeListError(list) {
  const names = normaliseTypes(list);
  if (names.length === 0) return 'Keep at least one incident type.';
  if (names.length > MAX_TYPE_COUNT) return `At most ${MAX_TYPE_COUNT} incident types.`;
  for (const t of names) {
    if (t.length > MAX_TYPE_NAME) {
      return `“${t.slice(0, 24)}…” is longer than ${MAX_TYPE_NAME} characters.`;
    }
  }
  return null;
}

/** Are two lists the same, order included? Order IS part of the datum here. */
export function sameTypes(a, b) {
  const x = normaliseTypes(a);
  const y = normaliseTypes(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/**
 * The type list as rows for the editor, given what is stored.
 *
 * Enabled rows come first, in the STORED order — so a station that put its
 * commonest types at the top of the dropdown keeps them there, and saving does
 * not quietly resort them. Switched-off rows follow in canonical order, which is
 * where a type returns to when it is switched back on.
 *
 * A stored name no schema knows is reported separately (`unknown`) rather than
 * dropped: it was configured deliberately, possibly through the API, and a
 * settings screen that silently deleted it would be worse than one that says
 * "the form cannot draw a section for this".
 *
 * @returns {{ rows: {name: string, enabled: boolean}[], unknown: string[] }}
 */
export function buildTypeRows(stored, canonical = CANONICAL_TYPES) {
  const present = normaliseTypes(stored);
  // An EMPTY stored list is not "no types". The server stores null for one, and
  // Station::incidentTypes() answers with the built-in list — so a station with
  // nothing configured is offered all 14, and drawing them all as switched off
  // here would show the opposite of what the form does. (The read itself never
  // returns an empty list for this reason; this mirrors the rule rather than
  // relying on that.)
  const enabled = present.length === 0 ? [...canonical] : present.filter(isCanonical);
  const known = new Set(enabled);
  const rows = [
    ...enabled.map((name) => ({ name, enabled: true })),
    ...canonical.filter((t) => !known.has(t)).map((name) => ({ name, enabled: false })),
  ];
  // Unknown names are NOT rows (there is nothing to switch off — the form never
  // offered them) but they must survive a save, so they are returned as-is.
  const unknown = present.filter((t) => !isCanonical(t));
  // `present.length === 0` means the defaults are in force, so there is nothing
  // "unknown" about them either.
  return { rows, unknown };
}
