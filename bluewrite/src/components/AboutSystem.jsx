// BLUEWRITE — About this system.
//
// The panel a support call starts from: which build this station is running,
// which station it is, whether the AI drafting service is configured on this
// installation, and whether the server is answering at all. Everything in it is
// either a constant (lib/appInfo) or something the server said a moment ago, so
// the panel cannot drift from the system it is describing.
//
// It reads on OPEN, not on mount: nothing is fetched until an officer asks.
// /station is the station's own letterhead — agency, station name, office code,
// the incident-type list, the personnel who sign reports — and /ai/health is
// the one fact nobody can infer from the screen, because an unconfigured AI
// service simply makes the Generate button absent.
//
// Both calls are allowed to fail. A panel that refuses to render when the thing
// it is describing is broken would be useless exactly when it is wanted, so a
// failed read prints "Unavailable" and the panel still opens.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { AI_ADVISORY, DEPARTMENT, SYSTEM_TITLE } from '../lib/appInfo.js';

/** The station's letterhead fields, in the order the panel prints them. */
const HEADER_ROWS = [
  ['agency', 'Agency'],
  ['station_name', 'Station'],
  ['office_code', 'Office code'],
  ['regional_office', 'Regional office'],
];

function Fact({ label, children }) {
  return (
    <div className="about-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function AboutSystem({ user, onClose }) {
  // null = still reading; false = the call failed; anything else = the payload.
  const [station, setStation] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(null);

  useEffect(() => {
    let alive = true;
    api('/station')
      .then((d) => alive && setStation(d))
      .catch(() => alive && setStation(false));
    api('/ai/health')
      .then((d) => alive && setAiEnabled(!!d.enabled))
      .catch(() => alive && setAiEnabled(false));
    return () => {
      alive = false;
    };
  }, []);

  // Escape closes, like the profile menu that opened this.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const header = station && station.header ? station.header : null;
  const types = station && Array.isArray(station.incident_types) ? station.incident_types : null;
  const personnel = station && Array.isArray(station.personnel) ? station.personnel : null;

  /** What a row prints while the read is in flight, or after it failed. */
  const pending = (value) => {
    if (station === null) return 'Reading…';
    return value || 'Unavailable';
  };

  // Portalled to the body, NOT left where it is rendered. The bar it is opened
  // from is `.ir-nav`, which carries a z-index — so every descendant of it is
  // capped at the bar's own layer, and the report screen's docked action bar
  // (z-index 60) would paint over this panel. The register's row menu makes the
  // same move for the same reason.
  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-title">About this system</h2>
        <p className="about-lead">
          BLUE<em>WRITE</em> — {SYSTEM_TITLE}.
        </p>

        <dl className="about-facts">
          <Fact label="Department">{DEPARTMENT}</Fact>
          {HEADER_ROWS.map(([key, label]) => (
            <Fact key={key} label={label}>
              {pending(header?.[key])}
            </Fact>
          ))}
          <Fact label="Incident types">
            {station === null
              ? 'Reading…'
              : types
                ? `${types.length} on file`
                : 'Unavailable'}
          </Fact>
          <Fact label="Signing personnel">
            {station === null
              ? 'Reading…'
              : personnel
                ? `${personnel.length} on file`
                : 'Unavailable'}
          </Fact>
          <Fact label="AI drafting">
            {aiEnabled === null ? 'Checking…' : aiEnabled ? 'Enabled' : 'Not configured'}
          </Fact>
          {/* The officer's own line, marked as such: on a shared workstation the
              panel is often read out to somebody else, and "which build" and
              "which account" are the two questions that get mixed up. */}
          <Fact label="Signed in as">
            {user.full_name} · Badge {user.badge_number} · {user.role}
          </Fact>
        </dl>

        <p className="about-note">{AI_ADVISORY}</p>

        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
