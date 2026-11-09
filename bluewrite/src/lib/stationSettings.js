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
import { richTextToPlain, sanitizeLetterHtml } from './richText.js';

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
// The contact lines and the default sign-off
// ---------------------------------------------------------------------------

/**
 * The default Noted By official — kept on file WITH the letterhead. `max`
 * mirrors the limit StationController::update() validates to; `kind`
 * decides the input drawn.
 *
 * noted_by is the name printed on the sheet's "Noted by:" line when a report
 * names no reviewing official of its own. Blank means "not set": the sheet
 * falls back to BUILT_IN_NOTED_BY, which mirrors the constant the sheet draws
 * (NOTED_BY_NAME in components/reports/ReportSheetBody.jsx) — keep the two in
 * lockstep.
 *
 * The Gmail/telephone lines were removed from this form (owner request):
 * they already live as typed lines in the freed letterhead document, so a
 * second copy here was only a second place to mistype them. The resolver
 * below still reads them when an old row carries them, so existing sheets
 * keep printing what is on file.
 */
export const CONTACT_FIELDS = [
  { key: 'noted_by', label: 'Default Noted By officer', max: 120, kind: 'officer' },
];

/** What the sheet prints for "Noted by:" when neither the report nor the station names anyone. */
export const BUILT_IN_NOTED_BY = 'DEXTER MALEZA CALACAR';

/** The contact block as strings — blank (not the letterhead defaults) is the empty state. */
export function resolveContact(header) {
  const out = { station_email: '', station_phone: '', noted_by: '' };
  if (header && typeof header === 'object') {
    // CONTACT_FIELDS is what the form offers (sign-off only); the two legacy
    // keys are still read so rows saved before their removal keep printing.
    for (const key of [...CONTACT_FIELDS.map((f) => f.key), 'station_email', 'station_phone']) {
      const v = header[key];
      if (typeof v === 'string' && v.trim() !== '' && out[key] === '') out[key] = v;
    }
  }
  return out;
}

/**
 * The name printed on the sheet's "Noted by:" line — the station's saved
 * sign-off when one is on file, else the built-in fallback the sheets drew
 * before the setting existed. Accepts the station header (or anything
 * resolveContact reads); blank is never returned, so the line always names
 * someone. The sheet's CSS uppercases it for print.
 */
export function resolveNotedBy(header) {
  const name = String(resolveContact(header)?.noted_by ?? '').trim();
  return name !== '' ? name : BUILT_IN_NOTED_BY;
}

/** Which contact lines differ from what is saved — the PATCH sends only these. */
export function changedContactFields(current, saved) {
  const body = {};
  for (const { key } of CONTACT_FIELDS) {
    const now = String(current?.[key] ?? '').trim();
    const before = String(saved?.[key] ?? '').trim();
    if (now !== before) body[key] = now;
  }
  return body;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * First problem with the contact block, or null.
 *
 * Everything here is optional — a blank line clears it — so only a malformed
 * value is refused. The email check is deliberately looser than the server's
 * filter_var: it only has to catch a typo before the round trip, and the
 * server remains the authority.
 */
export function contactError(current) {
  for (const { key, label, max, kind } of CONTACT_FIELDS) {
    const v = String(current?.[key] ?? '').trim();
    if (v === '') continue;
    if (v.length > max) return `${label} must be at most ${max} characters.`;
    if (kind === 'email' && !EMAIL_RE.test(v)) return `${label} must be a valid email address.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The letterhead as a document
// ---------------------------------------------------------------------------

/**
 * The freed letterhead's text budget, in characters of words (not markup) —
 * mirrors StationController::LETTERHEAD_MAX_WORDS. Keep the two in lockstep.
 */
export const LETTERHEAD_MAX_WORDS = 2000;

/** Escape once: the seed is built from field text, never trusted markup. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The standard letterhead as a document — the seed the Word-like editor
 * opens from. Centered lines in sheet order (the seven lines, then the
 * contact lines), in the same subset the freed document keeps, so seeding
 * round-trips: opening the editor and saving without touching anything
 * stores the standard letterhead word for word.
 */
export function composeLetterheadHtml(header, contact) {
  const h = resolveHeader(header);
  const c = resolveContact(contact ?? header);
  const lines = [
    h.agency,
    h.commission,
    `<strong>${esc(h.regional_office)}</strong>`,
    `<strong>${esc(h.provincial_office)}</strong>`,
    `<strong>${esc(h.station_name)}</strong>`,
    esc(h.station_location),
  ];
  if (c.station_phone) lines.push(esc(c.station_phone));
  if (c.station_email) lines.push(`Email Add: ${esc(c.station_email)}`);
  return `<div align="center">${lines.map((l) => `<p>${l}</p>`).join('')}</div>`;
}

/**
 * First problem with a freed letterhead document, or null.
 *
 * Length is read in WORDS (richTextToPlain), not markup — the same rule the
 * server enforces after sanitizing — so formatting can never spend the
 * budget, and the editor agrees with the 422 before the round trip.
 */
export function letterheadHtmlError(html) {
  const words = richTextToPlain(sanitizeLetterHtml(html ?? ''));
  if (words.length > LETTERHEAD_MAX_WORDS) {
    return `The letterhead document must be at most ${LETTERHEAD_MAX_WORDS} characters of text.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The letterhead's presentation — typography, spacing, color, seals
// ---------------------------------------------------------------------------

/**
 * The letterhead's presentation as DATA, not markup. The stored letter HTML
 * keeps no style of its own (the sanitizer strips every style attribute on
 * both sides of the wire), and every sheet renders this object as its
 * container's own inline style. Mirrors Station::letterheadStyle() and
 * StationController::letterheadStyleError() — keep the three in lockstep.
 */
export const LETTERHEAD_STYLE_DEFAULTS = {
  font: 'Arial',
  size_px: 13,
  line_height: 1.5,
  letter_spacing_px: 0,
  color: '#0f1f3d',
  align: 'center',
  seals: 'split',
};

/** Faces the style editor offers — sheet-safe, no download needed. */
export const LETTERHEAD_STYLE_FONTS = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];

export const LETTERHEAD_STYLE_SEALS = ['split', 'swapped', 'stacked'];

export const LETTERHEAD_STYLE_ALIGN = ['left', 'center', 'right', 'justify'];

function styleNum(v, lo, hi) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/** A full style object: the stored value kept where it is valid, defaults elsewhere. */
export function resolveLetterheadStyle(stored) {
  const out = { ...LETTERHEAD_STYLE_DEFAULTS };
  if (!stored || typeof stored !== 'object') return out;
  if (LETTERHEAD_STYLE_FONTS.includes(stored.font)) out.font = stored.font;
  const size = styleNum(stored.size_px, 10, 22);
  if (size !== null) out.size_px = Math.round(size);
  const lh = styleNum(stored.line_height, 1.0, 2.5);
  if (lh !== null) out.line_height = Math.round(lh * 100) / 100;
  const ls = styleNum(stored.letter_spacing_px, 0, 3);
  if (ls !== null) out.letter_spacing_px = Math.round(ls * 100) / 100;
  if (typeof stored.color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(stored.color.trim())) {
    out.color = stored.color.trim();
  }
  if (LETTERHEAD_STYLE_ALIGN.includes(stored.align)) out.align = stored.align;
  if (LETTERHEAD_STYLE_SEALS.includes(stored.seals)) out.seals = stored.seals;
  return out;
}

/** Which style keys differ from what is saved — the PATCH sends only these. */
export function changedLetterheadStyle(current, saved) {
  const body = {};
  const now = resolveLetterheadStyle(current);
  const before = resolveLetterheadStyle(saved);
  for (const key of Object.keys(LETTERHEAD_STYLE_DEFAULTS)) {
    if (now[key] !== before[key]) body[key] = now[key];
  }
  return body;
}

/**
 * First problem with a letterhead style, or null. Mirrors the server's 422s:
 * only the seven known keys pass, each inside its own range.
 */
export function letterheadStyleError(current) {
  const v = current ?? {};
  const known = Object.keys(LETTERHEAD_STYLE_DEFAULTS);
  for (const key of Object.keys(v)) {
    if (!known.includes(key)) return 'The letterhead style holds an unknown setting.';
  }
  if (v.font !== undefined && !LETTERHEAD_STYLE_FONTS.includes(v.font)) {
    return 'The letterhead font is not offered.';
  }
  if (v.size_px !== undefined && styleNum(v.size_px, 10, 22) === null) {
    return 'The letterhead size must be between 10 and 22.';
  }
  if (v.line_height !== undefined && styleNum(v.line_height, 1.0, 2.5) === null) {
    return 'The letterhead line spacing must be between 1.0 and 2.5.';
  }
  if (v.letter_spacing_px !== undefined && styleNum(v.letter_spacing_px, 0, 3) === null) {
    return 'The letterhead letter spacing must be between 0 and 3.';
  }
  if (v.color !== undefined && !(typeof v.color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.color.trim()))) {
    return 'The letterhead color must be a hex color.';
  }
  if (v.align !== undefined && !LETTERHEAD_STYLE_ALIGN.includes(v.align)) {
    return 'The letterhead alignment is not offered.';
  }
  if (v.seals !== undefined && !LETTERHEAD_STYLE_SEALS.includes(v.seals)) {
    return 'The seal arrangement is not offered.';
  }
  return null;
}

/**
 * The style object as a container's inline style — the one translation the
 * admin preview, the write sheet and the print sheet all share, so the
 * three cannot disagree about what a setting looks like.
 */
const LETTERHEAD_FONT_FALLBACK = {
  Arial: 'sans-serif',
  Verdana: 'sans-serif',
  Georgia: 'serif',
  'Times New Roman': 'serif',
  'Courier New': 'monospace',
};

export function letterheadCss(style) {
  const s = resolveLetterheadStyle(style);
  return {
    fontFamily: `'${s.font}', ${LETTERHEAD_FONT_FALLBACK[s.font] ?? 'sans-serif'}`,
    fontSize: `${s.size_px}px`,
    lineHeight: String(s.line_height),
    letterSpacing: `${s.letter_spacing_px}px`,
    color: s.color,
    textAlign: s.align,
  };
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
