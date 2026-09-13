import React, { useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
import ReportPrint from './ReportPrint.jsx';
import HeroGlitchText from './HeroGlitchText.jsx';
import ConnectionNotice from './ConnectionNotice.jsx';
import {
  INCIDENT_TYPES,
  ROLE_LABELS,
  GROUP_CONFIG,
  SENSITIVE_TYPES,
  TYPE_FIELDS,
  BLOCK_HEADINGS,
  LEGACY_TYPE_MAP,
} from '../lib/incidentTypes.js';
import { validateReport } from '../lib/reportRules.js';
import { normalizeLegacyTypeSpecific, hasLegacyShape } from '../lib/normalizeLegacy.js';
import RepeatableGroup from './RepeatableGroup.jsx';
import AiNarrativePanel from './AiNarrativePanel.jsx';

const EMPTY = {
  incident_type: '',
  incident_datetime: '',
  location: '',
  complainant: '',
  respondent: '',
  narrative: '',
  status: 'draft',
  type_specific: {},
};

const TYPES = INCIDENT_TYPES;

// Human date: “Sep 11, 2026 · 23:00” — shorter and friendlier than raw ISO.
const DATE_FMT = new Intl.DateTimeFormat('en-PH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat('en-PH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
function fmtIncident(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).replace('T', ' ');
  return `${DATE_FMT.format(d)} · ${TIME_FMT.format(d)}`;
}

// Collapsible raw snapshot from a report_history row (Item 1).
// The API stores a full JSON snapshot per change; a field-level diff view
// would need paired snapshots to be trustworthy, so we show the raw JSON
// collapsed by default instead of a fragile hand-rolled diff.
function SnapshotDiff({ snapshot }) {
  const [open, setOpen] = useState(false);
  let pretty = snapshot;
  try {
    pretty = JSON.stringify(JSON.parse(snapshot), null, 2);
  } catch {
    // snapshot wasn't valid JSON — show it as-is
  }
  return (
    <div style={{ marginTop: '0.25rem' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide snapshot' : 'Show snapshot'}
      </button>
      {open && (
        <pre
          style={{
            maxHeight: '14rem',
            overflow: 'auto',
            fontSize: '0.75rem',
            background: 'rgba(0,0,0,0.05)',
            padding: '0.5rem',
            marginTop: '0.35rem',
          }}
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}

// Labels for the fields validation can flag — used by the error summary so
// the links read as field names, not raw keys.
const FIELD_LABELS = {
  incident_type: 'Incident type',
  incident_datetime: 'Date and time of incident',
  location: 'Place of incident',
  narrative: 'Narrative',
};

// Scroll to a field and move focus to it (focus first so keyboard users
// land in the input, then scrollIntoView centers it).
function focusField(key) {
  const el = document.getElementById(`r-${key === 'incident_datetime' ? 'dt' : key.replace('incident_', '')}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function validate(r) {
  const errs = {};
  if (!r.incident_type) errs.incident_type = 'Select the incident type.';
  if (!r.incident_datetime) errs.incident_datetime = 'Enter the date and time of the incident.';
  if (!r.location.trim()) errs.location = 'Enter the place of incident.';
  if (!r.narrative.trim()) errs.narrative = 'Enter the narrative before finalizing.';
  return errs;
}

// Type-specific field renderer: one labeled control per field of the
// selected incident type. Empty values are simply left empty — omission is
// the rule (the AI prompt and print view both treat blank as absent).
// Fields with `showIf` render only when the controlling field holds one of
// the listed values; changing the controller to a non-matching value hides
// the dependent field (its stored value is cleared on change by the editor —
// see setTypeSpecific — so hidden data never silently persists).
function TypeSpecificFields({ incidentType, values, onChange, disabled }) {
  const fields = TYPE_FIELDS[incidentType] ?? [];
  const visible = (fld) => {
    if (!fld.showIf) return true;
    const cur = values?.[fld.showIf.key] ?? '';
    return fld.showIf.values.includes(cur);
  };
  const shown = fields.filter(visible);
  if (shown.length === 0) return null;
  return (
    <div className="type-specific-grid">
      {shown.map((fld) => {
        const id = `ts-${fld.key}`;
        const val = values?.[fld.key] ?? '';
        const set = (v) => onChange(fld.key, v);
        if (fld.select) {
          return (
            <div className="field" key={fld.key}>
              <label htmlFor={id}>{fld.label}</label>
              <select id={id} value={val} onChange={(e) => set(e.target.value)} disabled={disabled}>
                <option value="">Select…</option>
                {fld.select.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          );
        }
        if (fld.textarea) {
          return (
            <div className="field span-2" key={fld.key}>
              <label htmlFor={id}>{fld.label}</label>
              <textarea id={id} rows={3} value={val} onChange={(e) => set(e.target.value)} disabled={disabled} />
            </div>
          );
        }
        return (
          <div className="field" key={fld.key}>
            <label htmlFor={id}>{fld.label}</label>
            <input
              id={id}
              type={fld.date ? 'date' : fld.time ? 'time' : 'text'}
              value={val}
              onChange={(e) => set(e.target.value)}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// ReportWelcome — the nothing-selected state of the main panel.
// ===========================================================================
export function ReportWelcome({ user, onNew, onOpenReport, reports, loading }) {
  // Recent list: unfinished drafts lead so they are one click to resume;
  // the rest follow in incident-date order (Shell already sorts desc).
  const all = reports ?? [];
  const recent = [
    ...all.filter((r) => r.status === 'draft'),
    ...all.filter((r) => r.status !== 'draft'),
  ].slice(0, 5);
  return (
    <div className="welcome">
      <div className="welcome-intro">
        <div className="welcome-hero" aria-hidden="true">
          <HeroGlitchText text="BLUEWRITE">
            BLUE<em>WRITE</em>
          </HeroGlitchText>
        </div>
        <div className="welcome-rule" aria-hidden="true" />
        <p className="welcome-kicker">Incident documentation workspace</p>
        <h1>What are you documenting today?</h1>
        <p className="welcome-sub">
          Signed in as {user.full_name} — {user.role}. {user.role === 'Admin' ? 'You can see every report in the station.' : 'You see the reports you recorded.'}
        </p>
        <button type="button" className="primary welcome-cta" onClick={onNew}>
          Start a new report
        </button>
      </div>

      {!loading && recent.length > 0 && (
        <div className="welcome-recent">
          <div className="side-section-label">Recent reports</div>
          {recent.map((r) => (
            <button key={r.id} type="button" className="side-report-item" onClick={() => onOpenReport(r)}>
              <span className={`dot ${r.status}`} aria-hidden="true" />
              <span className="side-report-text">
                <span className="side-report-no">BW-{String(r.id).padStart(4, '0')}</span>
                <span className="side-report-type">{r.incident_type}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// ReportEditor — create/edit a single report in the main panel.
// ===========================================================================
export function ReportEditor({ user, notify, reportId, onMutated, onClosed, onConnError }) {
  // For a new report, start with the empty form immediately; for an existing
  // one, null until fetched. (Starting null for BOTH would crash the first
  // render — effects run after render, so the new-report path must be ready.)
  const [draft, setDraft] = useState(reportId === null ? { ...EMPTY } : null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  // Infrastructure failures (server/DB unreachable) get their own state and
  // their own rendering — never the red validation banner.
  const [conn, setConn] = useState(null); // 'offline' | 'database' | 'server' | null
  const [confirm, setConfirm] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(reportId !== null);
  const dirtyRef = useRef(false);
  const draftRef = useRef(null);
  draftRef.current = draft;
  const idRef = useRef(reportId);
  const [editingId, setEditingId] = useState(reportId);

  const canFinalize = user.role === 'Admin' || user.role === 'Officer';
  // A report with no id yet is being created by this very user — always
  // editable. Otherwise ownership decides, as the server enforces.
  const isOwner = draft && (draft.id === undefined || Number(draft.created_by) === Number(user.id));
  const canEdit =
    draft &&
    (user.role === 'Admin' || (isOwner && draft.status !== 'finalized'));

  // Per-item group errors for RepeatableGroup: flatten the rule engine's
  // error paths ("respondents[2].name") into a lookup map. Set at finalize;
  // cleared when the draft changes.
  const [groupErrors, setGroupErrors] = useState({});
  const [ruleWarnings, setRuleWarnings] = useState(null);
  // Phase 3: how the current narrative was authored ('manual'|'ai-assisted').
  // Recorded into report_history on the next save/finalize via change note.
  const narrativeSourceRef = useRef('manual');

  // ---- Unsaved-work recovery (tab-session) ------------------------------
  // A dev-server rebuild, an accidental refresh, or a browser crash used to
  // wipe the whole in-progress report. Mirror the draft into sessionStorage
  // (per tab, keyed by report id) and offer to restore it on remount.
  const editStoreKey = `bw-edit-${reportId ?? 'new'}`;
  const [restoreOffer, setRestoreOffer] = useState(null); // {savedAt, draft}
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(editStoreKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.draft && parsed.draft.incident_type) {
        setRestoreOffer(parsed);
      }
    } catch {
      // corrupted or unavailable storage — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draft || !dirtyRef.current) return;
    try {
      window.sessionStorage.setItem(
        editStoreKey,
        JSON.stringify({ savedAt: Date.now(), draft }),
      );
    } catch {
      // best-effort only
    }
  }, [draft, editStoreKey]);
  function restoreEdits() {
    if (!restoreOffer) return;
    setDraft(restoreOffer.draft);
    idRef.current = restoreOffer.draft.id ?? reportId;
    setEditingId(restoreOffer.draft.id ?? reportId);
    dirtyRef.current = true;
    setRestoreOffer(null);
    setError(null);
  }
  function discardEdits() {
    try {
      window.sessionStorage.removeItem(editStoreKey);
    } catch {
      // ignore
    }
    setRestoreOffer(null);
  }

  // Load an existing report.
  useEffect(() => {
    if (reportId === null) {
      setDraft({ ...EMPTY });
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api(`/reports/${reportId}/print`)
      .then((d) => {
        if (!alive) return;
        const r = d.report;
        let ts = {};
        try {
          ts = r.type_specific
            ? (typeof r.type_specific === 'string' ? JSON.parse(r.type_specific) : r.type_specific)
            : {};
        } catch {
          ts = {}; // malformed legacy data — treat as empty
        }
        setDraft({
          ...EMPTY,
          ...r,
          incident_type: LEGACY_TYPE_MAP[r.incident_type] ?? r.incident_type,
          type_specific: ts,
          incident_datetime: r.incident_datetime
            ? String(r.incident_datetime).slice(0, 16).replace(' ', 'T')
            : '',
        });
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        if (isUnreachable(err)) {
          setConn(classifyError(err));
          onConnError?.(err);
        } else {
          setError(err.message);
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reportId]);

  // Autosave draft every 30s while editing and dirty.
  useEffect(() => {
    const iv = setInterval(async () => {
      const d = draftRef.current;
      if (!d || !dirtyRef.current || !d.incident_type) return;
      try {
        const body = { ...d, status: 'draft' };
        if (idRef.current) {
          await api(`/reports/${idRef.current}`, { method: 'PATCH', body });
        } else {
          const created = await api('/reports', { method: 'POST', body });
          idRef.current = created.report.id;
          setEditingId(created.report.id);
          setDraft((prev) => ({ ...prev, id: created.report.id }));
          onMutated?.();
        }
        dirtyRef.current = false;
        notify('Draft saved automatically.');
      } catch {
        // silent: next tick retries; explicit Save shows the error
      }
    }, 30000);
    return () => clearInterval(iv);
  }, [notify, onMutated]);

  function set(field, value) {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }

  // Nested setter for the type_specific JSON blob. When a controlling
  // select changes, dependent fields that no longer match showIf are cleared
  // so stale values never persist invisibly (prompt rule: empty = absent).
  function setTypeSpecific(key, value) {
    dirtyRef.current = true;
    setDraft((d) => {
      const ts = { ...d.type_specific, [key]: value };
      const fields = TYPE_FIELDS[d.incident_type] ?? [];
      for (const fld of fields) {
        if (fld.showIf?.key === key && !fld.showIf.values.includes(value)) {
          delete ts[fld.key];
        }
      }
      return { ...d, type_specific: ts };
    });
  }

  // Switching incident type resets the specific fields (they belong to the
  // old type) and keeps common fields intact.
  function changeType(value) {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, incident_type: value, type_specific: {} }));
    setErrors((e) => (e.incident_type ? { ...e, incident_type: undefined } : e));
  }

  async function saveDraft() {
    const errs = validate(draft);
    setErrors(errs);
    if (errs.incident_type || errs.incident_datetime || errs.location) return;
    try {
      const body = { ...draft, status: 'draft', narrative_source: narrativeSourceRef.current };
      if (editingId) {
        await api(`/reports/${editingId}`, { method: 'PATCH', body });
      } else {
        const created = await api('/reports', { method: 'POST', body });
        setEditingId(created.report.id);
        idRef.current = created.report.id;
        setDraft((prev) => ({ ...prev, id: created.report.id }));
      }
      dirtyRef.current = false;
      notify('Draft saved.');
      onMutated?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function finalize() {
    // Gate 2: full v3 rule set — common fields, group items, cross-checks.
    const { errors: ruleErrors, warnings: ruleWarnings } = validateReport(draft, 'finalize');
    const errs = {};
    const gErrs = {};
    for (const e of ruleErrors) {
      if (e.path.includes('[')) {
        gErrs[e.path] = e.message; // per-item group error
      } else if (errs[e.path] === undefined) {
        errs[e.path] = e.message;
      }
    }
    setErrors(errs);
    setGroupErrors(gErrs);
    setRuleWarnings(ruleWarnings);
    if (ruleErrors.length > 0) {
      const all = { ...errs, ...gErrs };
      setError(
        <span>
          The report has {Object.keys(all).length} problem{Object.keys(all).length === 1 ? '' : 's'}:{' '}
          <span className="error-summary-inline">
            {Object.entries(all)
              .map(([k, msg]) => (
                <a
                  key={k}
                  href={`#f-${k}`}
                  onClick={(e) => {
                    e.preventDefault();
                    focusField(k);
                  }}
                >
                  {msg}
                </a>
              ))
              .reduce((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}
          </span>
        </span>,
      );
      return;
    }
    setRuleWarnings(null);
    setConfirm({
      title: 'Finalize this report?',
      message:
        'A finalized report is locked for editing. Only an administrator can make further changes, and every change is recorded in the report history.',
      confirmLabel: 'Finalize Report',
      doneMessage: 'Report finalized.',
      action: async () => {
        const body = { ...draft, status: 'finalized', narrative_source: narrativeSourceRef.current };
        if (editingId) {
          await api(`/reports/${editingId}`, { method: 'PATCH', body });
        } else {
          const created = await api('/reports', { method: 'POST', body });
          setEditingId(created.report.id);
          idRef.current = created.report.id;
        }
        dirtyRef.current = false;
        onMutated?.();
      },
    });
  }

  function askArchive() {
    setConfirm({
      title: 'Remove report from the working list?',
      message:
        'The report will be archived (soft-deleted), not permanently deleted. It stays in the database for audit purposes and can be restored by an administrator.',
      confirmLabel: 'Archive Report',
      doneMessage: 'Report archived.',
      action: () => api(`/reports/${editingId}`, { method: 'DELETE' }),
    });
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistory(null);
    setHistoryError(null);
    try {
      const data = await api(`/reports/${editingId}/history`);
      setHistory(data.history);
    } catch (err) {
      setHistoryError(err.message);
    }
  }

  async function runConfirm() {
    const c = confirm;
    setConfirm(null);
    try {
      await c.action();
      notify(c.doneMessage);
      if (c.confirmLabel === 'Finalize Report') {
        setDraft((d) => ({ ...d, status: 'finalized' }));
      }
      if (c.confirmLabel === 'Archive Report') {
        onClosed();
      }
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p>Loading report…</p>;
  if (!draft && conn) {
    return (
      <ConnectionNotice
        message={CONNECTION_MESSAGES[conn]}
        detail="The report could not be opened. Nothing was changed or lost."
        onRetry={() => {
          setConn(null);
          setLoading(reportId !== null);
          if (reportId === null) {
            setDraft({ ...EMPTY });
          } else {
            // Re-run the load by bumping a dependency is overkill here;
            // a reload via key change in Shell handles it. Simplest:
            setDraft(null);
            api(`/reports/${reportId}/print`)
              .then((d) => {
                const r = d.report;
                let ts = {};
                try {
                  ts = r.type_specific
                    ? (typeof r.type_specific === 'string' ? JSON.parse(r.type_specific) : r.type_specific)
                    : {};
                } catch {
                  ts = {};
                }
                const canonicalType = LEGACY_TYPE_MAP[r.incident_type] ?? r.incident_type;
                // Read-time legacy normalization (groups addendum §5.1):
                // flat vehicle_1_*/singular party columns become group
                // arrays IN MEMORY ONLY. The stored JSON is never rewritten.
                ts = normalizeLegacyTypeSpecific(ts, canonicalType, r);
                setDraft({
                  ...EMPTY,
                  ...r,
                  incident_type: canonicalType,
                  type_specific: ts,
                  incident_datetime: r.incident_datetime
                    ? String(r.incident_datetime).slice(0, 16).replace(' ', 'T')
                    : '',
                });
                setLoading(false);
              })
              .catch((err2) => {
                if (isUnreachable(err2)) {
                  setConn(classifyError(err2));
                  onConnError?.(err2);
                } else {
                  setError(err2.message);
                }
                setLoading(false);
              });
          }
        }}
      />
    );
  }
  if (!draft) return <p>Loading report…</p>; // fetch still in flight

  if (error && !draft) {
    return (
      <>
        <div className="alert error" role="alert">{error}</div>
        <button onClick={onClosed}>Back</button>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>
          {draft.id ? `Report #BW-${String(draft.id).padStart(4, '0')}` : 'New Incident Report'}{' '}
          <span className={`badge ${draft.status || 'draft'}`}>{draft.status || 'draft'}</span>
        </h1>
        <p>
          {canEdit
            ? 'Fields marked with an error must be corrected before finalizing.'
            : 'This report is locked. Only an administrator can make further changes.'}
        </p>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {restoreOffer && canEdit && (
        <div className="alert info" role="status">
          Unsaved changes from earlier in this tab were recovered
          {' '}(last kept {new Date(restoreOffer.savedAt).toLocaleTimeString()}).
          <button
            type="button"
            className="primary"
            style={{ marginLeft: '0.6rem' }}
            onClick={restoreEdits}
          >
            Restore them
          </button>
          <button type="button" style={{ marginLeft: '0.4rem' }} onClick={discardEdits}>
            Discard
          </button>
        </div>
      )}

      {Array.isArray(ruleWarnings) && ruleWarnings.length > 0 && (
        <div className="alert info" role="status">
          {ruleWarnings.map((w, i) => (
            <div key={i}>{w.message}</div>
          ))}
        </div>
      )}

      <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--steel)' }}>
        <span className="req">*</span> Required before the report can be finalized.
      </p>

      <form onSubmit={(e) => e.preventDefault()}>
        <div className="section">
          <h2>1. Incident Details</h2>
          <p className="section-hint">What happened, when, and where.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="r-type">Incident type<span className="req">*</span></label>
              <select
                id="r-type"
                value={draft.incident_type}
                onChange={(e) => changeType(e.target.value)}
                disabled={!canEdit}
                aria-invalid={!!errors.incident_type}
              >
                <option value="">Select type…</option>
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              {errors.incident_type && <div className="error">{errors.incident_type}</div>}
            </div>
            <div className="field">
              <label htmlFor="r-date">Date of incident<span className="req">*</span></label>
              <input
                id="r-date"
                type="date"
                className="picker-field"
                value={draft.incident_datetime ? draft.incident_datetime.slice(0, 10) : ''}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  // Keep any already-entered time when only the date changes.
                  const timePart = draft.incident_datetime.includes('T') ? draft.incident_datetime.split('T')[1] : '';
                  set('incident_datetime', e.target.value ? (timePart ? `${e.target.value}T${timePart}` : e.target.value) : '');
                }}
                onClick={() => {
                  // Whole field opens the picker, not just the corner icon.
                  try { e.currentTarget.showPicker?.(); } catch { /* not openable */ }
                }}
                onFocus={() => {
                  try { document.getElementById('r-date')?.showPicker?.(); } catch { /* not openable */ }
                }}
                disabled={!canEdit}
                aria-invalid={!!errors.incident_datetime}
              />
              {errors.incident_datetime && <div className="error">{errors.incident_datetime}</div>}
            </div>
            <div className="field">
              <label htmlFor="r-time">Time of incident<span className="req">*</span></label>
              <input
                id="r-time"
                type="time"
                className="picker-field"
                value={draft.incident_datetime.includes('T') ? draft.incident_datetime.split('T')[1] : ''}
                onChange={(e) => {
                  // A time without a date is stored as date+T+time once the
                  // date exists; today is the fallback date when only a time
                  // was picked first (server stores a full datetime).
                  const datePart = draft.incident_datetime ? draft.incident_datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
                  set('incident_datetime', e.target.value ? `${datePart}T${e.target.value}` : datePart);
                }}
                onClick={() => {
                  try { e.currentTarget.showPicker?.(); } catch { /* not openable */ }
                }}
                onFocus={() => {
                  try { document.getElementById('r-time')?.showPicker?.(); } catch { /* not openable */ }
                }}
                disabled={!canEdit}
                aria-invalid={!!errors.incident_datetime}
              />
              {errors.incident_datetime && <div className="error">{errors.incident_datetime}</div>}
            </div>
            <div className="field span-2">
              <label htmlFor="r-loc">Place of incident<span className="req">*</span></label>
              <input
                id="r-loc"
                placeholder="Street, barangay, or landmark"
                value={draft.location}
                onChange={(e) => set('location', e.target.value)}
                disabled={!canEdit}
                aria-invalid={!!errors.location}
              />
              {errors.location && <div className="error">{errors.location}</div>}
            </div>
          </div>
        </div>

        <div className="section">
          <h2>2. Parties Involved</h2>
          <p className="section-hint">Who reported the incident and who it involves. Use “Add” for each person.</p>
          {SENSITIVE_TYPES.includes(draft.incident_type) && (
            <div className="alert info">
              Sensitive incident — write in clinical, factual language. Record only
              what was reported; avoid graphic detail.
            </div>
          )}
          {hasLegacyShape(draft.type_specific) && (
            <div className="alert info" role="status">
              This report was recorded in the old single-party format. Parties are shown grouped for editing; the original record stays intact.
            </div>
          )}
          {draft.incident_type && Object.entries(GROUP_CONFIG[draft.incident_type] ?? {}).map(([groupKey, cfg]) => (
            <RepeatableGroup
              key={groupKey}
              groupKey={groupKey}
              label={cfg.label}
              minCount={cfg.minCount}
              itemSchema={cfg.itemSchema}
              softWarnAt={cfg.softWarnAt}
              items={draft.type_specific?.[groupKey]}
              errors={groupErrors}
              disabled={!canEdit}
              onChange={(nextItems) =>
                setDraft((d) => ({
                  ...d,
                  type_specific: { ...d.type_specific, [groupKey]: nextItems },
                }))
              }
              blankItem={() => ({})}
            />
          ))}
        </div>

        {draft.incident_type && (
          <div className="section">
            <h2>3. {BLOCK_HEADINGS[draft.incident_type] ?? 'Incident Details'}</h2>
            <p className="section-hint">Fill in only what applies. Blank fields are left out of the report.</p>
            <TypeSpecificFields
              incidentType={draft.incident_type}
              values={draft.type_specific}
              onChange={setTypeSpecific}
              disabled={!canEdit}
            />
          </div>
        )}

        <div className="section">
          <h2>4. Narrative</h2>
          <p className="section-hint">Tell the story of the incident in order: before, during, after.</p>
          <div className="field field-narrative">
            <label htmlFor="r-narr">Narrative<span className="req">*</span></label>
            <textarea
              id="r-narr"
              rows={8}
              value={draft.narrative || ''}
              onChange={(e) => {
                set('narrative', e.target.value);
                if (narrativeSourceRef.current !== 'ai-assisted') narrativeSourceRef.current = 'manual';
              }}
              disabled={!canEdit}
              aria-invalid={!!errors.narrative}
            />
            {errors.narrative && <div className="error">{errors.narrative}</div>}
          </div>
          {canEdit && (
            <AiNarrativePanel
              reportId={draft.id ?? null}
              canEdit={canEdit}
              narrative={draft.narrative || ''}
              onAccept={(aiText) => {
                // Human-in-the-loop: the officer explicitly copies the AI
                // draft in; it stays fully editable afterwards. The source
                // tag lands in report_history via the next save/finalize.
                set('narrative', aiText);
                narrativeSourceRef.current = 'ai-assisted';
              }}
            />
          )}
        </div>

        <div className="editor-actions">
          {canEdit && canFinalize && (
            <button className="primary" onClick={finalize}>
              Finalize Report
            </button>
          )}
          {canEdit && <button onClick={saveDraft}>Save Draft</button>}
          {draft.id && (
            <>
              <button type="button" onClick={openHistory}>History</button>
              <button type="button" onClick={() => setPrinting(true)}>Print</button>
            </>
          )}
          {draft.id && canEdit && (
            <button type="button" className="danger" onClick={askArchive}>
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={onClosed}
          >
            Close
          </button>
        </div>
      </form>

      {printing && <ReportPrint reportId={draft.id} onClose={() => setPrinting(false)} />}

      {historyOpen && (
        <div className="dialog-overlay" onClick={() => setHistoryOpen(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>
              History — Report #BW-{String(draft.id).padStart(4, '0')}
            </h2>
            {historyError && (
              <div className="alert error" role="alert">
                {historyError}
              </div>
            )}
            {history === null && !historyError && <p>Loading history…</p>}
            {history && history.length === 0 && (
              <p>No recorded changes for this report yet.</p>
            )}
            {history && history.length > 0 && (
              <ol style={{ paddingLeft: '1.2rem', margin: '0.5rem 0' }}>
                {history.map((h) => (
                  <li key={h.id} style={{ marginBottom: '0.6rem' }}>
                    <div>
                      <strong>{h.change_note}</strong>{' '}
                      <span style={{ color: 'var(--steel)' }}>
                        — {h.changed_by}, {String(h.created_at).replace('T', ' ')}
                      </span>
                    </div>
                    {h.snapshot && <SnapshotDiff snapshot={h.snapshot} />}
                  </li>
                ))}
              </ol>
            )}
            <div className="actions">
              <button onClick={() => setHistoryOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="dialog-overlay" onClick={() => setConfirm(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{confirm.title}</h2>
            <p>{confirm.message}</p>
            <div className="actions">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className={confirm.confirmLabel === 'Finalize Report' ? 'primary' : 'danger'}
                onClick={runConfirm}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// ReportsTable — the full blotter with search/filters/sort/pagination.
// Officers see their own reports; admins see everything.
// ===========================================================================
export function ReportsTable({ user, notify, onMutated, onConnError }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [conn, setConn] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  // A report opened for editing from the table (opens in the same panel).
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState({ q: '', type: '', status: '', date_from: '', date_to: '', sort: 'incident_datetime', dir: 'desc', page: 1 });
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState('');
  const [flashId, setFlashId] = useState(null);

  const canFinalize = user.role === 'Admin' || user.role === 'Officer';

  async function load() {
    try {
      const params = new URLSearchParams();
      if (!showArchived) {
        for (const [k, v] of Object.entries(query)) {
          if (v !== '' && !(k === 'page' && v === 1)) params.set(k, String(v));
        }
      }
      if (showArchived) params.set('archived', '1');
      const qs = params.toString();
      const data = await api(`/reports${qs ? `?${qs}` : ''}`);
      setReports(data.reports);
      setPagination(data.pagination);
      setConn(null);
    } catch (err) {
      if (isUnreachable(err)) {
        setConn(classifyError(err));
        setReports((cur) => cur ?? []);
        onConnError?.(err);
      } else {
        setError(err.message);
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, query]);

  async function runConfirm() {
    const c = confirm;
    setConfirm(null);
    try {
      await c.action();
      notify(c.doneMessage);
      await load();
      onMutated?.();
      setFlashId(c.flashId ?? null);
      if (c.flashId) {
        window.setTimeout(() => setFlashId((cur) => (cur === c.flashId ? null : cur)), 900);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function askDelete(r) {
    setConfirm({
      title: 'Remove report from the working list?',
      message:
        'The report will be archived (soft-deleted), not permanently deleted. It stays in the database for audit purposes and can be restored by an administrator.',
      confirmLabel: 'Archive Report',
      doneMessage: 'Report archived.',
      flashId: r.id,
      action: () => api(`/reports/${r.id}`, { method: 'DELETE' }),
    });
  }

  function askRestore(r) {
    setConfirm({
      title: `Restore report #BW-${String(r.id).padStart(4, '0')}?`,
      message:
        'The report will be moved back to the active working list. The restore is recorded in the report history and the audit log.',
      confirmLabel: 'Restore Report',
      doneMessage: 'Report restored.',
      flashId: r.id,
      action: () => api(`/reports/${r.id}/restore`, { method: 'PATCH' }),
    });
  }

  async function openHistory(r) {
    setHistoryFor(r);
    setHistory(null);
    setHistoryError(null);
    try {
      const data = await api(`/reports/${r.id}/history`);
      setHistory(data.history);
    } catch (err) {
      setHistoryError(err.message);
    }
  }

  if (openId !== null) {
    return (
      <ReportEditor
        key={openId}
        user={user}
        notify={notify}
        reportId={openId}
        onMutated={onMutated}
        onClosed={() => setOpenId(null)}
      />
    );
  }

  if (!reports && reports !== null && !error) return <p>Loading reports…</p>;

  return (
    <>
      <div className="page-head">
        <h1>All Reports</h1>
        <p>
          {user.role === 'Admin'
            ? 'Every report in the station — search, filter, and sort.'
            : 'The reports you recorded — search, filter, and sort.'}
        </p>
      </div>

      {/* Connection failures are reported to Shell (onConnError) which
          shows one workspace-wide banner; here we only note what it means
          for THIS list — no duplicated notice. */}
      {conn && (
        <p className="stale-note" role="status">
          Couldn’t refresh — showing the last loaded list. It updates automatically once the connection is back.
        </p>
      )}

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.6rem' }}>
        {user.role === 'Admin' && (
          <button onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
        )}
      </div>
      {reports && reports.length === 0 && !showArchived && !conn ? (
        <div className="empty">
          <strong>No reports found.</strong> Adjust the filters or start a new report from the sidebar.
        </div>
      ) : conn && reports && reports.length === 0 ? null : (
        <>
          {/* Row 1: search · Row 2: filters + sort. No wrapping scramble. */}
          <div className="reports-toolbar">
            <div className="reports-toolbar-row">
              <form
                className="reports-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery((q) => ({ ...q, q: search, page: 1 }));
                }}
              >
                <input
                  type="search"
                  placeholder="Search type, place, parties, narrative, officer…"
                  aria-label="Search reports"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearch('');
                      setQuery((q) => ({ ...q, q: '', page: 1 }));
                    }
                  }}
                />
                <button type="submit">Search</button>
              </form>
            </div>
            <div className="reports-toolbar-row">
              <select
                aria-label="Filter by incident type"
                value={query.type}
                onChange={(e) => setQuery((q) => ({ ...q, type: e.target.value, page: 1 }))}
              >
                <option value="">All types</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={query.status}
                onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value, page: 1 }))}
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="finalized">Finalized</option>
              </select>
              <input
                type="date"
                aria-label="Incident date from"
                title="Incident date from"
                value={query.date_from}
                onChange={(e) => setQuery((q) => ({ ...q, date_from: e.target.value, page: 1 }))}
              />
              <input
                type="date"
                aria-label="Incident date to"
                title="Incident date to"
                value={query.date_to}
                onChange={(e) => setQuery((q) => ({ ...q, date_to: e.target.value, page: 1 }))}
              />
              <select
                aria-label="Sort reports"
                value={`${query.sort}:${query.dir}`}
                onChange={(e) => {
                  const [sort, dir] = e.target.value.split(':');
                  setQuery((q) => ({ ...q, sort, dir, page: 1 }));
                }}
              >
                <option value="incident_datetime:desc">Newest incident first</option>
                <option value="incident_datetime:asc">Oldest incident first</option>
                <option value="incident_type:asc">Type A→Z</option>
                <option value="incident_type:desc">Type Z→A</option>
                <option value="status:asc">Status A→Z</option>
                <option value="status:desc">Status Z→A</option>
                <option value="created_by_name:asc">Officer A→Z</option>
                <option value="created_by_name:desc">Officer Z→A</option>
              </select>
              {(query.q || query.type || query.status || query.date_from || query.date_to) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setQuery((q) => ({ q: '', type: '', status: '', date_from: '', date_to: '', sort: q.sort, dir: q.dir, page: 1 }));
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Report No.</th>
                  <th>Type</th>
                  <th>Date of Incident</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Recorded By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports &&
                  reports
                    .map((r) => (
                    <tr key={r.id} style={flashId === r.id ? { transition: 'background 300ms ease', background: 'rgba(62, 213, 152, 0.12)' } : undefined}>
                      <td className="num">BW-{String(r.id).padStart(4, '0')}</td>
                      <td>{r.incident_type}</td>
                      <td>{fmtIncident(r.incident_datetime)}</td>
                      <td>{r.location}</td>
                      <td>
                        <span className={`badge ${r.status}`}>{r.status}</span>
                      </td>
                      <td>{r.created_by_name || '—'}</td>
                      <td>
                        {showArchived ? (
                          user.role === 'Admin' && (
                            <div className="row-actions">
                              <button onClick={() => askRestore(r)}>Restore</button>
                            </div>
                          )
                        ) : (
                          <div className="row-actions">
                            {r.status !== 'finalized' || user.role === 'Admin' ? (
                              <button onClick={() => setOpenId(r.id)}>Open</button>
                            ) : (
                              <span className="locked-note" title="Finalized reports can only be edited by an administrator">Locked</span>
                            )}
                            <button onClick={() => openHistory(r)}>History</button>
                            <button onClick={() => setPrintingId(r.id)}>Print</button>
                            <button className="danger" onClick={() => askDelete(r)}>
                              Archive
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.total_pages > 1 && (
            <div
              className="reports-pagination"
              style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.75rem' }}
            >
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: pagination.page - 1 }))}
              >
                Prev
              </button>
              <span style={{ fontFamily: 'var(--font-hud)', fontSize: '0.75rem', color: 'var(--cyan-dim)' }}>
                Page {pagination.page} of {pagination.total_pages} — {pagination.total} report(s)
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.total_pages}
                onClick={() => setQuery((q) => ({ ...q, page: pagination.page + 1 }))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {printingId && <ReportPrint reportId={printingId} onClose={() => setPrintingId(null)} />}

      {historyFor && (
        <div className="dialog-overlay" onClick={() => setHistoryFor(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>
              History — Report #BW-{String(historyFor.id).padStart(4, '0')}
            </h2>
            {historyError && (
              <div className="alert error" role="alert">
                {historyError}
              </div>
            )}
            {history === null && !historyError && <p>Loading history…</p>}
            {history && history.length === 0 && (
              <p>No recorded changes for this report yet.</p>
            )}
            {history && history.length > 0 && (
              <ol style={{ paddingLeft: '1.2rem', margin: '0.5rem 0' }}>
                {history.map((h) => (
                  <li key={h.id} style={{ marginBottom: '0.6rem' }}>
                    <div>
                      <strong>{h.change_note}</strong>{' '}
                      <span style={{ color: 'var(--steel)' }}>
                        — {h.changed_by}, {String(h.created_at).replace('T', ' ')}
                      </span>
                    </div>
                    {h.snapshot && <SnapshotDiff snapshot={h.snapshot} />}
                  </li>
                ))}
              </ol>
            )}
            <div className="actions">
              <button onClick={() => setHistoryFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="dialog-overlay" onClick={() => setConfirm(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{confirm.title}</h2>
            <p>{confirm.message}</p>
            <div className="actions">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className={confirm.confirmLabel === 'Finalize Report' ? 'primary' : 'danger'}
                onClick={runConfirm}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
