// Phase 7 — the account read, turned into a change to the report form.
//
// POST /ai/classify reads the incident type, the date and time, the place, the
// reporting party, the disposition and the named people out of an account the
// officer typed in their own words. This module is the other half: it decides
// what that reading is allowed to CHANGE in the form.
//
// PURE, and deliberately small. The editor owns the request, the setters and
// the dirty flag; this owns one decision set, and it is the decision the
// officer's work depends on:
//
//   1. EMPTY ONLY. A field the officer has already filled is never touched —
//      not even when the read disagrees with it. The officer's own answer is
//      the record; the read fills the blanks around it. This is the rule that
//      makes a silent fill safe to run behind a button press.
//   2. THE FORM'S OWN LIST WINS. A read that names the incident in legal
//      words rather than the form's own spelling ("Reckless imprudence
//      resulting to damage to property and physical injury") is FOLDED to the
//      closest type on the caller's list — the server applies the same rule,
//      so the two never disagree — and the read's own words are kept as the
//      report's Category, the same line a typed box keeps them on. An "Other"
//      answer whose title words fold to a concrete type follows the title —
//      a reckless-imprudence traffic blotter files as Traffic Accident, with
//      its charge kept as the Category. A text with no real signal is
//      dropped, not invented: a type that is neither named nor foldable
//      leaves the draft's type (and Category) alone.
//   3. A ROLE IS NOT A PERSON. A party lands in a group only when it has a name
//      AND the type has that group; an unnamed role is not a row, and a witness
//      row on a type with no Witnesses group is not a row either.
//
// Nothing here reads state, the network or the clock, so the tests can ask any
// question of any draft.

import { GROUP_CONFIG, TYPE_FIELDS, classifyClosestType } from './incidentTypes.js';
import { applyRowVisibility, hasGroupRows, meaningfulRows } from './reportRules.js';
import { correctNagaLocation } from './nagaPlaces.js';

// The answer's scalar fields, in the order the form asks for them, with the
// label the officer reads in the receipt line. One row per field: the key that
// arrives from the server, and the words the form uses for it.
const SCALAR_FIELDS = [
  ['incident_type', 'Type of incident'],
  ['incident_datetime', 'Date & time of incident'],
  ['location', 'Place of incident'],
  ['reporter_name', 'Reporting party name'],
  ['reporter_contact', 'Contact number'],
  ['reporter_address', 'Home address'],
  ['action_taken', 'Action taken / status'],
];

// A party's role (the read's own vocabulary — see GeminiNarrativeProvider::
// PARTY_ROLES) mapped to the group the form records it in. The group keys ARE
// the roles, which is why four of these land in one group: a victim, a
// complainant, an owner and a driver are all the "complainant" side of the
// report, and that is what every type's own GROUP_CONFIG calls it.
//
// 'other' maps to nothing on purpose: the read names people by the role the
// account gives them, and a person whose role the account does not state has
// no row to be listed in. The account's own words still reach the narrative.
const ROLE_GROUP = {
  victim: 'complainant',
  complainant: 'complainant',
  owner: 'complainant',
  driver: 'complainant',
  suspect: 'respondent',
  respondent: 'respondent',
  witness: 'witness',
};

// A datetime and nothing else: the provider drops a bare date, a bare time or a
// sentence before this ever sees it (normaliseClassification), and the form's
// own field holds exactly this shape.
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The change the account read may make to this draft.
 *
 * @param {object} answer  the `fields` half of the classify response
 * @param {object} draft   the form's draft
 * @param {string[]} types the incident types the FORM offers (its dropdown)
 * @returns {{
 *   patch: object,          // form fields to set — empty ones only
 *   groups: object,         // groupKey → rows to add, for groups that are empty
 *   filled: string[],       // the labels of everything above, form order
 *   unstated: string[],     // the read's "your account does not say this" list
 *   type: string,           // the type the draft will carry after the patch
 *   category: string,       // the read's own words for the incident, '' when none
 * }}
 */
export function buildClassifyFill(answer, draft, types = []) {
  const f = answer && typeof answer === 'object' ? answer : {};
  const d = draft && typeof draft === 'object' ? draft : {};
  const patch = {};
  const filled = [];
  const empty = (key) => str(d[key]) === '';

  // The type first: it decides which groups exist, so everything below reads
  // the type the draft will HAVE, not the one it has. A read that names the
  // incident in the blotter's legal words is folded to the closest type on the
  // form's list (classifyClosestType — the server folds the same answer the
  // same way), and the read's own words are kept as the Category.
  const answeredType = str(f.incident_type);
  let category = '';
  if (empty('incident_type') && answeredType !== '') {
    if (types.includes(answeredType)) {
      patch.incident_type = answeredType;
      filled.push('Type of incident');
      // An "Other" answer is the read saying the account is too thin — but
      // a blotter charges in legal words the list never carries
      // ("RECKLESS IMPRUDENCE ..."), so the read lands on Other for a
      // traffic account it described. When the read's own title words fold
      // to a concrete type, the folder follows the sheet, not the shrug:
      // the title still rides as the Category below, so no words change.
      if (/^other(\s|$)/i.test(answeredType)) {
        const fromTitle = classifyClosestType(str(f.incident_category), types);
        if (fromTitle !== null && !/^other(\s|$)/i.test(fromTitle)) {
          patch.incident_type = fromTitle;
        }
      }
    } else {
      const closest = classifyClosestType(answeredType, types);
      if (closest !== null) {
        patch.incident_type = closest;
        filled.push('Type of incident');
        category = answeredType;
      }
    }
  }
  // The model sometimes names the crime only in its own words
  // (incident_category) while leaving incident_type blank — and a blank type
  // is what strands the save behind this read (no report is created without
  // one), stranding the Improve-writing press on a refusal. When those words
  // fold decisively to a concrete type on the list, the read takes it; an
  // undecided fold stays blank rather than guessing, and the read's own words
  // still ride as the Category below.
  if (empty('incident_type') && patch.incident_type === undefined) {
    const fromCategory = classifyClosestType(str(f.incident_category), types);
    if (fromCategory !== null && !/^other(\s|$)/i.test(fromCategory)) {
      patch.incident_type = fromCategory;
      filled.push('Type of incident');
    }
  }
  // The server carries the answer's words separately when IT did the folding —
  // same line, no second source of truth. And the officer's own words stand:
  // a Category already on the draft is never overwritten by the read.
  if (category === '') category = str(f.incident_category);
  if (category !== '' && str(d.type_specific?.incident_category) !== '') category = '';
  const type = patch.incident_type ?? str(d.incident_type);

  // The date and the time are ONE stored field (`YYYY-MM-DDTHH:MM`), and the
  // form can hold a half of it — a date typed with no time is stored as the
  // bare date (see setIncidentDate). A half-filled field therefore counts as
  // FILLED and is left exactly as the officer left it: completing it would be
  // this module writing a time the officer may have deliberately omitted, which
  // is the one thing rule 1 is here to prevent. The receipt says what was
  // filled, so an officer who wants the time from the account can read it off
  // the page and type it.
  const datetime = str(f.incident_datetime);
  if (empty('incident_datetime') && DATETIME.test(datetime)) {
    patch.incident_datetime = datetime;
    filled.push('Date & time of incident');
    // Only ever set TRUE. A false answer means "the account did not hedge",
    // which is what an untouched checkbox already says — writing false over it
    // would be a change the read had no business making.
    if (f.incident_time_approximate === true) patch.incident_time_approximate = true;
  }

  for (const [key, label] of SCALAR_FIELDS) {
    if (key === 'incident_type' || key === 'incident_datetime') continue;
    const value = str(f[key]);
    if (value === '' || !empty(key)) continue;
    patch[key] = value;
    filled.push(label);
  }

  // PLACE SPELLING — CITY OF NAGA GAZETTEER (owner request): the AI copies
  // the place as written (OCR and hand-typed barangays drift: INOBUKAN for
  // Inoburan, MAIN IT for Mainit), and the app maps near-miss spellings to
  // the closest of the station's 28 barangays — scope City of Naga, Cebu,
  // the same names Google Maps carries (see nagaPlaces.js). Exact and
  // recognised variants are untouched; sitios, puroks and genuine unknowns
  // are kept as written. The correction rides the patch like any fill, and
  // the FROM → TO pairs are receipted below so the officer sees what moved.
  let locationCorrection = [];
  if (patch.location) {
    const fixed = correctNagaLocation(patch.location);
    if (fixed.text !== patch.location) {
      locationCorrection = fixed.changes;
      patch.location = fixed.text;
    }
  }

  // The named people, into the groups this type actually has.
  const groups = {};
  const seen = {};
  for (const party of Array.isArray(f.parties) ? f.parties : []) {
    const groupKey = ROLE_GROUP[str(party?.role).toLowerCase()];
    const name = str(party?.name);
    if (!groupKey || name === '') continue;
    const cfg = GROUP_CONFIG[type]?.[groupKey];
    if (!cfg) continue; // this type has no such group — no row to add
    if (hasGroupRows(d.type_specific, groupKey)) continue; // the officer's own rows stand
    seen[groupKey] = seen[groupKey] ?? new Set();
    if (seen[groupKey].has(name.toLowerCase())) continue;
    seen[groupKey].add(name.toLowerCase());
    groups[groupKey] = groups[groupKey] ?? [];
    // `name` is the first field of every person schema in every group this
    // module can reach (PERSON_ITEM_FIELDS and the three built on it), which is
    // the whole reason a role can be mapped to a group without also mapping it
    // to a field.
    groups[groupKey].push({ name });
  }
  for (const groupKey of Object.keys(groups)) {
    filled.push(GROUP_CONFIG[type]?.[groupKey]?.label ?? groupKey);
  }

  return {
    patch,
    groups,
    filled,
    unstated: (Array.isArray(f.unstated) ? f.unstated : [])
      .map((line) => str(line))
      .filter((line) => line !== ''),
    type,
    category,
    locationCorrection,
  };
}

// ---------------------------------------------------------------------------
// The second half of the read: the TYPE'S OWN fields (POST /ai/classify/details)
//
// The first read establishes what KIND of incident this is; only then do that
// kind's own fields exist — the vehicles and their plates, the items taken, the
// injuries, the entry point. This is the same three rules, applied one level
// down, with one addition that only group rows need:
//
//   * ROWS MERGE BY WHAT IDENTIFIES THEM. A person is matched by name, a
//     vehicle by its plate, an item by its description; the fields the row
//     already carries are never overwritten and the empty ones are filled. A
//     row that matches nothing is added (a second witness), and a row with no
//     identifier at all is only merged when the group holds exactly ONE row —
//     guessing which of two vehicles a description belongs to would be
//     inventing a fact.

// The keys a row can be identified by, best first. Taken from the group's own
// schema rather than a per-group table, so a new group with a `name` gets the
// rule for free.
const ROW_IDENTIFIERS = ['name', 'plate_number', 'item_description'];

/** The identifier key for a group's rows, or null when it has none. */
function identifierFor(itemSchema) {
  for (const key of ROW_IDENTIFIERS) {
    if (itemSchema.some((f) => f.key === key)) return key;
  }
  return null;
}

/**
 * One option of a select is what the form can carry: a value the officer could
 * not have picked themselves (however well the model read the account) would
 * land in the record as a string no dropdown shows. Comparison is
 * case-insensitive so an answer the model capitalised differently still lands,
 * and what is written is the OPTION's own spelling.
 */
function coerce(fld, value) {
  if (!fld.select) return value;
  const option = fld.select.find((o) => o.toLowerCase() === value.toLowerCase());
  return option ?? '';
}

// Incident location keys conclusively corrected: misspelled barangays file
// corrected, everything else exactly as read — source words only.
const INCIDENT_LOCATION_KEYS = new Set([
  'location_last_seen',
  'incident_location',
  'location_found',
  'fire_location',
  'possible_location',
  'destination_if_known',
]);

/** One group row, reduced to the fields the group's schema knows. */
function cleanRow(incoming, itemSchema) {
  const row = {};
  for (const fld of itemSchema) {
    let value = coerce(fld, str(incoming?.[fld.key]));
    if (value === '') continue;
    // Conclusive address: group resident addresses print corrected too.
    if (fld.key === 'address') value = correctNagaLocation(value).text;
    row[fld.key] = value;
  }
  return row;
}

/**
 * The change the TYPE-SCOPED read may make to this draft.
 *
 * @param {object} answer the `type details` response — { fields, groups, unstated }
 * @param {object} draft  the form's draft (the type is read from it)
 * @returns {{patch:object, groups:object, filled:string[], unstated:string[]}}
 *   `patch` is type_specific scalars to write, `groups` is groupKey → the
 *   group's COMPLETE row list after the merge (so the caller assigns it).
 */
export function buildTypeDetailsFill(answer, draft) {
  const a = answer && typeof answer === 'object' ? answer : {};
  const d = draft && typeof draft === 'object' ? draft : {};
  const type = str(d.incident_type);
  const ts = { ...(d.type_specific ?? {}) };
  const patch = {};
  const groups = {};
  const filled = [];
  const empty = (key) => str(ts[key]) === '';

  // No type, no type-specific fields: this read has nothing to be scoped to.
  if (type === '') return { patch, groups, filled, unstated: [] };

  const answerFields = a.fields && typeof a.fields === 'object' ? a.fields : {};
  for (const fld of TYPE_FIELDS[type] ?? []) {
    // Mirrored scalars belong to their group's row and are DERIVED from it
    // (see syncMirrors) — writing one here would put a value in the form that
    // the row it mirrors does not hold.
    if (fld.mirrorOf) continue;
    if (!empty(fld.key)) continue;
    const value = coerce(fld, str(answerFields[fld.key]));
    if (value === '') continue;
    if (fld.showIf) {
      // The controller may be a field this same answer just filled, so the
      // patch is consulted first — otherwise a value and the field that
      // reveals it could arrive together and the second one be dropped.
      const controller = patch[fld.showIf.key] ?? ts[fld.showIf.key] ?? '';
      if (!fld.showIf.values.includes(controller)) continue;
    }
    // Conclusive incident location: misspelled barangays file corrected.
    const finalValue = INCIDENT_LOCATION_KEYS.has(fld.key) ? correctNagaLocation(value).text : value;
    patch[fld.key] = finalValue;
    ts[fld.key] = finalValue; // visible to the next field's showIf
    filled.push(fld.label);
  }

  const answerGroups = a.groups && typeof a.groups === 'object' ? a.groups : {};
  for (const [groupKey, cfg] of Object.entries(GROUP_CONFIG[type] ?? {})) {
    const incomingRows = Array.isArray(answerGroups[groupKey]) ? answerGroups[groupKey] : [];
    if (incomingRows.length === 0) continue;
    const identifier = identifierFor(cfg.itemSchema);
    const rows = meaningfulRows(ts[groupKey]).map((r) => ({ ...r }));
    let changed = false;
    for (const incoming of incomingRows) {
      const row = cleanRow(incoming, cfg.itemSchema);
      if (Object.keys(row).length === 0) continue;
      const identity = identifier ? str(row[identifier]) : '';
      let match = identity !== ''
        ? rows.find((r) => str(r[identifier]).toLowerCase() === identity.toLowerCase())
        : null;
      // A row can only be merged when there is no ambiguity about WHICH row it
      // belongs to: one candidate, and either the read has nothing to identify
      // it by or the officer's row is itself missing that very field (which is
      // a blank to fill, not a claim to contradict).
      if (!match && rows.length === 1 && (identity === '' || str(rows[0][identifier]) === '')) {
        match = rows[0];
      }
      if (!match) {
        // Nothing identifies this row and there is more than one candidate —
        // attaching it to either would be inventing which vehicle a dent is on.
        if (identity === '' && rows.length > 0) continue;
        rows.push(row);
        changed = true;
        continue;
      }
      for (const [key, value] of Object.entries(row)) {
        // The identifier is filled like any other field — the match above
        // proved this is the same row, and a missing plate on it is a blank,
        // not a claim. A value that is already there is never overwritten.
        if (str(match[key]) !== '') continue; // the officer's own answer stands
        match[key] = value;
        changed = true;
      }
    }
    if (changed) {
      // The row's own visibility decides what it keeps: a name the read heard
      // for a person the officer recorded as unidentified is not that row's to
      // hold (see rowFieldVisible, and the suspect schema it serves).
      groups[groupKey] = rows.map((r) => applyRowVisibility(r, cfg.itemSchema));
      filled.push(cfg.label);
    }
  }

  return {
    patch,
    groups,
    filled,
    unstated: (Array.isArray(a.unstated) ? a.unstated : [])
      .map((line) => str(line))
      .filter((line) => line !== ''),
  };
}

/** True when the read has nothing to change — the receipt line says so. */
export function classifyFillIsEmpty(fill) {
  return Object.keys(fill?.patch ?? {}).length === 0
    && Object.keys(fill?.groups ?? {}).length === 0
    && str(fill?.category ?? '') === '';
}
