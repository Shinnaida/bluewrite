import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { normalizeLegacyTypeSpecific } from '../lib/normalizeLegacy.js';
import { buildActionBlock } from '../lib/printActions.js';
// The letterhead's fixed lines: the station's own where it has configured them,
// the built-in defaults where it has not.
import { resolveHeader } from '../lib/stationSettings.js';
// Phase 6 Stage 1 (D6) — the "not translated" line, or null for an English
// narrative. Same module the editor reads, so the sheet and the form cannot
// disagree about what a stored code means.
import { printLanguageLine } from '../lib/reportLanguages.js';
// Station seals: bundled by Vite (src/assets) so they survive the offline
// build — the sheet must print with the logos even without network access.
import pnpLogo from '../assets/pnp-logo.png';
import citySeal from '../assets/city-of-naga-seal.png';

// “August 06, 2026” — the format the PNP template uses for dates.
const LONG_DATE = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

// Incident date/time as “Around 1:00 A.M., July 29, 2026” — the template
// keeps the reported time informal (“Around H:MM A.M./P.M., Month DD, YYYY”).
function fmtIncidentLong(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).replace('T', ' ');
  let h = d.getHours();
  const suffix = h >= 12 ? 'P.M.' : 'A.M.';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min} ${suffix}, ${LONG_DATE.format(d)}`;
}

function fmtLong(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : LONG_DATE.format(d);
}

const N = (v) => String(v ?? '').trim();
const has = (v) => N(v) !== '';
const join = (...parts) => parts.map(N).filter(Boolean).join(', ');

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

// Time “H:MM A.M./P.M.” from a date-ish or raw time string.
function fmtTimeOnly(v) {
  if (!v) return '';
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
 * default (“or None”, “or N/A”), the default is used when the field is
 * blank; otherwise a line with no recorded data is omitted entirely —
 * never fabricated.
 *
 * Entry shapes:
 *   { label, values: [..] }   → first value on the label line, rest as
 *                               continuation lines beneath it
 *   { label, items: [..], total } → numbered Stolen/Items block + TOTAL
 */
function buildTypeFacts(type, ctx) {
  const { report, ts } = ctx;

  // Party values: group arrays first (multi-person capable), legacy
  // singular columns as fallback.
  const people = (key, fallback) => {
    const arr = Array.isArray(ts[key]) ? ts[key].map(personLine).filter(Boolean) : [];
    if (arr.length > 0) return arr;
    return has(fallback) ? [N(fallback)] : [];
  };
  const victims = () => people('complainant', report.complainant);
  const suspects = () => people('respondent', report.respondent);

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
  const discovery = () =>
    has(ts.date_of_discovery) ? { label: 'Date of Discovery', values: [N(ts.date_of_discovery)] } : null;

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
      ];

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
          ? `${N(ts.date_last_seen)} ${fmtTimeOnly(ts.time_last_seen)}`.trim()
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
              ? `${N(ts.date_last_seen)} ${fmtTimeOnly(ts.time_last_seen)}`.trim()
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
function buildFindings(ts) {
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
function buildStructuredActions(ts) {
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

// The reviewing official who signs the "Noted by:" line of every printed
// station report. Fixed by the station (not per-report data), so it prints on
// drafts and finalized reports alike. The finalized-by officer is still named
// in the ACTION TAKEN / STATUS block.
const NOTED_BY_NAME = 'DEXTER MALEZA CALACAR';

/**
 * Phase 2 (UC-015/016) — print-ready report matching the station's official
 * per-type POLICE REPORT templates (Police_Report_Templates_All_Types.docx):
 * centered org header (with provincial office + station lines) ·
 * NCPS–INVEST + date row · POLICE REPORT title · certification paragraph ·
 * quoted incident type · per-type bold-labeled facts (incl. numbered
 * Stolen/Items blocks with TOTAL) · FACTS OF THE CASE · NOTABLE FINDINGS ·
 * ACTION TAKEN / STATUS · Recorded by / IOC / Noted by.
 *
 * Every dynamic line comes from recorded system data; the sheet is
 * portaled to document.body (body.print-sheet-open) so print CSS hides
 * the whole app and the paper shows ONLY this sheet.
 */
// autoPrint: open the browser print dialog automatically after load (the
// plain "Print" button path). The finalize flow passes false — it wants the
// officer to REVIEW the sheet and confirm before any printing.
// report: optional in-memory report object — when given, the sheet renders
// THIS data directly instead of re-fetching the saved copy, so the finalize
// review shows exactly what the officer sees on the form (including unsaved
// edits) and works for a report that has never been saved (no id yet).
// footer: optional React node rendered at the bottom of the sheet INSTEAD of
// the default Print/Close row — used for the finalize confirmation bar.
// recordedBy: the officer USING the system right now ({ name, badge }). The
// "Recorded by:" line names them — that is who is accountable for the sheet
// being printed/entered here — falling back to the report's stored creator
// when the caller has no session context.
export default function ReportPrint({ reportId, onClose, autoPrint = true, footer = null, report: initialReport = null, recordedBy = null }) {
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(null);
  // The station's letterhead — the fixed lines at the head of every sheet. It
  // is deployment data (Station settings), not part of a report, which is why it
  // travels beside the report rather than inside it.
  const [stationHeader, setStationHeader] = useState(null);

  useEffect(() => {
    document.body.classList.add('print-sheet-open');
    return () => document.body.classList.remove('print-sheet-open');
  }, []);

  useEffect(() => {
    if (initialReport) return; // direct data — no fetch needed
    let alive = true;
    api(`/reports/${reportId}/print`)
      .then((data) => {
        if (!alive) return;
        setReport(data.report);
        // Sent with the report precisely so the sheet needs no second request
        // (see ReportsController::printData).
        setStationHeader(data.station ?? null);
        if (autoPrint) {
          // Give the layout a tick to paint before opening the dialog.
          setTimeout(() => window.print(), 150);
        }
      })
      .catch((err) => setError(err.message));
    return () => {
      alive = false;
    };
  }, [reportId, autoPrint, initialReport]);

  // The finalize review passes the report in memory (including unsaved edits)
  // and so skips the print endpoint — but the letterhead still has to be the
  // station's, or a sheet printed from the review would carry different lines
  // from the same sheet printed a moment later. One small read, and the
  // built-in letterhead stands if it fails.
  useEffect(() => {
    if (!initialReport) return undefined;
    let alive = true;
    api('/station')
      .then((d) => {
        if (alive) setStationHeader(d.header ?? null);
      })
      .catch(() => {
        // Best-effort: resolveHeader falls back to the built-in lines below.
      });
    return () => {
      alive = false;
    };
  }, [initialReport]);

  // type_specific (groups + per-type fields), normalized to v3 group shape.
  const ts = useMemo(() => {
    if (!report) return {};
    let raw = {};
    try {
      raw = report.type_specific
        ? (typeof report.type_specific === 'string'
            ? JSON.parse(report.type_specific)
            : report.type_specific)
        : {};
    } catch {
      raw = {};
    }
    return normalizeLegacyTypeSpecific(raw, report.incident_type, report);
  }, [report]);

  if (error || !report) {
    return createPortal(
      <div className="print-overlay">
        <div className="print-sheet">
          {error ? (
            <div className="alert error" role="alert">{error}</div>
          ) : (
            <p>Preparing print view…</p>
          )}
          <div className="print-actions">
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const finalized = report.status === 'finalized';
  // A not-yet-saved report has no id — the sheet still needs a number for the
  // certification line; the placeholder is replaced on the first save.
  // Every key present: the station's stored lines where there are any, the
  // built-in Naga defaults where the read failed or has not landed yet. A sheet
  // must never print blank where the Republic's name belongs.
  const head = resolveHeader(stationHeader);
  const reportNo = report.id ? `BW-${String(report.id).padStart(4, '0')}` : 'BW-____';
  // D6 — null unless the narrative was declared as something other than
  // English. A reader of the sheet cannot tell a Bisaya narrative from a
  // badly-written English one, so a non-English report says so; an English
  // report renders exactly the nodes it rendered before this phase.
  const languageLine = printLanguageLine(report.narrative_language);
  const facts = buildTypeFacts(report.incident_type, { report, ts });
  const findings = buildFindings(ts);
  // The officer's own Action Taken / Status text (one printed line per typed
  // line) prints FIRST, so the block reads as their words followed by the
  // standard station lines.
  // Who signs the "Recorded by:" line: the officer using the system now
  // (passed in by the caller), else the report's stored creator. Printed as
  // a plain name line ("Recorded by: PMSg Juvi Egdamin") — no badge suffix,
  // matching the station's scanned reference sheet.
  const recorderName = recordedBy?.name || report.created_by_name || '—';
  // ACTION TAKEN / STATUS: the officer's recorded disposition prints FIRST (one
  // line per typed line), then the recorded structured states, then the
  // station's note — and the routing line only when the disposition does not
  // already state an onward action. See src/lib/printActions.js.
  const actionLines = buildActionBlock({
    recordedLines: String(report.action_taken || '').split('\n'),
    structured: buildStructuredActions(ts),
    // A state the per-type fact block already prints (Medico-Legal Examination
    // on a Rape / Sexual Assault sheet) is stated once, not twice.
    perTypeLabels: facts.map((f) => f.label),
    finalizedLine:
      finalized && report.finalized_by_name
        ? `The entry was reviewed and finalized by ${report.finalized_by_name} on ${fmtLong(report.finalized_at)}.`
        : '',
  });

  // The finalize review passes a `footer` (the confirmation bar). In that
  // case the overlay becomes a column: the sheet scrolls inside
  // .print-scroll while the bar stays DOCKED at the bottom of the screen —
  // so it is always visible no matter how long the report is (a sticky bar
  // inside a long sheet could sit below the fold and look like nothing to
  // confirm). The plain Print path keeps the original tree (.print-scroll is
  // display:contents there).
  return createPortal(
    <div className={`print-overlay${footer ? ' print-overlay--review' : ''}`}>
      <div className="print-scroll">
        <div className="print-sheet">
        {/* ---- Agency header: station seal (upper LEFT, 1×1, with the
             bold Arial "NCPS-INVEST" code beneath it) + org block, RP seal
             on the right ---- */}
        <header className="pr-head">
          <div className="pr-head-left">
            <img className="pr-code-logo" src={pnpLogo} alt="PNP seal" />
          </div>
          <div className="pr-org">
            {head.agency}
            <br />
            {head.commission}
            <br />
            <strong>{head.regional_office}</strong>
            <br />
            <strong>{head.provincial_office}</strong>
            <br />
            <strong>{head.station_name}</strong>
            <br />
            {head.station_location}
          </div>
          <img
            className="pr-seal"
            src={citySeal}
            alt="City of Naga Police Station seal"
          />
        </header>

        {/* ---- Office code | Date: one row under the seals, the station's
             code at the left margin and the report date at the right —
             the two sit on the same line, as on the scanned sheet. ---- */}
        <div className="pr-code-date">
          <span className="pr-office-code">{head.office_code}</span>
          <span className="pr-date">
            {fmtLong(report.report_date || new Date())}
            <span className="pr-date-label">Date</span>
          </span>
        </div>

        <h1 className="pr-title">POLICE REPORT</h1>

        <p className="pr-salutation">To whom it may concern:</p>

        <p className="pr-certify">
          This is to certify that, according to the police{' '}
          <strong>blotter entry # {reportNo}</strong>, dated{' '}
          <strong>{fmtLong(report.incident_datetime)},</strong> appeared among
          other things the following data to wit;
        </p>

        <p className="pr-incident-type">&ldquo;{report.incident_type}&rdquo;</p>

        {/* ---- Per-type labeled facts — bold labels, plain values ---- */}
        <div className="pr-facts">
          {facts.map((entry, i) => {
            if (entry.items) {
              // Numbered Stolen/Items block with optional TOTAL.
              return (
                <div className="pr-items" key={`fact-${i}`}>
                  <div className="pr-fact">
                    <span className="pr-fact-label">{entry.label}:</span>
                  </div>
                  {entry.items.map((it, j) => (
                    <div className="pr-item" key={`item-${j}`}>
                      {j + 1}.) {it.desc}{' '}
                      {it.value ? <>- {fmtItemValue(it.value)}</> : null}
                    </div>
                  ))}
                  {entry.total !== null && (
                    <div className="pr-item-total">
                      TOTAL, - - - {entry.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              );
            }
            const values = (entry.values || []).filter(Boolean);
            if (values.length === 0) {
              return (
                <div className="pr-fact" key={`fact-${i}`}>
                  <span className="pr-fact-label">{entry.label}:</span>
                  <span className="pr-fact-value">—</span>
                </div>
              );
            }
            // One fact per entry: the value span holds every line so any
            // wrap aligns under the FIRST value character (hanging indent,
            // like "Degollacion" on the scanned sheet).
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{entry.label}:</span>
                <span className="pr-fact-value">
                  {values.map((line, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && <br />}
                      {line}
                    </React.Fragment>
                  ))}
                </span>
              </div>
            );
          })}
        </div>

        {/* ---- Narrative ---- */}
        <div className="pr-narrative">
          <strong>FACTS OF THE CASE: </strong>
          {report.narrative || '—'}
        </div>

        {/* D6 — rendered ONLY for a non-English declaration, so the sheet of an
            English report is unchanged, node for node. */}
        {languageLine && <p className="pr-language">{languageLine}</p>}

        {findings.length > 0 && (
          <div className="pr-section">
            <strong>NOTABLE FINDINGS:</strong>
            {findings.map((fnd, i) => (
              <div className="pr-entry" key={`find-${i}`}>- {fnd}</div>
            ))}
          </div>
        )}

        {/* Flush-left entries (scanned reference: the action text starts at
            the same margin as the heading, unlike the indented findings). */}
        <div className="pr-section pr-actions">
          <strong>ACTION TAKEN / STATUS:</strong>
          {actionLines.map((act, i) => (
            <div className="pr-entry" key={`act-${i}`}>{act}</div>
          ))}
        </div>

        {/* ---- Signature block: Recorded by / IOC / Noted by ---- */}
        <div className="pr-footer-block">
          <p className="pr-recorded">
            <strong>Recorded by:</strong> {recorderName}
          </p>

          {/* IOC: the name entered in the form. No signature rule — the name
              itself is the record (required before a report can finalize). */}
          <p className="pr-recorded">
            <strong>IOC:</strong> {String(report.ioc_name || '').trim() || '—'}
          </p>

          <div className="pr-noted">
            <span className="pr-noted-label">Noted by:</span>
            <span className="pr-noted-name">{NOTED_BY_NAME}</span>
          </div>
        </div>

        {/* Screen-only trail line — the paper stays exactly on template.
            Wording is date · brand · report number: no "Printed" prefix, and
            the brand is the wordmark alone, matching the BLUEWRITE lockup
            rather than spelling the system's full name out. */}
        <footer className="pr-foot no-print">
          {fmtLong(new Date())} · BLUEWRITE · {reportNo}
        </footer>

        {footer ? null : (
          <div className="print-actions no-print">
            <button className="primary" onClick={() => window.print()}>
              Print
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        )}
        </div>
      </div>
      {footer}
    </div>,
    document.body,
  );
}
