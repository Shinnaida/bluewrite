import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { normalizeLegacyTypeSpecific } from '../lib/normalizeLegacy.js';

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

  // Numbered items block from a description/value key pair.
  const itemsBlock = (label, pairs) => {
    const items = pairs
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

// NOTABLE FINDINGS — only genuinely recorded evidence-type observations.
function buildFindings(ts) {
  const findings = [];
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

// ACTION TAKEN / STATUS — recorded follow-up states plus the standard
// station referral (form convention, not invented data).
function buildActions(report, ts, finalized) {
  const actions = [];
  if (has(ts.suspect_status)) actions.push(`Suspect status: ${N(ts.suspect_status)}.`);
  if (has(ts.recovery_status)) actions.push(`Recovery status: ${N(ts.recovery_status)}.`);
  if (has(ts.recovered_property)) actions.push(`Recovered property: ${N(ts.recovered_property)}.`);
  if (has(ts.medical_examination)) actions.push(`Medico-legal examination: ${N(ts.medical_examination)}${has(ts.medical_facility) ? `, ${N(ts.medical_facility)}` : ''}.`);
  if (has(ts.protection_order_information)) actions.push(`Protection order: ${N(ts.protection_order_information)}.`);
  if (has(ts.search_actions_taken)) actions.push(`Search actions taken: ${N(ts.search_actions_taken)}.`);
  if (has(ts.fire_department_response)) actions.push(`Fire department response: ${N(ts.fire_department_response)}.`);
  actions.push(
    finalized && report.finalized_by_name
      ? `The entry was reviewed and finalized by ${report.finalized_by_name} on ${fmtLong(report.finalized_at)}.`
      : 'The entry is on file with this station and is subject to further verification.',
  );
  actions.push(
    'For further investigation and appropriate action, this report is referred to the station investigator-on-case.',
  );
  return actions;
}

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
export default function ReportPrint({ reportId, onClose }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.body.classList.add('print-sheet-open');
    return () => document.body.classList.remove('print-sheet-open');
  }, []);

  useEffect(() => {
    let alive = true;
    api(`/reports/${reportId}/print`)
      .then((data) => {
        if (!alive) return;
        setReport(data.report);
        // Give the layout a tick to paint before opening the dialog.
        setTimeout(() => window.print(), 150);
      })
      .catch((err) => setError(err.message));
    return () => {
      alive = false;
    };
  }, [reportId]);

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
  const reportNo = `BW-${String(report.id).padStart(4, '0')}`;
  const facts = buildTypeFacts(report.incident_type, { report, ts });
  const findings = buildFindings(ts);
  const actions = buildActions(report, ts, finalized);

  return createPortal(
    <div className="print-overlay">
      <div className="print-sheet">
        {/* ---- Agency header: PNP + RP seals flanking the org block ---- */}
        <header className="pr-head">
          <img
            className="pr-seal"
            src="./assets/seal-left.png"
            alt="PNP seal"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="pr-org">
            Republic of the Philippines
            <br />
            National Police Commission
            <br />
            <strong>PHILIPPINE NATIONAL POLICE, POLICE REGIONAL OFFICE 7</strong>
            <br />
            <strong>CEBU POLICE PROVINCIAL OFFICE</strong>
            <br />
            <strong>CITY of NAGA POLICE STATION</strong>
            <br />
            City of Naga, Cebu
          </div>
          <img
            className="pr-seal"
            src="./assets/seal-right.png"
            alt="Republic seal"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </header>

        {/* ---- Office code (left, bold) + date (right, “Date” label under) ---- */}
        <div className="pr-code-date">
          <span className="pr-office-code">NCPS &ndash; INVEST</span>
          <span className="pr-date">
            {fmtLong(new Date())}
            <span className="pr-date-label">Date</span>
          </span>
        </div>

        <h1 className="pr-title">POLICE REPORT</h1>

        {report.status !== 'finalized' && (
          <p className="pr-draft-note">
            DRAFT &mdash; NOT YET FINAL. This printout is a working copy.
          </p>
        )}

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

        {findings.length > 0 && (
          <div className="pr-section">
            <strong>NOTABLE FINDINGS:</strong>
            {findings.map((fnd, i) => (
              <div className="pr-entry" key={`find-${i}`}>- {fnd}</div>
            ))}
          </div>
        )}

        <div className="pr-section">
          <strong>ACTION TAKEN / STATUS:</strong>
          {actions.map((act, i) => (
            <div className="pr-entry" key={`act-${i}`}>{act}</div>
          ))}
        </div>

        {/* ---- Signature block: Recorded by / IOC / Noted by ---- */}
        <div className="pr-footer-block">
          <p className="pr-recorded">
            <strong>Recorded by:</strong> {report.created_by_name}
            {report.created_by_badge ? ` (Badge ${report.created_by_badge})` : ''}
          </p>

          <p className="pr-recorded">
            <strong>IOC:</strong> <span className="pr-sign-blank" aria-hidden="true" />
          </p>

          <div className="pr-noted">
            <span className="pr-noted-label">Noted by:</span>
            {finalized && report.finalized_by_name ? (
              <span className="pr-noted-name">{report.finalized_by_name}</span>
            ) : (
              <span className="pr-noted-name pr-noted-blank">&nbsp;</span>
            )}
          </div>
        </div>

        {/* Screen-only trail line — the paper stays exactly on template. */}
        <footer className="pr-foot no-print">
          Printed {fmtLong(new Date())} · BlueWrite Incident Documentation
          System · {reportNo}
        </footer>

        <div className="print-actions no-print">
          <button className="primary" onClick={() => window.print()}>
            Print
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
