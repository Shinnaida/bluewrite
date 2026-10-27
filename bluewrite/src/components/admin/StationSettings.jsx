// BLUEWRITE — Station settings (Admin).
//
// The screen the unused /station API was built for (spec §1.1). Three things
// live here, and the difference between them is the point of the screen:
//
//   1. THE LETTERHEAD — editable, PATCHed, audited. Seven lines print at
//      the head of every sheet the station produces, plus the default name
//      for its "Noted by:" line — so this is the one place in the product
//      where an edit changes what leaves the building on paper.
//
//   2. THE INCIDENT TYPES — editable. The list is station data, not code: the
//      form's dropdown reads it and the server validates against it, so a type
//      taken off this list is refused on submit as well as unoffered. What can
//      be edited is deliberately limited to the 14 types the rule engine has
//      fields for — see CANONICAL_TYPES for why a new name cannot be added.
//
//   3. THE PERSONNEL — READ-ONLY, and shown anyway. The list the report form
//      offers for "IOC" and "Noted By" is a query over the users table, not a
//      column in station_settings: it is whoever is an active Officer or Admin.
//      A control here would be a control over nothing, so this states the count
//      and points at User Management, which is where those people are made.
//
// Every save is an audit event ('station.update', Admin-only) like any other
// administrative change. Both forms are separate on purpose: the letterhead is
// one commit and the type list is another, so a half-finished edit to one cannot
// ride along with the other.

import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
// The same two seals the printed sheet draws (see ReportSheetBody): the proof
// below is the letterhead AS PRINTED, so it shows what the sheet shows.
import pnpLogo from '../../assets/pnp-logo.png';
import citySeal from '../../assets/city-of-naga-seal.png';
import {
  buildTypeRows,
  CANONICAL_TYPES,
  changedHeaderFields,
  headerError,
  HEADER_FIELDS,
  normaliseTypes,
  resolveHeader,
  sameTypes,
  typeListError,
} from '../../lib/stationSettings.js';

export default function StationSettings({ notify, onConnError, onSaved }) {
  // null = still reading. An object = the payload from /station.
  const [station, setStation] = useState(null);
  const [error, setError] = useState(null);

  // The letterhead as TYPED, versus what the server has — two copies, because
  // "what changed" is the question both this form and the PATCH ask. The saved
  // copy is only ever replaced by a server response, so it cannot drift from
  // what is actually stored.
  const [savedHeader, setSavedHeader] = useState(null);
  const [header, setHeader] = useState(null);

  // The type list: rows (canonical order, with the stored list's own order for
  // the enabled ones) plus any stored names the form has no schema for.
  const [rows, setRows] = useState(null);
  const [unknownTypes, setUnknownTypes] = useState([]);
  const [savedTypes, setSavedTypes] = useState(null);

  const [saving, setSaving] = useState(null); // 'header' | 'types' | null

  function adopt(data) {
    const h = resolveHeader(data.header);
    // The personnel list is only on GET (it is a query over the users table,
    // not a column of station_settings), so a PATCH reply must not look like an
    // empty station directory.
    setStation((prev) => ({
      ...data,
      personnel: Array.isArray(data.personnel) ? data.personnel : prev?.personnel ?? [],
    }));
    setSavedHeader(h);
    setHeader({ ...h });
    const built = buildTypeRows(data.incident_types);
    setRows(built.rows);
    setUnknownTypes(built.unknown);
    setSavedTypes([...built.rows.filter((r) => r.enabled).map((r) => r.name), ...built.unknown]);
  }

  // WHITE PAGE like User Management, All Reports and the Audit Trail (owner
  // request): no blue gradient anywhere on this screen, scoped to the class
  // this screen publishes for its lifetime so no other screen is touched.
  useEffect(() => {
    document.body.classList.add('station-white');
    return () => document.body.classList.remove('station-white');
  }, []);

  useEffect(() => {
    let alive = true;
    api('/station')
      .then((data) => alive && adopt(data))
      .catch((err) => {
        if (!alive) return;
        // An infrastructure failure belongs on the shared workspace banner;
        // anything else (a 403 for a non-Admin who reached this route) is this
        // screen's own problem to state.
        if (onConnError) onConnError(err);
        setError(err.message || 'Could not read the station settings.');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Both saves end the same way: adopt what the server now holds. */
  async function save(path, body, message) {
    setSaving(path);
    setError(null);
    try {
      const data = await api('/station', { method: 'PATCH', body });
      setSaving(null);
      notify(message);
      // The server's own reply is the new truth, so the form re-reads from it
      // rather than assuming the write took.
      adopt(data.station ? data.station : data);
      // The form's dropdown and the register's filter read the same list, so a
      // type change has to reach them without a reload.
      if (path === 'types' && onSaved) onSaved();
    } catch (err) {
      setSaving(null);
      if (onConnError) onConnError(err);
      setError(err.message || 'The change could not be saved.');
    }
  }

  if (error && !station) {
    return (
      <div className="st-page">
        <div className="ir-page-head">
          <h1 className="ir-title">STATION SETTINGS</h1>
          <div className="ir-meta">
            <div>UNAVAILABLE</div>
            <div>DEPLOYMENT DATA</div>
          </div>
        </div>
        <div className="alert error" role="alert">
          {error}
        </div>
      </div>
    );
  }

  // Same treatment as the failure branch above and as user management: the
  // screen keeps its page head while the read is in flight, so the title, the
  // meta block and the working surface do not appear and disappear around the
  // load. Placeholder rows stand where the blocks will be.
  if (!station) {
    return (
      <div className="st-page">
        <div className="ir-page-head">
          <h1 className="ir-title">STATION SETTINGS</h1>
          <div className="ir-meta">
            <div>LOADING…</div>
            <div>DEPLOYMENT DATA</div>
          </div>
        </div>
        <div aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-row" />)}
        </div>
      </div>
    );
  }

  const headerDirty = Object.keys(changedHeaderFields(header, savedHeader)).length > 0;
  const headerProblem = headerError(header);
  // What would be sent: the offered types in the order shown, then any stored
  // name the form has no schema for. Validated as a whole, so the reason it
  // cannot be saved is the reason printed ("keep at least one") rather than
  // whatever an empty stand-in would have produced.
  const wanted = [...rows.filter((r) => r.enabled).map((r) => r.name), ...unknownTypes];
  const typesProblem = typeListError(wanted);
  const chosen = typesProblem ? null : normaliseTypes(wanted);
  const typesDirty = !sameTypes(wanted, savedTypes ?? []);

  const personnel = Array.isArray(station.personnel) ? station.personnel : [];

  function setField(key, value) {
    setHeader((h) => ({ ...h, [key]: value }));
  }

  function toggleType(name) {
    setRows((list) =>
      // Re-sorted on every toggle: enabled types come first, in the order they
      // were stored, and a type switched back on rejoins the offered list rather
      // than sitting at the bottom looking switched off.
      sortRows(list.map((r) => (r.name === name ? { ...r, enabled: !r.enabled } : r)))
    );
  }

  return (
    <div className="st-page">
      {/* Same page grammar as every other screen: document title, a right-aligned
          meta block, then the working surface — except that all of it sits in
          one centered measure (see `.st-page`), so the blocks line up under the
          title rather than under empty page. */}
      <div className="ir-page-head">
        <h1 className="ir-title">STATION SETTINGS</h1>
        <div className="ir-meta">
          <div>{rows ? `${CANONICAL_TYPES.length - rows.filter((r) => !r.enabled).length} INCIDENT TYPES` : 'LOADING…'}</div>
          <div>DEPLOYMENT DATA</div>
        </div>
      </div>

      {/* No role badge: the nav only offers this screen to an Admin, so a badge
          saying so restated the gate. The sentence stays, because it is the one
          thing about this page that reading the form cannot tell you — an edit
          here leaves a trail. */}
      <div className="ir-status">
        <span>Changes here apply to the whole station and are recorded in the audit trail.</span>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className="st-stack">
        {/* ================= 1. THE LETTERHEAD ================= */}
        <section className="st-block">
          <div className="st-block-head">
            <h2>Report letterhead</h2>
            <p className="st-lead">
              Printed at the head of every report this station produces, and on the
              letterhead every officer reads back. Changing it changes the documents.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save('header', changedHeaderFields(header, savedHeader), 'Letterhead updated.');
            }}
          >
            <div className="form-grid">
              {HEADER_FIELDS.map(({ key, label, max }) => (
                <div
                  className={`field${key === 'station_name' || key === 'station_location' ? ' span-2' : ''}`}
                  key={key}
                >
                  <label htmlFor={`st-${key}`}>{label}</label>
                  <input
                    id={`st-${key}`}
                    value={header[key]}
                    maxLength={max}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* What the letterhead fields look like once printed — the whole
                reason the form exists is the sheet, and reading the lines set
                as they will be set is the only way to catch a wrong one
                before it goes out on paper. */}
            <div className="st-proof" aria-label="Preview of the printed letterhead">
              <span className="st-proof-label">Printed as</span>
              <div className="st-proof-sheet">
                <img className="st-proof-seal" src={pnpLogo} alt="" aria-hidden="true" />
                <div className="st-proof-org">
                  <div>{header.agency}</div>
                  <div>{header.commission}</div>
                  <div className="st-proof-strong">{header.regional_office}</div>
                  <div className="st-proof-strong">{header.provincial_office}</div>
                  <div className="st-proof-strong">{header.station_name}</div>
                  <div>{header.station_location}</div>
                </div>
                <img className="st-proof-seal" src={citySeal} alt="" aria-hidden="true" />
                <div className="st-proof-code">{header.office_code}</div>
              </div>
            </div>

            {headerProblem && headerDirty && <p className="st-problem">{headerProblem}</p>}

            <div className="st-actions">
              <button type="submit" className="primary" disabled={!headerDirty || !!headerProblem || saving !== null}>
                {saving === 'header' ? 'Saving…' : 'Save Letterhead'}
              </button>
              {headerDirty && (
                <button type="button" onClick={() => setHeader({ ...savedHeader })} disabled={saving !== null}>
                  Revert
                </button>
              )}
              {!headerDirty && !headerProblem && <span className="st-quiet">No unsaved changes.</span>}
            </div>
          </form>
        </section>

        {/* ================= 2. THE INCIDENT TYPES ================= */}
        <section className="st-block">
          <div className="st-block-head">
            <h2>Incident types</h2>
            <p className="st-lead">
              The list officers pick from when they file, in the order shown. A type
              switched off here is no longer offered on the form and is refused by the
              server if a report tries to use it — reports already recorded under it
              keep theirs.
            </p>
          </div>

          <ul className="st-types">
            {rows.map((row) => (
              <li key={row.name} className={`st-type${row.enabled ? '' : ' off'}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={() => toggleType(row.name)}
                  />
                  <span className="st-type-name">{row.name}</span>
                </label>
                <span className="st-type-state">{row.enabled ? 'Offered' : 'Not offered'}</span>
              </li>
            ))}
          </ul>

          {/* A stored name the form has no fields for. Kept and re-sent rather
              than silently dropped — but said out loud, because a report filed
              under it would carry no type-specific section at all. */}
          {unknownTypes.length > 0 && (
            <p className="st-problem">
              {unknownTypes.length === 1 ? 'One configured type is' : `${unknownTypes.length} configured types are`}{' '}
              not built into this version, so the form cannot draw their details section:{' '}
              <strong>{unknownTypes.join(', ')}</strong>. They are kept exactly as configured.
            </p>
          )}

          {typesProblem && <p className="st-problem">{typesProblem}</p>}

          <div className="st-actions">
            <button
              type="button"
              className="primary"
              disabled={!typesDirty || !!typesProblem || saving !== null}
              onClick={() => save('types', { incident_types: chosen }, 'Incident types updated.')}
            >
              {saving === 'types' ? 'Saving…' : 'Save Incident Types'}
            </button>
            {typesDirty && (
              <button
                type="button"
                disabled={saving !== null}
                onClick={() => {
                  const built = buildTypeRows(savedTypes);
                  setRows(built.rows);
                  setUnknownTypes(built.unknown);
                }}
              >
                Revert
              </button>
            )}
            {!typesDirty && <span className="st-quiet">No unsaved changes.</span>}
          </div>
        </section>

        {/* ================= 3. THE PERSONNEL (read-only) ================= */}
        <section className="st-block">
          <div className="st-block-head">
            <h2>Signing personnel</h2>
            <p className="st-lead">
              Who may be named as investigator-on-case or “Noted by”. This list is not
              stored here: it is every active Officer and Admin account, so it is
              changed by making or deactivating an account, not by editing a setting.
            </p>
          </div>

          <p className="st-count">
            <strong>{personnel.length}</strong> active {personnel.length === 1 ? 'person' : 'people'} may be named on a report.
            {' '}
            <span className="st-quiet">Only Officers and Admins are listed — they investigate and note reports.</span>
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * Enabled rows first, in the order they are already in; switched-off rows after,
 * in canonical order. Recomputed on every toggle so a type switched back on
 * rejoins the offered block instead of sitting at the bottom of the list.
 */
function sortRows(list) {
  const rank = (name) => {
    const i = CANONICAL_TYPES.indexOf(name);
    return i === -1 ? CANONICAL_TYPES.length : i;
  };
  return [
    ...list.filter((r) => r.enabled),
    ...list.filter((r) => !r.enabled).sort((a, b) => rank(a.name) - rank(b.name)),
  ];
}
