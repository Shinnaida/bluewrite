// BlueWrite — the pure half of the printed sheet.
//
// These helpers were private to ReportPrint.jsx. They are extracted here so the
// EDITOR can render the SAME sheet inline (Task 4) without a second
// implementation of the facts. One builder, two surfaces: the print portal and
// the inline bondpaper-reveal in Write Report.
//
// Everything here is pure — no React, no fetch — so it runs under node:test and
// in both callers.

import { suspectLine } from './suspectLine.js';

// “August 06, 2026” — the format the PNP template uses for dates.
const LONG_DATE = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

// Incident date/time as “Around 1:00 A.M., July 29, 2026” — the template
// keeps the reported time informal (“Around H:MM A.M./P.M., Month DD, YYYY”).
export function fmtIncidentLong(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).replace('T', ' ');
  let h = d.getHours();
  const suffix = h >= 12 ? 'P.M.' : 'A.M.';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min} ${suffix}, ${LONG_DATE.format(d)}`;
}

export function fmtLong(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : LONG_DATE.format(d);
}

const N = (v) => String(v ?? '').trim();
const has = (v) => N(v) !== '';
const join = (...parts) => parts.map(N).filter(Boolean).join(', ');

// Person-bearing group keys — the same roles MaskingGateway::PERSON_GROUPS
// knows. Kept here as a flat list because the sheet only needs to READ a name
// for casing, never to mask it.
const PERSON_GROUP_KEYS = [
  'complainant', 'complainants', 'respondent', 'respondents',
  'witness', 'witnesses', 'missing_person', 'missing_persons',
  'person_last_seen_with', 'injured_persons', 'arrested_persons',
];

/**
 * Task 2 — the report's OWN proper nouns, for the sheet's sentence-case pass.
 * Person names are proper nouns whole; from the place we take only the words
 * the officer already capitalized (so a lower-cased "market" in the location
 * does not make every "market" on the sheet a place name). The caster then
 * corrects a lower-cased value against this list and guesses nothing else.
 *
 * @returns {string[]}
 */
export function properNounsFor(report = {}, ts = {}) {
  const names = [];
  for (const key of PERSON_GROUP_KEYS) {
    const rows = Array.isArray(ts[key]) ? ts[key] : [];
    for (const row of rows) {
      if (row && has(row.name)) names.push(N(row.name));
    }
  }
  if (has(report.complainant)) names.push(N(report.complainant));
  if (has(report.respondent)) names.push(N(report.respondent));
  const location = has(report.location) ? N(report.location) : '';
  for (const word of location.split(/[^A-Za-z]+/)) {
    if (word.length >= 3 && /^[A-Z]/.test(word)) names.push(word);
  }
  return names;
}

// “P8,500.00” if the stored value is a bare number; leave typed text alone.
function fmtValue(v) {
  const s = N(v);
  if (s === '') return '';
  return /^[₱P]?[\d,]+(\.\d+)?$/.test(s) ? `P${s.replace(/^[₱P]/, '')}` : s;
}

function toNumber(v) {
  const n = Number(N(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Item amounts print bare ("- 284,370.00"), matching the scanned sheet.
function fmtItemValue(v) {
  return N(v).replace(/^[₱P]\s*/, '');
}

// A person line for party facts: “Ana Lopez, 34, Female”.
function personLine(p) {
  if (!p) return '';
  return join(p.name, p.age, p.sex);
}

// A vehicle line per the template: “Plate No., Make/Model, Driver's Name”.
function vehicleLine(v) {
  if (!v) return '';
  return join(v.plate_number, v.make_model, v.driver_name);
}

// Time “H:MM A.M./P.M.” from a date-ish or raw time string. A bare "HH:MM"
// (what a <input type="time"> stores) is formatted directly — `new Date()`
// cannot parse it, and the sheet printed the raw "09:00" before this.
function fmtTimeOnly(v) {
  if (!v) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(N(v));
  if (m) {
    let h = Number(m[1]);
    const suffix = h >= 12 ? 'P.M.' : 'A.M.';
    h = h % 12 || 12;
    return `${h}:${m[2]} ${suffix}`;
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) {
    let h = d.getHours();
    const suffix = h >= 12 ? 'P.M.' : 'A.M.';
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
  }
  return N(v);
}

/**
 * Per-type fact builders — one per incident type, each reproducing that
 * type's template line set from Police_Report_Templates_All_Types.docx,
 * filled ONLY with recorded data. Where the template itself sanctions a
 * default ("or None", "or N/A"), the default is used when the field is
 * blank; otherwise a line with no recorded data is omitted entirely —
 * never fabricated.
 *
 * Entry shapes:
 *   { label, values: [..] }   → first value on the label line, rest as
 *                               continuation lines beneath it
 *   { label, items: [..], total } → numbered Stolen/Items block + TOTAL
 *
 * `ctx.suspectLines` is the AI draft's own sheet sentences for unidentified
 * suspects — `[{ row, line }]`, row being the index in `ts.respondent` (Task 9's
 * pending proposal). While a draft is under review the Suspect line reads the
 * model's formalised sentence in place of the record's composed one; the report
 * itself is never written from them (preview only). Absent → the record's own
 * line everywhere, exactly as before.
 */
export function buildTypeFacts(type, ctx) {
  const { report, ts } = ctx;
  const formalSuspects = new Map();
  for (const entry of Array.isArray(ctx.suspectLines) ? ctx.suspectLines : []) {
    const row = Number(entry?.row);
    const line = N(entry?.line);
    if (Number.isInteger(row) && row >= 0 && line !== '') formalSuspects.set(row, line);
  }

  // Party values: group arrays first (multi-person capable), legacy
  // singular columns as fallback.
  const people = (key, fallback) => {
    const arr = Array.isArray(ts[key]) ? ts[key].map(personLine).filter(Boolean) : [];
    if (arr.length > 0) return arr;
    return has(fallback) ? [N(fallback)] : [];
  };
  const victims = () => people('complainant', report.complainant);
  // Suspects are NOT read with the generic person line. A row that names nobody
  // is the ordinary case for an unidentified suspect, and `name, age, sex` would
  // print it as ", 30, Male" — or drop it entirely, which is a blank where the
  // sheet owes a description. suspectLine() states the person instead
  // ("One unidentified male, about 30, dark jacket").
  //
  // While an AI draft is under review, a row the model wrote a sentence for
  // reads THAT sentence (the panel's pending proposal) — the same replacement
  // the sheet itself makes for the narrative and the two formalised blocks. The
  // override is per ROW, so a second suspect the model did not describe keeps
  // the record's own line.
  const suspects = () => {
    const rows = Array.isArray(ts.respondent) ? ts.respondent : [];
    const lines = rows
      .map((row, i) => formalSuspects.get(i) ?? suspectLine(row))
      .filter(Boolean);
    if (lines.length > 0) return lines;
    // A report filed before the groups existed keeps its single legacy string.
    return has(report.respondent) ? [N(report.respondent)] : [];
  };

  // Numbered items block. The Stolen Items GROUP is the record, so every row
  // is numbered — a report that saw two items taken prints two, not the first
  // one plus a total that implies the rest. Rows with no value are summed
  // around and simply suppress the TOTAL line: a partial figure printed as a
  // total is a worse lie than no figure at all (same rule as the group's own
  // stolenItemsTotal). The legacy description/value pairs remain the fallback
  // for a report filed before the group existed, where the scalar is all there
  // is.
  const itemsBlock = (label, pairs, groupKey = 'stolen_items') => {
    const rows = Array.isArray(ts[groupKey])
      ? ts[groupKey]
          .map((row) => ({
            desc: join(
              N(row.item_description),
              has(row.quantity)
                ? `qty. ${N(row.quantity)}${has(row.unit) ? ` ${N(row.unit)}` : ''}`
                : '',
            ),
            value: fmtValue(row.estimated_value),
          }))
          .filter((it) => it.desc !== '')
      : [];
    const items = rows.length > 0
      ? rows
      : pairs
          .map(([desc, value]) => ({ desc: N(desc), value: fmtValue(value) }))
          .filter((it) => it.desc !== '');
    if (items.length === 0) return null;
    const nums = items.map((it) => toNumber(it.value));
    const total = nums.every((n) => n !== null)
      ? nums.reduce((a, b) => a + b, 0)
      : null;
    return { label, items, total };
  };

  const place = () => ({ label: 'Place', values: [has(report.location) ? report.location : '—'] });
  const when = () => ({
    label: 'Date & Time of Incident',
    values: [`Around ${fmtIncidentLong(report.incident_datetime)}`],
  });
  // Task 7 — the scanned sheet's "Date of Discovery" line, when the officer
  // recorded one (it is distinct from the incident date). Formatted like every
  // other date on the sheet; a non-date value is printed as recorded.
  const discovery = () =>
    has(ts.date_of_discovery)
      ? { label: 'Date of Discovery', values: [fmtLong(ts.date_of_discovery)] }
      : null;

  switch (type) {
    case 'Theft':
      return [
        place(),
        when(),
        discovery(),
        { label: 'Victim', values: victims() },
        { label: 'Suspect', values: suspects() },
        itemsBlock('Stolen Items', [
          [ts.item_stolen || ts.item_description, ts.estimated_value],
        ]),
      ].filter(Boolean);

    case 'Robbery':
      return [
        place(),
        when(),
        { label: 'Victim', values: victims() },
        { label: 'Suspect(s)', values: suspects() },
        {
          label: 'Weapon/Force Used',
          values: [N(ts.weapon_description) || N(ts.method_used)].filter(Boolean),
        },
        itemsBlock('Items Taken', [
          [ts.property_taken || ts.property_description, ts.estimated_value],
        ]),
      ].filter(Boolean);

    case 'Assault / Physical Injury':
      return [
        place(),
        when(),
        { label: 'Victim', values: victims() },
        { label: 'Suspect', values: suspects() },
        { label: 'Weapon Used (if any)', values: [N(ts.weapon_used) || 'None / bare hands'] },
        { label: 'Injuries Sustained', values: [join(ts.type_of_injury, ts.body_part_injury ?? ts.body_part_injured) || 'None recorded'] },
        {
          label: 'Medical Treatment',
          values: [join(ts.medical_treatment, ts.medical_facility) || 'None recorded'],
        },
      ].filter(Boolean);

    case 'Traffic Accident': {
      const vehicles = Array.isArray(ts.vehicles)
        ? ts.vehicles.map(vehicleLine).filter(Boolean)
        : [];
      const injured = Array.isArray(ts.injured_persons)
        ? ts.injured_persons
            .map((p) => join(p.name, p.injury_status))
            .filter(Boolean)
        : [N(ts.injured_persons)].filter(Boolean);
      if (has(ts.fatalities)) injured.push(`Fatalities: ${N(ts.fatalities)}`);
      const vehicleEntries = vehicles.map((line, i) => ({
        label: `Vehicle ${i + 1}`,
        values: [line],
        cont: i > 0,
      }));
      return [
        place(),
        when(),
        ...vehicleEntries,
        { label: 'Injuries', values: injured.length > 0 ? injured : ['None'] },
      ];
    }

    case 'Rape / Sexual Assault':
      return [
        place(),
        when(),
        { label: 'Victim', values: victims() },
        { label: 'Suspect', values: suspects() },
        has(ts.medical_examination) || has(ts.medical_facility)
          ? { label: 'Medico-Legal Examination', values: [join(ts.medical_examination, ts.medical_facility)] }
          : null,
      ].filter(Boolean);

    case 'Domestic Violence':
      return [
        place(),
        when(),
        { label: 'Complainant', values: victims() },
        { label: 'Respondent', values: suspects() },
        has(ts.relationship_between_parties)
          ? { label: 'Relationship', values: [N(ts.relationship_between_parties)] }
          : null,
        { label: 'Nature of Incident', values: [N(ts.type_of_abuse) || N(ts.threats_made) || '—'] },
        { label: 'Injuries (if any)', values: [N(ts.physical_injury) || 'None'] },
      ].filter(Boolean);

    case 'Missing Person': {
      const mp = Array.isArray(ts.missing_person) ? ts.missing_person[0] : null;
      const lastSeen = join(
        ts.location_last_seen ?? mp?.location_last_seen,
        join(ts.date_last_seen, ts.time_last_seen)
          // The stored value is ISO (2026-09-23); the sheet prints the
          // template's long form (September 23, 2026), like every other date.
          ? `${fmtLong(ts.date_last_seen)} ${fmtTimeOnly(ts.time_last_seen)}`.trim()
          : '',
      );
      return [
        {
          label: 'Name of Missing Person',
          values: [personLine(mp) || join(ts.missing_person_name, ts.age, ts.sex) || '—'],
        },
        { label: 'Last Seen', values: [lastSeen || `Around ${fmtIncidentLong(report.incident_datetime)}, ${report.location || '—'}`] },
        { label: 'Reporting Person', values: victims().length > 0 ? victims() : ['—'] },
        { label: 'Circumstances', values: [N(mp?.circumstances) || '—'] },
        { label: 'Distinguishing Marks/Clothing', values: [join(mp?.clothing_last_seen, mp?.physical_description) || join(ts.clothing_last_seen, ts.physical_description) || '—'] },
      ];
    }

    case 'Lost Property':
      return [
        { label: 'Owner', values: victims() },
        {
          label: 'Item(s) Lost',
          values: [join(ts.property_type, ts.property_description, has(ts.quantity) ? `qty. ${N(ts.quantity)}` : '') || '—'],
        },
        has(ts.estimated_value) ? { label: 'Estimated Value', values: [fmtValue(ts.estimated_value)] } : null,
        {
          label: 'Place & Date Lost',
          values: [
            join(ts.location_last_seen, join(ts.date_last_seen, ts.time_last_seen)
              ? `${fmtLong(ts.date_last_seen)} ${fmtTimeOnly(ts.time_last_seen)}`.trim()
              : '') || `Around ${fmtIncidentLong(report.incident_datetime)}, ${report.location || '—'}`,
          ],
        },
        { label: 'Circumstances', values: [N(ts.circumstances_of_loss) || '—'] },
      ].filter(Boolean);

    case 'Fraud / Estafa':
      return [
        { label: 'Complainant', values: victims() },
        { label: 'Suspect', values: suspects() },
        has(ts.amount_involved) ? { label: 'Amount Involved', values: [fmtValue(ts.amount_involved)] } : null,
        { label: 'Mode/Scheme Used', values: [join(ts.transaction_method, ts.transaction_type, ts.promised_service_or_item) || '—'] },
        has(ts.transaction_date) ? { label: 'Date(s) of Transaction', values: [fmtLong(ts.transaction_date)] } : null,
      ].filter(Boolean);

    case 'Property Damage / Malicious Mischief':
      return [
        place(),
        when(),
        { label: 'Owner', values: victims() },
        { label: 'Property/Item Damaged', values: [join(ts.damaged_property, ts.property_description) || '—'] },
        { label: 'Description of Damage', values: [join(ts.type_of_damage, ts.cause_of_damage) || '—'] },
        has(ts.estimated_damage_cost) ? { label: 'Estimated Cost', values: [fmtValue(ts.estimated_damage_cost)] } : null,
      ].filter(Boolean);

    case 'Fire Incident':
      return [
        place(),
        when(),
        { label: 'Owner/Occupant', values: victims() },
        { label: 'Suspected Origin', values: [N(ts.fire_location) || N(ts.type_of_property) || '—'] },
        { label: 'Suspected Cause', values: [N(ts.possible_cause) || 'Undetermined'] },
        has(ts.estimated_property_loss) || has(ts.extent_of_damage)
          ? { label: 'Estimated Damage', values: [join(fmtValue(ts.estimated_property_loss), ts.extent_of_damage)] }
          : null,
        {
          label: 'Casualties',
          values: [join(ts.injuries, ts.fatalities) || 'None'],
        },
      ].filter(Boolean);

    case 'Drug-Related Incident': {
      const arrested = Array.isArray(ts.arrested_persons)
        ? ts.arrested_persons.map(personLine).filter(Boolean)
        : [];
      const suspectLines = [...suspects(), ...arrested];
      return [
        place(),
        when(),
        { label: 'Suspect(s)', values: suspectLines.length > 0 ? suspectLines : ['—'] },
        { label: 'Operation Type', values: [join(ts.operation_type, ts.incident_classification) || '—'] },
        { label: 'Items/Substance Seized', values: [join(ts.items_seized, ts.packaging_description, ts.evidence_found) || '—'] },
        has(ts.quantity) ? { label: 'Quantity', values: [N(ts.quantity)] } : null,
      ].filter(Boolean);
    }

    case 'Burglary / Break-In':
      return [
        place(),
        when(),
        discovery(),
        { label: 'Victim', values: victims() },
        { label: 'Suspect', values: suspects() },
        {
          label: 'Point of Entry',
          values: [join(ts.entry_point, has(ts.signs_of_forced_entry) ? `signs of forced entry: ${N(ts.signs_of_forced_entry)}` : '') || '—'],
        },
        itemsBlock('Items Taken', [
          [ts.property_stolen || ts.property_description, ts.estimated_value],
        ]),
      ].filter(Boolean);

    case 'Other Incident':
      return [
        place(),
        when(),
        { label: 'Complainant/Victim', values: victims() },
        { label: 'Suspect (if any)', values: suspects().length > 0 ? suspects() : ['N/A'] },
        { label: 'Nature of Incident', values: [join(ts.incident_category, ts.persons_involved) || '—'] },
        { label: 'Items/Damage Involved', values: [join(ts.property_involved, ts.injuries_or_damage) || 'None'] },
      ];

    default:
      // Unknown/custom type: the common core only.
      return [
        place(),
        when(),
        { label: 'Victim', values: victims() },
        { label: 'Suspect', values: suspects() },
      ];
  }
}

// NOTABLE FINDINGS — the officer's own free-text observations come FIRST
// (one printed line per typed line), then genuinely recorded evidence-type
// observations from the structured fields.
export function buildFindings(ts) {
  const findings = [];
  const officerLines = String(ts.notable_findings || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  findings.push(...officerLines);
  if (ts.cctv_available === 'Yes') {
    findings.push(`CCTV footage is available${has(ts.cctv_description) ? ` — ${N(ts.cctv_description)}` : ''}.`);
  } else if (ts.cctv_available === 'No') {
    findings.push('No CCTV footage covers the area of the incident.');
  }
  if (ts.weapon_involved === 'Yes') {
    findings.push(`A weapon was involved${has(ts.weapon_description) ? ` — ${N(ts.weapon_description)}` : ''}.`);
  }
  if (has(ts.medical_certificate_available)) {
    findings.push(`Medical certificate: ${N(ts.medical_certificate_available)}.`);
  }
  if (has(ts.signs_of_forced_entry)) {
    findings.push(`Signs of forced entry: ${N(ts.signs_of_forced_entry)}.`);
  }
  if (has(ts.tools_used)) {
    findings.push(`Tools used at entry: ${N(ts.tools_used)}.`);
  }
  if (has(ts.recent_photo_available)) {
    findings.push(`Recent photo of the missing person available: ${N(ts.recent_photo_available)}.`);
  }
  if (has(ts.photographs_available)) {
    findings.push(`Photographs of the damage available: ${N(ts.photographs_available)}.`);
  }
  return findings;
}

// ACTION TAKEN / STATUS — the RECORDED states only. The station's own fixed
// lines (on-file note, finalization note, routing line) and the rule that the
// routing line prints only when the disposition does not already state an
// onward action live in src/lib/printActions.js, which is unit-tested.
export function buildStructuredActions(ts) {
  const actions = [];
  if (has(ts.suspect_status)) actions.push(`Suspect status: ${N(ts.suspect_status)}.`);
  if (has(ts.recovery_status)) actions.push(`Recovery status: ${N(ts.recovery_status)}.`);
  if (has(ts.recovered_property)) actions.push(`Recovered property: ${N(ts.recovered_property)}.`);
  if (has(ts.medical_examination)) actions.push(`Medico-legal examination: ${N(ts.medical_examination)}${has(ts.medical_facility) ? `, ${N(ts.medical_facility)}` : ''}.`);
  if (has(ts.protection_order_information)) actions.push(`Protection order: ${N(ts.protection_order_information)}.`);
  if (has(ts.search_actions_taken)) actions.push(`Search actions taken: ${N(ts.search_actions_taken)}.`);
  if (has(ts.fire_department_response)) actions.push(`Fire department response: ${N(ts.fire_department_response)}.`);
  return actions;
}
