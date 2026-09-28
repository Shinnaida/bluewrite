import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
import ReportPrint from './ReportPrint.jsx';
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
import {
  validateReport,
  sectionBlockers,
  firstBlockedSection,
  sectionForPath,
  REPORT_SECTIONS,
} from '../lib/reportRules.js';
import { normalizeLegacyTypeSpecific, hasLegacyShape } from '../lib/normalizeLegacy.js';
import RepeatableGroup from './RepeatableGroup.jsx';
import AiNarrativePanel from './AiNarrativePanel.jsx';
// The official-document stylesheet: the navy top bar, page head, card panels,
// field labels and signature blocks. Shared by every screen now that the whole
// application uses this look (the tokens themselves live in styles.css).
import '../incident-report.css';
import {
  caseNumber,
  reportDateValue,
  specDate,
  specTimestamp,
} from '../lib/incidentReport.js';

const EMPTY = {
  incident_type: '',
  incident_datetime: '',
  location: '',
  complainant: '',
  respondent: '',
  narrative: '',
  // Disposition fields printed on the sheet (migration 004): the officer's
  // own ACTION TAKEN / STATUS text and the investigator-on-case name that
  // signs the "IOC:" line.
  action_taken: '',
  ioc_name: '',
  // Reporting party (migration 006, Panel I of the Write Report screen) and
  // the officer initials of Panel IV. Separate from created_by: the person
  // filing the report is not always the officer on the record.
  reporter_name: '',
  reporter_id_no: '',
  reporter_contact: '',
  reporter_email: '',
  reporter_address: '',
  officer_initials: '',
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
  reporter_name: 'Reporting party name',
  reporter_email: 'Email address',
  reporter_contact: 'Contact number',
  officer_initials: 'Officer initials',
};

// ---------------------------------------------------------------------------
// Small pieces of the Write Report screen's chrome.
// ---------------------------------------------------------------------------

// Line icons for the field labels (spec: a small icon sits left of each
// label). Inline SVG, 14px, currentColor — no icon dependency, and they
// inherit the label's muted colour.
const LABEL_ICONS = {
  person: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-7 1.7-7 4v1h14v-1c0-2.3-3.7-4-7-4Z" />,
  id: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8.5" cy="11" r="2.1" />
      <path d="M5 16.4c.6-1.5 2-2.2 3.5-2.2s2.9.7 3.5 2.2M14.5 10h4M14.5 13.5h4" />
    </>
  ),
  phone: <path d="M6.6 3.5h2.2l1.5 4-1.8 1.3a11 11 0 0 0 5.6 5.6l1.3-1.8 4 1.5v2.2c0 1.2-1 2.2-2.2 2.2A14.7 14.7 0 0 1 4.4 5.7c0-1.2 1-2.2 2.2-2.2Z" />,
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hash: <path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15" />,
  lines: <path d="M5 6.5h14M5 12h14M5 17.5h9" />,
};

function LabelIcon({ name }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {LABEL_ICONS[name]}
    </svg>
  );
}

/** An icon + uppercase caption — the spec's field label treatment. */
function IrLabel({ htmlFor, children, icon, required }) {
  return (
    <label className="ir-label" htmlFor={htmlFor}>
      {icon && <LabelIcon name={icon} />}
      <span>
        {children}
        {required ? <span className="req"> *</span> : null}
      </span>
    </label>
  );
}

/**
 * One white card with a light-gray section header bar.
 *
 * `headless` drops the header bar entirely, for a card that is its own label —
 * Home's register tail, whose rows name themselves. Everything else keeps the
 * numbered bar, so the report document's panels stay numbered I, II, III.
 */
// `id` is a step's jump target (see sectionDomId) — the card is already the unit
// the wizard talks about, so it carries the anchor.
function IrCard({ num, title, children, wide, flush, actions, headless, id }) {
  return (
    <section id={id} className={wide ? 'ir-card ir-card--wide' : 'ir-card'}>
      {!headless && (
        <div className="ir-card-head">
          {num && <span className="ir-card-num">{num}.</span>}
          <span>{title}</span>
          {/* Card-level actions (export, view toggles) sit in the header bar,
              not in a content row: they are not filters and would otherwise
              compete with them for the single filter line. */}
          {actions && <span className="ir-card-head-actions">{actions}</span>}
        </div>
      )}
      {/* flush: the body owns no padding — for card-wide tables. */}
      <div className={flush ? 'ir-card-body ir-card-body--flush' : 'ir-card-body'}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Wizard plumbing: the section anchors and the jump to them.
//
// The progress TRACKER that used to sit above the section (five nodes + a
// "n of 5 complete" tally) was removed on request; the model behind it stayed
// in src/lib/reportRules.js (REPORT_SECTIONS, sectionStatus,
// reportSectionStatus) with its tests, so restoring a tracker is a UI job only.
// ---------------------------------------------------------------------------

// DOM anchor for a section's first card. Deriving it from the section id keeps
// the step nav and the cards from drifting apart (one rule, five anchors).
function sectionDomId(sectionId) {
  return `section-${sectionId.replace(/_/g, '-')}`;
}

// Scroll a section's first card into view, then flash it. Plain scrollIntoView —
// no router and no hash (this app deliberately has neither; Shell owns
// navigation as state), and `.main` is the scrolling ancestor, not the window.
// The flash is the same one error jumps use, so a jump whose target is already
// on screen still visibly answers the click.
function scrollToSection(sectionId) {
  const el = document.getElementById(sectionDomId(sectionId));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flashTarget(el);
}

// Quick visual ring so the officer sees WHERE the jump landed, not just that
// the page moved. Re-triggerable: removing the class first (and forcing a
// reflow) restarts the animation when the same target is clicked twice.
function flashTarget(el, cls = 'jump-flash') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 2200);
}

// Resolve a groupKey to its RepeatableGroup section, tolerating the plural /
// singular spellings different groups are declared with.
function groupSection(groupKey) {
  return (
    document.querySelector(`[data-group="${groupKey}"]`) ||
    document.querySelector(`[data-group="${groupKey.replace(/s$/, '')}"]`) ||
    document.querySelector(`[data-group="${groupKey}s"]`)
  );
}

// Resolve a rule-engine error path to { el, section, level }.
//   "vehicles[0].driver_name" -> that exact input (level 'field')
//   "vehicles"                -> the WHOLE group (level 'group'): a count-floor
//                                error has no field to point at, so the target
//                                is the first flagged field, else the "+ Add"
//                                button that fixes it.
function resolveTarget(key) {
  const item = /^(\w+)\[(\d+)\]\.(\w+)$/.exec(key);
  if (item) {
    const [, g, i, fld] = item;
    // DOM ids are `<groupKey>-<index>-<field>`; some groups use a singular
    // key ("respondent-0-name"), some plural ("vehicles-0-plate_number").
    for (const id of [`${g}-${i}-${fld}`, `${g.replace(/s$/, '')}-${i}-${fld}`, `${g}s-${i}-${fld}`]) {
      const el = document.getElementById(id);
      if (el) return { el, section: groupSection(g) || el.closest('.rep-group'), level: 'field' };
    }
    const section = groupSection(g);
    return section ? { el: section, section, level: 'group' } : null;
  }

  const section = groupSection(key);
  if (section) {
    const flagged = section.querySelector('[aria-invalid="true"]');
    const el = flagged || section.querySelector('.rep-add') || section;
    return { el, section, level: 'group' };
  }

  // Some form controls use a short id (r-narr, r-act, r-ioc) rather than the
  // field key; map those so an error link still lands on the right input.
  const aliases = {
    narrative: 'r-narr',
    action_taken: 'r-act',
    ioc_name: 'r-ioc',
    reporter_name: 'r-reporter-name',
    reporter_id_no: 'r-reporter-id',
    reporter_contact: 'r-reporter-contact',
    reporter_email: 'r-reporter-email',
    reporter_address: 'r-reporter-address',
    officer_initials: 'r-officer-initials',
  };
  const el =
    document.getElementById(aliases[key] ?? '') ||
    document.getElementById(`r-${key === 'incident_datetime' ? 'dt' : key.replace('incident_', '')}`);
  return el ? { el, section: el.closest('.section') || el.closest('.field'), level: 'field' } : null;
}

// Scroll to the offending field and make it obvious: focus it (so keyboard
// users land in the input), center it, then flash it — and for a whole-group
// error also flash the group box so the section itself is unmistakable.
function focusField(key) {
  const target = resolveTarget(key);
  if (!target) return;
  const { el, section, level } = target;
  el.focus?.({ preventScroll: true });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashTarget(el);
  if (level === 'group' && section && section !== el) flashTarget(section, 'jump-flash-group');
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
export function ReportWelcome({ user, onNew, onOpenReport, onMyReports, reports, loading }) {
  // Recent list: unfinished drafts lead so they are one click to resume;
  // the rest follow in incident-date order (Shell already sorts desc).
  const all = reports ?? [];
  const recent = [
    ...all.filter((r) => r.status === 'draft'),
    ...all.filter((r) => r.status !== 'draft'),
  ].slice(0, 5);
  // Home is the masthead, one action, and the register tail — all centred. It
  // deliberately has no page title or officer meta line: the top bar already
  // carries the department lockup, the identity sits in the profile menu, and
  // every other officer screen (My Reports, Write Report) still uses the full
  // left-aligned `ir-page-head` + `ir-status` grammar.
  //
  // The Report Intake card was removed by request, so the primary action now
  // stands on its own under the masthead and the register tail closes the page.
  // Its "View All My Reports" button went with it: the top bar already has that
  // destination, so the card was the second route to a screen one click away.
  //
  // The tail is `headless` by request as well: its "I. Recent Reports" bar was
  // a second label for rows that already say what they are (number, type, date,
  // status), so the card now opens straight onto the records.
  //
  // `.ir-home` is the ONLY thing that centres: it gives the centring rules a
  // scope that stops at this screen, so the document grammar elsewhere is
  // untouched.
  return (
    <div className="ir-home">
      {/* The BlueWrite wordmark back on the page — the old hero, now on the
          light document surface above the working cards. Plain type: BLUE in
          navy, WRITE in the brand blue. */}
      <section className="ir-hero">
        <p className="ir-hero-wordmark">
          BLUE<em>WRITE</em>
        </p>
        <p className="ir-hero-kicker">Incident documentation workspace</p>
      </section>

      {/* The page's one action. */}
      <div className="ir-actions-row ir-home-actions">
        <button type="button" className="ir-submit ir-home-cta" onClick={onNew}>
          Start a New Report
        </button>
      </div>

      <section className="ir-recent">
        <IrCard headless>
          {loading && <p className="ir-home-lead">Loading your reports…</p>}
          {!loading && recent.length === 0 && (
            <p className="ir-home-lead">
              No reports recorded yet. Your first report will appear here.
            </p>
          )}
          {!loading && recent.length > 0 && (
            <ul className="ir-home-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="ir-home-item"
                    onClick={() => onOpenReport(r)}
                    title={`${r.incident_type} — ${r.location || 'no location recorded'}`}
                  >
                    <span className="ir-home-no">BW-{String(r.id).padStart(4, '0')}</span>
                    <span className="ir-home-type">{r.incident_type}</span>
                    <span className="ir-home-when">{fmtIncident(r.incident_datetime)}</span>
                    <span className={`badge ${r.status}`}>{r.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </IrCard>
      </section>
    </div>
  );
}

// ===========================================================================
// ReportEditor — create/edit a single report in the main panel.
// ===========================================================================
export function ReportEditor({
  user,
  notify,
  reportId,
  onMutated,
  onClosed,
  onConnError,
}) {
  // For a new report, start with the empty form immediately; for an existing
  // one, null until fetched. (Starting null for BOTH would crash the first
  // render — effects run after render, so the new-report path must be ready.)
  const [draft, setDraft] = useState(reportId === null ? { ...EMPTY } : null);
  // State halves of the two maps the JSX renders from. The rendered `errors` /
  // `groupErrors` are derived further down (save results + the strict step gate),
  // so the setters keep their familiar names and the getters are qualified.
  const [saveErrors, setErrors] = useState({});
  // AI disposition helper: the officer types a rough note ("follow up
  // investigation") and the model rewrites it into the formal statement that
  // prints in ACTION TAKEN / STATUS. The officer stays in the loop — the
  // result lands in the editable field.
  const [error, setError] = useState(null);
  // A blocked finalize (missing required fields) shows the red banner at the
  // TOP of the form. The officer clicks Finalize from the actions row at the
  // BOTTOM, so without help the banner is off-screen and the click looks like
  // it did nothing. errorRef scrolls it into view; errorPulse re-keys it so
  // the highlight replays on every attempt.
  const errorRef = useRef(null);
  const [errorPulse, setErrorPulse] = useState(0);
  // Infrastructure failures (server/DB unreachable) get their own state and
  // their own rendering — never the red validation banner.
  const [conn, setConn] = useState(null); // 'offline' | 'database' | 'server' | null
  const [confirm, setConfirm] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [printing, setPrinting] = useState(false);
  // Finalize flow: true while the review sheet (with its confirm bar) is up.
  const [finalizePreview, setFinalizePreview] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [loading, setLoading] = useState(reportId !== null);
  const dirtyRef = useRef(false);
  const draftRef = useRef(null);
  draftRef.current = draft;
  const idRef = useRef(reportId);
  const [editingId, setEditingId] = useState(reportId);

  // Which section the wizard is showing. Nothing is gated by it — any section
  // can be opened at any time and Submit stays live on every step; only what is
  // ON SCREEN changes, so the report is still filled in whatever order suits
  // the incident. Declared above the values derived from it just below: those
  // are plain consts, so reading it any earlier would be a temporal-dead-zone
  // error rather than an undefined value.
  const [activeSection, setActiveSection] = useState(REPORT_SECTIONS[0].id);

  // Wizard position: the step index drives the Back / Next pair and the
  // "Section n of 5" caption. Derived from the section id, so a section opened
  // from anywhere (a stepper node, an error jump) keeps them in step.
  const stepIndex = Math.max(0, REPORT_SECTIONS.findIndex((s) => s.id === activeSection));
  const prevSection = REPORT_SECTIONS[stepIndex - 1] ?? null;
  const nextSection = REPORT_SECTIONS[stepIndex + 1] ?? null;
  const activeLabel = REPORT_SECTIONS[stepIndex].label;

  const canFinalize = user.role === 'Admin' || user.role === 'Officer';
  // A report with no id yet is being created by this very user — always
  // editable. Otherwise ownership decides, as the server enforces.
  const isOwner = draft && (draft.id === undefined || draft.created_by === undefined || Number(draft.created_by) === Number(user.id));
  const canEdit =
    draft &&
    (user.role === 'Admin' || (isOwner && draft.status !== 'finalized'));

  // Per-item group errors for RepeatableGroup: flatten the rule engine's
  // error paths ("respondents[2].name") into a lookup map. Set at finalize;
  // cleared when the draft changes.
  const [saveGroupErrors, setGroupErrors] = useState({});
  const [ruleWarnings, setRuleWarnings] = useState(null);
  // Phase 3: how the current narrative was authored ('manual'|'ai-assisted').
  // Recorded into report_history on the next save/finalize via change note.
  const narrativeSourceRef = useRef('manual');

  // One-step "reject" for the two fields Generate rewrites in place (Notable
  // Findings, Action Taken / Status): each keeps the text it held immediately
  // BEFORE the draft replaced it, so an officer who preferred their own
  // shorthand gets it back with one click instead of retyping. Cleared the
  // moment they edit that field themselves, so a stale revert can never fight
  // their typing.
  const [aiUndo, setAiUndo] = useState({ findings: null, action_taken: null });

  // Progress stepper's data: which of the five document sections carry content
  // and no outstanding error. It reads the SAME validateReport('finalize')
  // result the Submit gate reads (checkFullRules below), so the tracker can
  // never claim a section is done that Submit would still refuse. The rule
  // engine is a pure pass over a few dozen fields, so recomputing per keystroke
  // is cheap; if that ever changes, debounce HERE, not in reportRules.js.
  // ONE pass of the rule engine per draft change feeds the strict step gate and
  // the inline messages below — never two.
  const finalizeErrors = useMemo(
    () => (draft ? validateReport(draft, 'finalize').errors : []),
    [draft],
  );

  // The strict step gate. `gateSection` is the section the officer last tried to
  // leave (a blocked Next, or a stepper node past the frontier). Everything the
  // gate SHOWS derives from the live draft just below, so its messages clear
  // themselves as the missing fields are filled — no bookkeeping to sync.
  const [gateSection, setGateSection] = useState(null);

  // How far forward the wizard may go: up to AND INCLUDING the first section the
  // rules still block, so the officer can always open the section they must fix
  // but cannot step past it. Going backward is free at every point.
  const firstBlocked = firstBlockedSection(finalizeErrors, draft);
  const frontierIndex = firstBlocked
    ? REPORT_SECTIONS.findIndex((s) => s.id === firstBlocked)
    : REPORT_SECTIONS.length - 1;

  // The gate's own error maps, split the way the editor renders them: group
  // items are addressed by an indexed path, everything else by its field key.
  const gate = useMemo(() => {
    const blockers = gateSection ? sectionBlockers(finalizeErrors, gateSection, draft) : [];
    const field = {};
    const group = {};
    for (const b of blockers) {
      if (String(b.path).includes('[')) group[b.path] = b.message;
      else if (field[b.path] === undefined) field[b.path] = b.message;
    }
    return { blocked: blockers.length > 0, field, group };
  }, [finalizeErrors, gateSection, draft]);

  // Whether the section ON SCREEN is itself holding the report up. The caption
  // beside Next says so before the officer even clicks it.
  const activeBlockers = sectionBlockers(finalizeErrors, activeSection, draft.incident_type);

  // What the fields render: the save / finalize results merged with the gate's.
  // Same rule engine behind both, so a field is only ever flagged once.
  const errors = { ...saveErrors, ...gate.field };
  const groupErrors = { ...saveGroupErrors, ...gate.group };

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
          setDraft((prev) => ({ ...prev, id: created.report.id, created_by: user.id }));
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
  // Restore what a field held before the AI formalised it (see aiUndo).
  function revertAiField(field) {
    const prev = aiUndo[field];
    if (prev === null) return;
    if (field === 'findings') setTypeSpecific('notable_findings', prev);
    else set('action_taken', prev);
    setAiUndo((u) => ({ ...u, [field]: null }));
  }

  // Drop the revert offer for a field the officer is now editing by hand.
  function clearAiUndo(field) {
    setAiUndo((u) => (u[field] === null ? u : { ...u, [field]: null }));
  }

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
    try {        const body = { ...draft, status: 'draft', narrative_source: narrativeSourceRef.current };
        if (editingId) {
          await api(`/reports/${editingId}`, { method: 'PATCH', body });
        } else {
          const created = await api('/reports', { method: 'POST', body });
          setEditingId(created.report.id);
          idRef.current = created.report.id;
          setDraft((prev) => ({ ...prev, id: created.report.id, created_by: user.id }));
        }
      dirtyRef.current = false;
      notify('Draft saved.');
      onMutated?.();
    } catch (err) {
      setError(err.message);
    }
  }

  // Gate 2 shared by BOTH entry points (Finalize and Generate AI draft):
  // the full v3 rule set — common fields, group items, cross-checks. Flags
  // every problem (red banner, per-field inline errors, jump + flash) and
  // returns false when blocked. `ignorePaths` lets the AI gate exempt the
  // narrative — writing it IS the AI's job, so requiring it first is circular.
  function checkFullRules({ ignorePaths = [] } = {}) {
    const { errors: ruleErrors, warnings: ruleWarnings } = validateReport(draft, 'finalize');
    const blocking = ruleErrors.filter((e) => !ignorePaths.includes(e.path));
    const errs = {};
    const gErrs = {};
    for (const e of blocking) {
      if (e.path.includes('[')) {
        gErrs[e.path] = e.message; // per-item group error
      } else if (errs[e.path] === undefined) {
        errs[e.path] = e.message;
      }
    }
    setErrors(errs);
    setGroupErrors(gErrs);
    setRuleWarnings(ruleWarnings);
    if (blocking.length > 0) {
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
                    // Opens the section holding this field, if it is another
                    // step — the banner can name problems in any section.
                    revealError(k);
                  }}
                >
                  {msg}
                </a>
              ))
              .reduce((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}
          </span>
        </span>,
      );
      // Bring the banner into view and pulse it, then land focus on the first
      // offending field so a blocked action never looks like a dead click.
      setErrorPulse((n) => n + 1);
      window.requestAnimationFrame(() => {
        errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Land on the first offending field — opening its section first when
        // that field is on another step, so a blocked Submit never looks dead.
        const firstKey = blocking[0]?.path;
        if (firstKey) window.setTimeout(() => revealError(firstKey), 350);
      });
      return false;
    }
    setRuleWarnings(null);
    return true;
  }

  // Move to a section, then bring it to the top: the officer may have scrolled
  // well down within the previous step. The timeout lets the new section mount
  // before its anchor is looked up.
  function selectSection(sectionId) {
    setActiveSection(sectionId);
    window.setTimeout(() => scrollToSection(sectionId), 0);
  }

  // The strict gate, in one place: a section may not be LEFT while its own
  // rules still flag it. The attempt is refused, that section's problems are
  // shown inline and the first one is focused — the same feedback a blocked
  // Submit gives, so a refused click never looks dead.
  function attemptLeave(sectionId) {
    const blockers = sectionBlockers(finalizeErrors, sectionId, draft.incident_type);
    if (blockers.length === 0) return true;
    setGateSection(sectionId);
    const first = blockers[0].path;
    window.setTimeout(() => revealError(first), 0);
    return false;
  }

  // Send the officer to whatever is holding the report up, instead of letting
  // them past it. Returns false when it had to intervene.
  function holdAtFrontier() {
    const blocker = firstBlocked;
    if (!blocker) return true; // nothing is holding the report up
    setGateSection(blocker);
    if (blocker !== activeSection) selectSection(blocker);
    const blockers = sectionBlockers(finalizeErrors, blocker, draft.incident_type);
    if (blockers.length > 0) {
      const first = blockers[0].path;
      window.setTimeout(() => revealError(first), 0);
    }
    return false;
  }

  // Next: the section being left must be clear, AND forward travel stops at the
  // frontier — which can sit BEHIND the section on screen when the officer
  // stepped back and emptied an earlier required field.
  function tryAdvance() {
    if (!nextSection) return;
    if (stepIndex + 1 > frontierIndex) {
      holdAtFrontier();
      return;
    }
    if (!attemptLeave(activeSection)) return;
    selectSection(nextSection.id);
  }

  // A blocked action can name a field in a section the wizard is not showing.
  // Open that section FIRST, then let it mount before resolving the DOM target —
  // otherwise focusField() finds nothing and the jump silently does nothing.
  function revealError(path) {
    const target = sectionForPath(path, draftRef.current?.incident_type);
    if (target && target !== activeSection) setActiveSection(target);
    window.setTimeout(() => focusField(path), 0);
  }

  // Generate AI draft flags problems FIRST: an incomplete report makes a poor
  // AI draft, so the same banner + jump-to-field runs before any request.
  // Only the narrative is exempt — that is what the AI is there to write.
  function gateAiGenerate() {
    const ok = checkFullRules({ ignorePaths: ['narrative'] });
    if (ok) setError(null); // a previous failed attempt's banner must not linger
    return ok;
  }

  async function finalize() {
    if (!checkFullRules()) return;
    // Finalize flow: REVIEW FIRST. The print sheet opens with a confirmation
    // bar at its bottom; the PATCH (which locks the report) only fires when
    // the officer confirms there. No modal popup beforehand.
    setError(null); // a previous failed attempt's banner must not linger
    setFinalizePreview(true);
  }

  // Runs on the confirmation bar at the bottom of the finalize preview.
  async function confirmFinalize() {
    const body = { ...draft, status: 'finalized', narrative_source: narrativeSourceRef.current };
    try {
      if (editingId) {
        await api(`/reports/${editingId}`, { method: 'PATCH', body });
      } else {
        // A report that has never been saved is created FIRST and then
        // finalized with a PATCH. The API always creates drafts (so every
        // finalize goes through the one gate that re-validates the stored
        // groups), which means the create call cannot carry status=finalized:
        // previously it did, the API dropped it, and a report submitted
        // straight from the form stayed a draft on the server while the UI
        // showed it as finalized.
        const created = await api('/reports', { method: 'POST', body: { ...body, status: 'draft' } });
        setEditingId(created.report.id);
        idRef.current = created.report.id;
        await api(`/reports/${created.report.id}`, { method: 'PATCH', body });
      }
      // Reflect the new status locally so the badge flips to "finalized",
      // the form locks, and the sidebar/status lists refresh immediately.
      setDraft((d) => ({
        ...d,
        status: 'finalized',
        id: d.id ?? (editingId ?? undefined),
        created_by: d.created_by ?? user.id,
      }));
      dirtyRef.current = false;
      setFinalizePreview(false);
      notify('Report finalized.');
      onMutated?.();
    } catch (err) {
      // Server-side rule gate rejections carry a details[] list (422 "invalid
      // fields") — show them so the officer knows exactly what to fix.
      const details = Array.isArray(err.details) ? err.details : null;
      setError(
        details && details.length > 0 ? (
          <span>
            {err.message}{' '}
            <span className="error-summary-inline">
              {details.join(', ')}
            </span>
          </span>
        ) : err.message,
      );
    }
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
      {/* The Write Report screen (spec: "Official Incident Reporting
          System"). The navy bar and the light page now belong to Shell; this
          screen contributes only its document content. The print sheet and
          the dialogs below render outside the form so the document stylesheet
          can never repaint an official sheet. */}
      <div className="ir-page-head">
        <h1 className="ir-title">POLICE INCIDENT REPORT</h1>
        <div className="ir-meta">
          <div>CASE NO: {caseNumber(draft)}</div>
          <div>DATE: {specDate(reportDateValue(draft, new Date().toISOString().slice(0, 10)))}</div>
        </div>
      </div>

      <div className="ir-status">
        <span className={`badge ${draft.status || 'draft'}`}>{draft.status || 'draft'}</span>
        <span>
          {draft.id
            ? `Report BW-${String(draft.id).padStart(4, '0')} · Recorded by ${user.full_name} · Badge ${user.badge_number}`
            : 'Not saved yet — the first save assigns the report number.'}
        </span>
        {!canEdit && (
          <span>This report is locked. Only an administrator can make further changes.</span>
        )}
      </div>

      {error && (
        <div
          className="alert error alert-pulse"
          role="alert"
          key={errorPulse}
          ref={errorRef}
        >
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

      <p className="ir-required-note">
        <span className="req">*</span> Required before the report can be submitted.
      </p>

      <form onSubmit={(e) => e.preventDefault()} className="ir-form">
        {/* ONE SECTION AT A TIME — the stepper above is the navigation. The
            document's panels and the app's own blocks are grouped into the five
            sections the tracker names, each of them full width: the old 2x2
            grid put every field in a half-width panel. Nothing is gated by
            this — any section is one click away, Submit stays live on every
            step, and the report is still filled in any order. */}
        {activeSection === 'reporting_party' && (
          <IrCard num="I" title="Reporting Party Information" id={sectionDomId('reporting_party')}>
            <div className="ir-sub">
              <div className="ir-field">
                <IrLabel htmlFor="r-reporter-name" icon="person">Full Name</IrLabel>
                <input
                  id="r-reporter-name"
                  autoComplete="name"
                  placeholder="Last Name, First Name, M.I."
                  value={draft.reporter_name || ''}
                  onChange={(e) => set('reporter_name', e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="ir-field">
                <IrLabel htmlFor="r-reporter-id" icon="id">
                  Identification / Driver&rsquo;s License No.
                </IrLabel>
                <input
                  id="r-reporter-id"
                  placeholder="e.g. N01-23-456789"
                  value={draft.reporter_id_no || ''}
                  onChange={(e) => set('reporter_id_no', e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="ir-field">
                <IrLabel htmlFor="r-reporter-contact" icon="phone">Contact Number</IrLabel>
                <input
                  id="r-reporter-contact"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(000) 000-0000"
                  value={draft.reporter_contact || ''}
                  onChange={(e) => set('reporter_contact', e.target.value)}
                  disabled={!canEdit}
                  aria-invalid={!!errors.reporter_contact}
                />
                {errors.reporter_contact && <div className="error">{errors.reporter_contact}</div>}
              </div>
              <div className="ir-field">
                <IrLabel htmlFor="r-reporter-email" icon="mail">Email Address</IrLabel>
                <input
                  id="r-reporter-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={draft.reporter_email || ''}
                  onChange={(e) => set('reporter_email', e.target.value)}
                  disabled={!canEdit}
                  aria-invalid={!!errors.reporter_email}
                />
                {errors.reporter_email && <div className="error">{errors.reporter_email}</div>}
              </div>
              <div className="ir-field ir-span-2">
                <IrLabel htmlFor="r-reporter-address" icon="pin">Home Address</IrLabel>
                <input
                  id="r-reporter-address"
                  autoComplete="street-address"
                  placeholder="Street, barangay, city / municipality"
                  value={draft.reporter_address || ''}
                  onChange={(e) => set('reporter_address', e.target.value)}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </IrCard>
        )}

        {activeSection === 'incident_details' && (
          <IrCard num="II" title="Incident Details" id={sectionDomId('incident_details')}>
            <div className="ir-sub">
              <div className="ir-field">
                <IrLabel htmlFor="r-type" icon="hash" required>Type of Incident</IrLabel>
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
              <div className="ir-field">
                <IrLabel icon="calendar">Date &amp; Time of Occurrence</IrLabel>
                {/* Two fields, not one datetime-local: the incident date and
                    time are recorded separately, and the time carries an
                    "approximate" qualifier so “around 1:00 A.M.” survives
                    without inventing a precise minute (spec §1.2). */}
                <div className="ir-datetime">
                  <div>
                    <label className="ir-sub-label" htmlFor="r-date">Date</label>
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
                  </div>
                  <div>
                    <label className="ir-sub-label" htmlFor="r-time">Time</label>
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
                  </div>
                </div>
                <label className="ir-approx" htmlFor="r-time-approx">
                  <input
                    id="r-time-approx"
                    type="checkbox"
                    checked={!!draft.incident_time_approximate}
                    onChange={(e) => set('incident_time_approximate', e.target.checked)}
                    disabled={!canEdit}
                  />
                  <span>Time is approximate (e.g. “around 1:00 A.M.”)</span>
                </label>
                {errors.incident_datetime && <div className="error">{errors.incident_datetime}</div>}
              </div>
              <div className="ir-field ir-span-2">
                <IrLabel htmlFor="r-loc" icon="pin" required>Location of Incident</IrLabel>
                <input
                  id="r-loc"
                  placeholder="Specific address or intersection"
                  value={draft.location}
                  onChange={(e) => set('location', e.target.value)}
                  disabled={!canEdit}
                  aria-invalid={!!errors.location}
                />
                {errors.location && <div className="error">{errors.location}</div>}
              </div>
            </div>
          </IrCard>
        )}

        {activeSection === 'narrative' && (
          <IrCard num="III" title="Incident Narrative" id={sectionDomId('narrative')}>
            <div className="ir-field ir-narrative">
              <IrLabel htmlFor="r-narr" icon="lines" required>
                Detailed Description of Events
              </IrLabel>
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
                placeholder="Describe the incident in chronological order. Include suspect description, witness information, and any property damage or injuries."
              />
              {errors.narrative && <div className="error">{errors.narrative}</div>}
            </div>
            {canEdit && (
              <AiNarrativePanel
                reportId={draft.id ?? null}
                canEdit={canEdit}
                narrative={draft.narrative || ''}
                // The AI closes the narrative with the recorded disposition,
                // so the panel shows which text it is working from.
                actionTaken={draft.action_taken || ''}
                // The officer's own observations: the AI weaves them into the
                // narrative AND formalises them into the sheet's NOTABLE
                // FINDINGS block.
                notableFindings={draft.type_specific?.notable_findings || ''}
                // Completeness gate: flag "The report has N problems" and jump
                // to the missing fields BEFORE any AI request is sent.
                onBeforeGenerate={gateAiGenerate}
                onAccept={(aiText) => {
                  // Human-in-the-loop: the officer explicitly copies the AI
                  // draft in; it stays fully editable afterwards. The source
                  // tag lands in report_history via the next save/finalize.
                  set('narrative', aiText);
                  narrativeSourceRef.current = 'ai-assisted';
                }}
                // Generating the report IS the action for the findings: the
                // drafted lines replace the Notable Findings field outright
                // (one printed line per finding), because that field is what
                // saves, snapshots and prints. A draft with no findings leaves
                // the officer's text alone, and identical text is not rewritten
                // (so no spurious unsaved-changes state).
                onApplyFindings={(lines) => {
                  const text = lines.join('\n');
                  if (text.trim() === '') return;
                  if (text === String(draft.type_specific?.notable_findings || '')) return;
                  // Remember what we are about to replace so the officer can
                  // reject the formalisation with one click.
                  setAiUndo((u) => ({ ...u, findings: String(draft.type_specific?.notable_findings || '') }));
                  setTypeSpecific('notable_findings', text);
                }}
                // The recorded disposition is enhanced the same way: the
                // formalised line replaces the ACTION TAKEN / STATUS field,
                // which is what saves and prints. A blank disposition in the
                // draft leaves the officer's wording untouched.
                onApplyActionTaken={(text) => {
                  if (text.trim() === '') return;
                  if (text === String(draft.action_taken || '')) return;
                  setAiUndo((u) => ({ ...u, action_taken: String(draft.action_taken || '') }));
                  set('action_taken', text);
                }}
              />
            )}
          </IrCard>
        )}

        {activeSection === 'type_specific' && (
          <>
          <IrCard title="Parties Involved" wide id={sectionDomId('type_specific')}>
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
              groupError={errors[groupKey]}
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
        </IrCard>

        {draft.incident_type && (
          <IrCard wide title={BLOCK_HEADINGS[draft.incident_type] ?? 'Incident Details'}>
            <p className="section-hint">Fill in only what applies. Blank fields are left out of the report.</p>
            <TypeSpecificFields
              incidentType={draft.incident_type}
              values={draft.type_specific}
              onChange={setTypeSpecific}
              disabled={!canEdit}
            />
            {/* Notable findings: the officer's own observations that don't fit
                any structured field (CCTV insight, tool marks, behavior…) —
                printed in the NOTABLE FINDINGS block of the sheet and given
                to the AI as narrative context. */}
            <div className="field field-narrative">
              <label htmlFor="r-find">Notable Findings</label>
              <textarea
                id="r-find"
                rows={3}
                value={draft.type_specific?.notable_findings || ''}
                onChange={(e) => {
                  setTypeSpecific('notable_findings', e.target.value);
                  clearAiUndo('findings');
                }}
                disabled={!canEdit}
                placeholder="e.g. CCTV shows the suspect knew exactly where the wires were kept; entry was made without a flashlight."
              />
              <div className="section-hint">
                Printed in the NOTABLE FINDINGS block of the report sheet — one
                line per typed line. Leave blank if there is nothing notable.
              </div>
              {canEdit && aiUndo.findings !== null && (
                <div className="section-hint ai-undo-hint">
                  Formalised by the AI —{' '}
                  <button
                    type="button"
                    className="ai-undo"
                    onClick={() => revertAiField('findings')}
                  >
                    Undo
                  </button>
                </div>
              )}
            </div>
          </IrCard>
        )}
          </>
        )}

        {activeSection === 'action_signatures' && (
          <>
          {/* The signature block leads this section: it holds the reporting
              party's signature line and the officer's initials, and the
              stepper counts it here rather than with the party's details. */}
          <IrCard title="Signatures" id={sectionDomId('action_signatures')}>
            <div className="ir-sign-grid">
              <div className="ir-sign-box">
                <div className="ir-sign-caption">Signature of Reporting Party</div>
                {/* No signature-pad component exists in the system, so this
                    is a typed record: the name from Panel I over a signature
                    rule, dated by the server when the report is submitted. */}
                <div className="ir-sign-area">
                  {draft.reporter_name
                    ? draft.reporter_name
                    : <span className="ir-sign-empty">Name typed in Panel I appears here</span>}
                </div>
                <div className="ir-sign-stamp">
                  Timestamp:{' '}
                  {draft.party_signed_at ? (
                    <strong>{specTimestamp(draft.party_signed_at)}</strong>
                  ) : (
                    <span>auto-filled when the report is submitted</span>
                  )}
                </div>
              </div>

              <div className="ir-sign-box">
                <div className="ir-sign-caption">Officer Initial &amp; Badge No.</div>
                <div>
                  <label className="ir-sub-label" htmlFor="r-officer-initials">Initials</label>
                  <input
                    id="r-officer-initials"
                    placeholder="e.g. J.D.C."
                    maxLength={12}
                    value={draft.officer_initials || ''}
                    onChange={(e) => set('officer_initials', e.target.value)}
                    disabled={!canEdit}
                    aria-invalid={!!errors.officer_initials}
                  />
                  {errors.officer_initials && <div className="error">{errors.officer_initials}</div>}
                </div>
                <div>
                  <label className="ir-sub-label" htmlFor="r-officer-badge">Badge No.</label>
                  {/* Taken from the signed-in account, exactly like the
                      "Recorded by" line — never typed, never overridable. */}
                  <div className="ir-readonly" id="r-officer-badge">
                    {user.badge_number} · {user.full_name}
                  </div>
                  <p className="ir-readonly-note">From your account — cannot be edited.</p>
                </div>
              </div>
            </div>
          </IrCard>

        {/* Action Taken / Status is a required document block: the narrative
            generator receives it as context, and the report cannot be
            submitted without it. It sits in this section, under the signature
            block, and directly above the step's Back / Next. */}
        <IrCard wide title="Action Taken / Status">
          <p className="section-hint">
            How the incident was handled. Required before the report can be
            submitted, and used by the AI when it writes the narrative.
          </p>
          <div className="field field-narrative">
            <label htmlFor="r-act">
              Action Taken / Status<span className="req">*</span>
            </label>
            <textarea
              id="r-act"
              rows={4}
              value={draft.action_taken || ''}
              onChange={(e) => {
                set('action_taken', e.target.value);
                clearAiUndo('action_taken');
              }}
              disabled={!canEdit}
              aria-invalid={!!errors.action_taken}
              placeholder="e.g. Subject turned over to the station for proper disposition. Follow-up investigation ongoing."
            />
            {errors.action_taken && <div className="error">{errors.action_taken}</div>}
            <div className="section-hint">
              Printed in the ACTION TAKEN / STATUS block of the report sheet.
            </div>
            {canEdit && aiUndo.action_taken !== null && (
              <div className="section-hint ai-undo-hint">
                Formalised by the AI —{' '}
                <button
                  type="button"
                  className="ai-undo"
                  onClick={() => revertAiField('action_taken')}
                >
                  Undo
                </button>
              </div>
            )}
          </div>
        </IrCard>

        {/* The narrative is its own step (Panel III, with the AI panel beside
            it) — it is not repeated here. */}
        <IrCard wide title="Investigator-on-Case">
          <p className="section-hint">
            Who is carrying the case. Required before the report can be
            submitted — the name is printed on the “IOC:” line.
          </p>
          <div className="field">
            <label htmlFor="r-ioc">
              Investigator-on-case (IOC)<span className="req">*</span>
            </label>
            <input
              id="r-ioc"
              value={draft.ioc_name || ''}
              onChange={(e) => set('ioc_name', e.target.value)}
              disabled={!canEdit}
              aria-invalid={!!errors.ioc_name}
              placeholder="Name of the officer handling the case"
            />
            {errors.ioc_name && <div className="error">{errors.ioc_name}</div>}
          </div>
        </IrCard>
          </>
        )}

        {/* Wizard navigation — the step's own Back / Next. It never gates: the
            stepper above reaches any section directly, and Submit below stays
            live on every step. */}
        <div className="ir-step-nav">
          <button
            type="button"
            className="ir-step-back"
            onClick={() => selectSection(prevSection.id)}
            disabled={!prevSection}
            title={prevSection ? `Back to ${prevSection.label}` : 'This is the first section'}
          >
            ← Back
          </button>
          <span className="ir-step-pos">
            Section {stepIndex + 1} of {REPORT_SECTIONS.length} — {activeLabel}
            {activeBlockers.length > 0 && (
              <span className="ir-step-hint">Required fields still missing</span>
            )}
            {/* Open, but out of reach: its own rules are satisfied and something
                EARLIER is not — say which section, not just that something is. */}
            {activeBlockers.length === 0 && stepIndex > frontierIndex && (
              <span className="ir-step-hint">
                Locked until {REPORT_SECTIONS[frontierIndex].label} is complete
              </span>
            )}
          </span>
          <button
            type="button"
            className="ir-step-next"
            onClick={tryAdvance}
            disabled={!nextSection}
            title={
              activeBlockers.length > 0
                ? 'Fill the required fields above to continue'
                : nextSection
                  ? `Continue to ${nextSection.label}`
                  : 'This is the last section'
            }
          >
            Next →
          </button>
        </div>

        {/* Submit bar: one full-width primary action that runs the same
            completeness gate as before, so a report cannot be submitted with
            required fields missing. The secondary actions stay underneath. */}
        <div className="ir-actions">
          <button
            type="button"
            className="ir-submit"
            onClick={finalize}
            disabled={!canEdit || !canFinalize}
            title={
              canFinalize
                ? 'Validate and submit this report for the record'
                : 'Your role does not have permission to submit reports'
            }
          >
            Submit Official Report
          </button>
          <div className="ir-actions-row">
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
        </div>

        {/* Footer (spec §5): the system's real writing-assistance advisory —
            no placeholder phone number, since the station has not supplied a
            support line. */}
        <p className="ir-footer">
          AI-generated suggestions are provided as writing assistance only. The
          reporting officer remains responsible for reviewing and verifying all
          report content.
        </p>
      </form>

      {printing && (
        <ReportPrint
          reportId={draft.id}
          onClose={() => setPrinting(false)}
          recordedBy={{ name: user.full_name, badge: user.badge_number }}
        />
      )}

      {/* Finalize: the report sheet appears FIRST, with the confirmation bar
          at its bottom. The report is only locked once the officer confirms.
          The sheet renders the CURRENT draft — unsaved edits included — so
          the officer reviews exactly what will be locked, and it works even
          before the first save (no id yet). */}
      {finalizePreview && (
        <ReportPrint
          report={draft}
          autoPrint={false}
          recordedBy={{ name: user.full_name, badge: user.badge_number }}
          onClose={() => setFinalizePreview(false)}
          footer={
            <div className="finalize-bar no-print" role="alertdialog" aria-label="Confirm finalize">
              <div className="finalize-bar-text">
                <strong>Finalize this report?</strong>{' '}
                A finalized report is locked for editing. Only an administrator
                can make further changes, and every change is recorded in the
                report history.
              </div>
              <div className="finalize-bar-actions">
                <button
                  type="button"
                  onClick={() => setFinalizePreview(false)}
                  disabled={finalizing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    setFinalizing(true);
                    await confirmFinalize();
                    setFinalizing(false);
                  }}
                  disabled={finalizing}
                >
                  {finalizing ? 'Finalizing…' : 'Confirm Finalize'}
                </button>
              </div>
            </div>
          }
        />
      )}

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
export function ReportsTable({ user, notify, onMutated, onConnError, initialStatus }) {
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
  const [query, setQuery] = useState({ q: '', type: '', status: initialStatus ?? '', date_from: '', date_to: '', sort: 'incident_datetime', dir: 'desc', page: 1 });
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
      <div className="ir-page-head">
        <h1 className="ir-title">{user.role === 'Admin' ? 'ALL REPORTS' : 'MY REPORTS'}</h1>
        <div className="ir-meta">
          <div>
            {pagination
              ? `${pagination.total} REPORT${pagination.total === 1 ? '' : 'S'}`
              : 'LOADING…'}
          </div>
          <div>{showArchived ? 'ARCHIVED RECORDS' : 'ACTIVE RECORDS'}</div>
        </div>
      </div>

      <div className="ir-status">
        <span className="badge draft">{user.role}</span>
        <span>
          {user.role === 'Admin'
            ? 'Every report in the station — search, filter, and sort.'
            : 'The reports you recorded — search, filter, and sort.'}
        </span>
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

      <IrCard
        num="I"
        title="Search & Filter"
        actions={
          <>
            {user.role === 'Admin' && (
              <button type="button" onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? 'Show Active' : 'Show Archived'}
              </button>
            )}
            {/* Export honors the CURRENT filters (the server reuses the same
                query pipeline) — what you see is what you get. */}
            <a
              className="button-link"
              href={(() => {
                const params = new URLSearchParams();
                for (const [k, v] of Object.entries(showArchived ? { archived: '1' } : query)) {
                  if (v !== '' && !(k === 'page' && v === 1)) params.set(k, String(v));
                }
                if (showArchived) params.set('archived', '1');
                const qs = params.toString();
                return `/api/v1/reports/export${qs ? `?${qs}` : ''}`;
              })()}
              download="bluewrite-reports.csv"
            >
              Export CSV
            </a>
          </>
        }
      >
        {/* ONE row: search, then every filter. It wraps only when the viewport
            genuinely cannot hold the controls (see .reports-toolbar-row). */}
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
                  placeholder="Search complainant, victim, suspect, place, narrative, officer…"
                  aria-label="Search reports by complainant, victim, suspect, place, narrative, or officer"
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
                <option value="submitted">Submitted</option>
                <option value="finalized">Finalized</option>
                {user.role === 'Admin' && <option value="attention">Needs attention (draft + submitted)</option>}
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
      </IrCard>

      <IrCard
        num="II"
        wide
        flush
        title={`Report Register${pagination ? ` — ${pagination.total} found` : ''}`}
      >
        {reports && reports.length === 0 && !showArchived && !conn ? (
          <p className="ir-card-empty">
            <strong>No reports found.</strong> Adjust the filters above, or start a new report from Home.
          </p>
        ) : (conn || !reports) && (!reports || reports.length === 0) ? (
          <p className="ir-card-empty">
            {conn ? 'Waiting for the connection to come back…' : 'Loading reports…'}
          </p>
        ) : (
          <>
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
      </IrCard>

      {printingId && (
        <ReportPrint
          reportId={printingId}
          onClose={() => setPrintingId(null)}
          recordedBy={{ name: user.full_name, badge: user.badge_number }}
        />
      )}

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
