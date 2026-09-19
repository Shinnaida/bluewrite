import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// The row menu is portaled to <body>: it is positioned at the pointer, and the
// register's own scroll box would otherwise clip it.
import { createPortal } from 'react-dom';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
import { AI_ADVISORY } from '../lib/appInfo.js';
import ReportPrint from './ReportPrint.jsx';
// The two station seals, for the sheet format's page. The same files the printed
// sheet sets in its header band — already in the bundle, since ReportPrint is
// imported above — so the page and the print-out carry the same marks. See
// ReportPrint's own header for the print side.
import pnpSeal from '../assets/pnp-logo.png';
import citySeal from '../assets/city-of-naga-seal.png';
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
  deriveMirrors,
  syncMirrors,
  hasGroupRows,
} from '../lib/reportRules.js';
import { normalizeLegacyTypeSpecific, hasLegacyShape } from '../lib/normalizeLegacy.js';
// The station's letterhead, for the sheet format's page. Same module the printed
// sheet reads its header through, so the page you write on and the page that
// prints carry the same lines.
import { resolveHeader } from '../lib/stationSettings.js';
// The path → control-id scheme, shared with the review step's second copy of a
// field (see the module: two mounted copies per field is the whole reason it
// exists). REVIEW_FIELD_PREFIX is the string those copies carry.
import {
  REVIEW_FIELD_PREFIX,
  REVIEW_SCALAR_PATHS,
  fieldIdCandidates,
  groupBlockIdCandidates,
  groupItemPath,
  groupKeyVariants,
  incidentDatePart,
  incidentTimePart,
  reviewFieldId,
  reviewRowForPath,
  reviewRowValueId,
  setIncidentDate,
  setIncidentTime,
} from '../lib/reviewFields.js';
import RepeatableGroup from './RepeatableGroup.jsx';
import AiNarrativePanel from './AiNarrativePanel.jsx';
// Phase 6 Stage 4 — the translation review surface: the original beside the
// English, the derived status, and (when the server allows it) the verify /
// dispute form. Same component for the editor and the reviewing officer, since
// a verifier opens the report read-only through the same screen.
import ReportVerificationPanel from './ReportVerificationPanel.jsx';
// Phase 6 Stage 5 Track B — the terminology table as a full panel: browse,
// search, and the approved terms the officer's own text already uses. Offline,
// read-only, and mounted in the editor so it works with the AI switched off.
import NarrativeTermsPanel from './NarrativeTermsPanel.jsx';
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
// Phase 6 Stage 1 — the DECLARED language of the narrative. One module behind
// the selector, the "not translated" notice, the AI guard's reason, the
// finalize warning and the printed line, so the editor and the sheet cannot
// disagree about what a code means.
import {
  narrativeLanguageOptions,
  DEFAULT_LANGUAGE,
  languageHint,
  languageLabel,
  normaliseLanguage,
  untranslatedNotice,
  aiBlockedReason,
  finalizeLanguageWarning,
  suggestedLanguage,
} from '../lib/reportLanguages.js';
// Phase 6 Stage 4 (D5/D8) — the status vocabulary and the finalize notice. The
// server DERIVES the status; these helpers only turn its code into a label, so
// the editor cannot disagree with the list, the sheet or the export.
import {
  statusLabel,
  statusClass,
  hasSource,
  finalizeNotice,
} from '../lib/reportVerification.js';

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
  // Phase 6 Stage 1 (migration 007) — the language the NARRATIVE is written
  // in, DECLARED by the officer. A new report starts here and D7 pre-selects
  // the officer's last-used language over it; an existing report always shows
  // its own stored value.
  narrative_language: DEFAULT_LANGUAGE,
  status: 'draft',
  type_specific: {},
};

// The built-in 14, used when the station has not configured its own list (or
// when the read failed). The station's list arrives as the `incidentTypes` prop
// and wins when it has entries: the server validates a submitted type against
// that same setting (Station::incidentTypes), so a form still offering a type
// the station no longer records produces a report the API refuses to accept.
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
            background: 'var(--panel-raised)',
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
 *
 * `step` marks the card as the Write Report progress stepper's anchor for that
 * section, so clicking a dot has something stable to scroll to (a section's
 * fields have stable ids, but the card that contains them does not).
 *
 * `current` marks the card as one the officer's CURRENT step owns, which tints
 * its header bar and runs an accent down its left edge. A step is one card or
 * several (step 4 is Parties Involved *and* the per-type block; step 5 is
 * three cards) and nothing else on the page says which cards belong together —
 * so the rail's emphasis is repeated here, where the work is. It is a read-out,
 * never a gate: a card that is not current stays fully editable.
 *
 * `onFocus` / `onBlur` are forwarded to the section so a card can report that
 * the officer has been IN it (React delegates both, so they bubble up from any
 * field inside) — the progress stepper's visit signal. The card is the unit
 * because a section is a card (or two), never a list of fields.
 *
 * `hidden` is how the stepped form format hides a panel the officer is not on.
 * It hides — it never unmounts — because the error jumps resolve by element id
 * and a field outside the DOM cannot be focused (see ReportEditor.jumpTo).
 */
function IrCard({
  num,
  title,
  children,
  wide,
  flush,
  actions,
  headless,
  step,
  current,
  onFocus,
  onBlur,
  hidden,
  // This is the card the SHEET format draws as the page itself — the writing
  // surface the format opens on. One card carries it (the narrative), and the
  // blank state keys its "hide everything else" rule on the marker rather than
  // on a step number or a title, so moving the writing area would move the
  // marker with it instead of silently leaving the page blank for the wrong
  // card. See the sheet section in incident-report.css.
  sheetPage,
}) {
  return (
    <section
      className={`ir-card${wide ? ' ir-card--wide' : ''}${current ? ' ir-card--current' : ''}${
        sheetPage ? ' ir-card--sheet-page' : ''
      }`}
      data-ir-step={step}
      /* The card you are on is the one your step owns — readable to assistive
         tech, not only to the eye. */
      aria-current={current ? 'true' : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
      hidden={hidden}
    >
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

// ---- Which copy of a field a lookup means -----------------------------
// In the stepped format every panel the officer is NOT on carries the `hidden`
// attribute (IrCard ← panelHidden), so while the review step is on screen the
// form's copy of a field is present but INVISIBLE — and the review holds a
// second, editable copy of the same field. getElementById and querySelector
// return whichever copy comes first in the document, which is the hidden one, so
// every lookup below prefers a USABLE match: only the copy the officer can
// actually see and throw a highlight at. Falling back to a hidden element keeps
// the document format — one copy, nothing hidden — behaving exactly as before.
function isUsable(el) {
  return Boolean(el) && !el.closest('[hidden]');
}

function firstUsable(elements) {
  return elements.find(isUsable) ?? elements.find(Boolean) ?? null;
}

/** The input that holds a field, in whichever copy is on screen. */
function findControl(path) {
  const ids = [...fieldIdCandidates(path), ...fieldIdCandidates(path, REVIEW_FIELD_PREFIX)];
  return firstUsable(ids.map((id) => document.getElementById(id)));
}

// Resolve a groupKey to its RepeatableGroup section, tolerating the plural /
// singular spellings different groups are declared with, and preferring the copy
// on screen (the review's group block, when the review is what is showing).
function groupSection(groupKey) {
  for (const variant of groupKeyVariants(groupKey)) {
    const found = firstUsable([...document.querySelectorAll(`[data-group="${variant}"]`)]);
    if (found) return found;
  }
  // Last resort: the block's own id. RepeatableGroup always writes both, so this
  // only fires for a block that lost the attribute — it costs one query and it
  // keeps the id half of the scheme reachable from the resolver instead of
  // living only in the module's tests.
  const ids = [
    ...groupBlockIdCandidates(groupKey),
    ...groupBlockIdCandidates(groupKey, REVIEW_FIELD_PREFIX),
  ];
  return firstUsable(ids.map((id) => document.getElementById(id)));
}

// Resolve a rule-engine error path to { el, section, level }.
//   "vehicles[0].driver_name" -> that exact input (level 'field')
//   "vehicles"                -> the WHOLE group (level 'group'): a count-floor
//                                error has no field to point at, so the target
//                                is the first flagged field, else the "+ Add"
//                                button that fixes it.
//
// The path → id scheme itself lives in src/lib/reviewFields.js — including the
// alias table, the type-field `ts-` prefix and the group-row spellings — because
// the review renders a SECOND copy of these controls and the two halves have to
// agree on the ids. That agreement is unit-tested; the search for the visible
// copy is not, which is why the ids are not spelled here.
function resolveTarget(key) {
  const item = groupItemPath(key);
  if (item) {
    const el = findControl(key);
    if (el) {
      return { el, section: groupSection(item.groupKey) || el.closest('.rep-group'), level: 'field' };
    }
    const section = groupSection(item.groupKey);
    return section ? { el: section, section, level: 'group' } : null;
  }

  const section = groupSection(key);
  if (section) {
    const flagged = section.querySelector('[aria-invalid="true"]');
    const el = flagged || section.querySelector('.rep-add') || section;
    return { el, section, level: 'group' };
  }

  const el = findControl(key);
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

// Scroll a stepper section into view — the same smooth scroll + flash the
// error jumps use, aimed at a whole section instead of one field. A section is
// one card or several (the type-specific one is the Parties Involved groups
// plus the per-type field block), so ALL of its cards carry `data-ir-step`:
// the first is the scroll target, and every one of them flashes, which is what
// makes the section's extent visible instead of implying the jump landed on a
// lone card. Purely a scroll: it never validates, locks or changes the draft,
// and a section whose cards are not mounted is a silent no-op, not a crash.
function scrollToSection(step) {
  const cards = document.querySelectorAll(`[data-ir-step="${step}"]`);
  if (cards.length === 0) return;
  // Flash first, scroll last: flashTarget forces a synchronous reflow, and
  // doing that while the smooth scroll animates is asking for trouble.
  for (const card of cards) flashTarget(card);
  cards[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
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
// `idPrefix` is how the review step's second copy of these controls stays
// distinct from the form's: the form passes nothing, the review passes
// REVIEW_FIELD_PREFIX (see src/lib/reviewFields.js, which owns the scheme).
function TypeSpecificFields({ incidentType, values, onChange, disabled, errors, idPrefix = '' }) {
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
        const id = `${idPrefix}ts-${fld.key}`;
        const val = values?.[fld.key] ?? '';
        const set = (v) => onChange(fld.key, v);
        // Auto-filled from a group that HOLDS a row (see `mirrorOf`): the
        // officer types the fact once, in the list above, and this row only
        // shows what the sheet will carry. With the group empty the field is
        // asked for directly instead — which is how a single "Item" still
        // states "None taken — the attempt was interrupted" — so the control
        // stays exactly as it was and nothing here is a dead end.
        const mirrored = !!fld.mirrorOf && hasGroupRows(values, fld.mirrorOf.group);
        if (mirrored) {
          const source = GROUP_CONFIG[incidentType]?.[fld.mirrorOf.group]?.label
            ?? 'the list above';
          return (
            <div className="field" key={fld.key}>
              {/* No htmlFor: this is not a control, it is a read-out of the
                  row above, and pointing a label at it would announce an
                  editable field that does not exist. */}
              <label>{fld.label}</label>
              <div className="ir-readonly" id={id} aria-readonly="true">
                {String(val).trim() !== '' ? val : '—'}
              </div>
              <p className="field-hint">Auto-filled from {source} — edit it there.</p>
            </div>
          );
        }
        // Required for THIS incident type (TYPE_FIELDS), including the ones that
        // only become required while their controlling field says so. The rule
        // engine is the authority; this only marks and reports it.
        const isRequired = fld.required === true || fld.requireWhenShown === true;
        const problem = errors?.[`type_specific.${fld.key}`];
        const label = (
          <label htmlFor={id}>
            {fld.label}
            {isRequired ? <span className="req"> *</span> : null}
          </label>
        );
        const problemLine = problem ? <div className="error">{problem}</div> : null;
        const common = {
          id,
          'aria-required': isRequired || undefined,
          'aria-invalid': problem ? true : undefined,
        };
        if (fld.select) {
          return (
            <div className="field" key={fld.key}>
              {label}
              <select {...common} value={val} onChange={(e) => set(e.target.value)} disabled={disabled}>
                <option value="">Select…</option>
                {fld.select.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              {problemLine}
            </div>
          );
        }
        if (fld.textarea) {
          return (
            <div className="field span-2" key={fld.key}>
              {label}
              <textarea {...common} rows={3} value={val} onChange={(e) => set(e.target.value)} disabled={disabled} />
              {problemLine}
            </div>
          );
        }
        return (
          <div className="field" key={fld.key}>
            {label}
            <input
              {...common}
              type={fld.date ? 'date' : fld.time ? 'time' : 'text'}
              value={val}
              onChange={(e) => set(e.target.value)}
              disabled={disabled}
            />
            {problemLine}
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// The Write Report progress stepper
//
// The document's five sections, in reading order. A section is complete when
// the finalize rule set already reports no problem for the paths it owns: the
// stepper is a read-out of `validateReport`, never a second validator, so it
// cannot disagree with the red banner, the inline errors or Gate 2.
// ===========================================================================
const STEPPER_STEPS = [
  {
    label: 'Reporting party',
    // Panel I, plus the officer initials typed in Panel IV.
    paths: [
      'reporter_name',
      'reporter_id_no',
      'reporter_contact',
      'reporter_email',
      'reporter_address',
      'officer_initials',
    ],
  },
  { label: 'Incident details', paths: ['incident_type', 'incident_datetime', 'location'] },
  { label: 'Narrative', paths: ['narrative'] },
  // The polymorphic section: the repeatable groups (a bare key like `vehicles`
  // or a per-item path like `vehicles[2].plate_number`) plus any per-type
  // scalar path. Checked against the type chosen NOW, so a group that does not
  // exist for this type can never count against it.
  { label: 'Type-specific', paths: [], typeSpecific: true },
  { label: 'Action & signatures', paths: ['action_taken', 'ioc_name'] },
];

// Index of the polymorphic section above, named so the bucketing reads itself
// out rather than repeating `findIndex`.
const STEPPER_TYPE_SPECIFIC = 3;

// The stepped format's FINAL step: the same five sections read back as one
// read-only document, with the commit cluster under it. It is a step, not a
// sixth section — nothing in the rule engine speaks for it, so it can never be
// "complete" and the five dots go on carrying all the completion. (The document
// format has no review step: there the whole form is already one scroll, and
// Submit puts the official sheet up before locking anything.)
const REVIEW_STEP = STEPPER_STEPS.length;
const REVIEW_LABEL = 'Review';
const STEP_COUNT = STEPPER_STEPS.length + 1;

/** True when the officer has typed something into any of these keys. */
function anyFilled(draft, keys) {
  return keys.some((k) => String(draft?.[k] ?? '').trim() !== '');
}

/**
 * True when the type_specific blob holds any value at all — a scalar or a row
 * of a group. The second signal that an all-optional section has been worked
 * on (see computeStepProgress): a reopened report shows its reporter fields and
 * its per-type block already filled, and requiring a fresh visit before the
 * dots admit that would be the stepper lying about a report it can read.
 */
function typeSpecificHasContent(draft) {
  const ts = draft?.type_specific ?? {};
  return Object.values(ts).some((v) =>
    Array.isArray(v)
      ? v.some((item) => Object.values(item ?? {}).some((x) => String(x ?? '').trim() !== ''))
      : String(v ?? '').trim() !== '',
  );
}

/** The stepper section a rule-engine error path belongs to, or -1 for none. */
function stepperSectionForPath(path, incidentType) {
  const named = STEPPER_STEPS.findIndex((s) => s.paths.includes(path));
  if (named !== -1) return named;
  // Per-type scalars (notable findings included) are written into the
  // type_specific blob; groups arrive as a bare key or as `key[i].field`.
  if (path.startsWith('type_specific.')) return STEPPER_TYPE_SPECIFIC;
  const groupKey = path.replace(/\[\d+\].*$/, '');
  if (GROUP_CONFIG[incidentType]?.[groupKey]) return STEPPER_TYPE_SPECIFIC;
  return -1;
}

/**
 * Bucket the finalize rule set's errors into the five sections and decide
 * which one is current. Pure, and cheap enough to derive on every render —
 * which is what keeps the dots as live as the red banner while typing.
 *
 * @param {object} draft
 * @param {Set<number>} visited  sections the officer has been in. The only
 *   thing the rules cannot tell us about an all-optional section.
 * @returns {{complete: boolean[], current: number}}
 */
function computeStepProgress(draft, visited) {
  const { errors } = validateReport(draft, 'finalize');
  const flagged = STEPPER_STEPS.map(() => 0);
  for (const e of errors) {
    const i = stepperSectionForPath(e.path, draft.incident_type);
    if (i !== -1) flagged[i] += 1;
  }

  const complete = STEPPER_STEPS.map((_, i) => {
    if (flagged[i] > 0) return false;
    // Two sections read "no problems" without anything having been filled in,
    // so the rules alone would call them finished, and neither is:
    //   - section 1 is all-optional: a blank card is valid but not filled;
    //   - the type-specific section has no completeness signal of its own on a
    //     type whose groups are ALL optional and whose scalars are unrequired
    //     (Drug-Related Incident) — every other type is caught by a count
    //     floor, but that one would read done the moment a type was chosen.
    // Both therefore need the officer to have engaged with them, and the
    // type-specific one additionally needs a type to exist at all.
    // "Engaged": the officer has been in the section OR has filled something
    // in it. Both are honest signals, and either one alone is wrong — visiting
    // is all a blank section ever offers, and filling is all a reopened report
    // ever offers. Neither can rescue a section that is genuinely flagged.
    if (i === 0) return visited.has(i) || anyFilled(draft, STEPPER_STEPS[i].paths);
    if (i === STEPPER_TYPE_SPECIFIC) {
      return Boolean(draft.incident_type) && (visited.has(i) || typeSpecificHasContent(draft));
    }
    return true;
  });

  // The current step is the first section still open — and the last one, fully
  // filled, once every section is complete.
  const firstOpen = complete.indexOf(false);
  return { complete, current: firstOpen === -1 ? STEPPER_STEPS.length - 1 : firstOpen };
}

// The "done" tick — inline, like every other icon on this screen.
const StepperCheck = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 12.5 4.6 4.6L19 6.8" />
  </svg>
);

// The review node's glyph: a page, because that step is the report read back as
// one document. Same inline-SVG treatment as the tick.
const StepperReview = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z" />
    <path d="M14 3.5V8h4.5M9.5 12.5h6M9.5 16.5h6" />
  </svg>
);

/**
 * The progress stepper: one hairline track behind five dots, filled up to the
 * current section, with an uppercase label under each dot.
 *
 * It is a progress read-out and a jump-nav, NOT a wizard: the form stays one
 * long scroll, every section stays editable in any order, and clicking a dot
 * only scrolls — it never validates, locks or touches `draft`.
 *
 * Emphasis follows the officer: in the stepped format it lands on the panel on
 * screen (`here`), and in the document format on the first open section
 * (`current`), because there is no panel to be on. The dots' faces — tick or
 * empty ring — always mean completeness and never move with position. */
function ReportProgressStepper({ complete, current, onJump, withReview = false, here = null }) {
  // Two channels, kept strictly independent — that separation IS the design:
  //   FACE = completeness. The tick or the empty ring, identical in both
  //          formats, and the only thing that ever answers "is this finished?".
  //   RING = the node the officer is STANDING ON. The stepped format shows one
  //          panel at a time, so the emphasis has to follow the panel on screen;
  //          the document format has no steps, so there it falls back to the
  //          first open section — "the work", the closest thing one long scroll
  //          has to a position.
  // `here` is that node's index, or null in the document format.
  const nodes = STEPPER_STEPS.map((step, i) => ({
    label: step.label,
    face: complete[i] ? 'done' : 'pending',
    here: here === null ? i === current && !complete[i] : here === i,
  }));
  if (withReview) {
    // The review node is never done (no field fills it in), so its face is
    // always the empty ring; it is emphasised while the officer is on it.
    nodes.push({ label: REVIEW_LABEL, face: 'pending', here: here === REVIEW_STEP, review: true });
  }
  const count = nodes.length;
  const allDone = complete.every(Boolean);
  // Filled to the current section — and through to the review node once every
  // section is done, because THAT is the "nothing left to fill" signal: a
  // finished report is the one whose track is fully blue.
  const filled = withReview && allDone ? current + 1 : current;
  // The track is inset by half a column so it starts and ends at the centre of
  // the first and last node; the fill is therefore a fraction of the gaps
  // between them, not of the nodes. Both come from the node count so the
  // stylesheet never has to know how many there are.
  const style = {
    '--ir-stepper-fill': `${(filled / (count - 1)) * 100}%`,
    '--ir-stepper-inset': `${50 / count}%`,
    '--ir-stepper-dots': count,
  };
  return (
    <div className="ir-stepper">
      <div className="ir-stepper-head">
        {/* The document's own display face and ink, like .ir-title: this is
            part of the report, not browser chrome. */}
        <span className="ir-stepper-caption">Report completion</span>
        {/* The count follows the emphasis, always: sections in the document
            format (the first one still open), steps in the stepped format (the
            panel on screen, review included). A head that disagreed with the
            dot it sits above is exactly the bug this replaced. */}
        <span className="ir-stepper-count">
          {here === null
            ? `Section ${current + 1} of ${STEPPER_STEPS.length}`
            : `Step ${here + 1} of ${count}`}
        </span>
      </div>
      {/* The variables live on the RAIL, not on the list: the track is the
          list's sibling, and a custom property only reaches descendants. */}
      <div className="ir-stepper-rail" style={style}>
        <div className="ir-stepper-track" aria-hidden="true">
          <span className="ir-stepper-track-fill" />
        </div>
        <ol className="ir-stepper-steps">
          {nodes.map((step, i) => {
            const { face } = step;
            return (
              <li className="ir-stepper-step" key={step.label}>
                {/* Dot and label are one button: the label is the accessible
                    name, the number is a picture of position. */}
                <button
                  type="button"
                  className={step.here ? 'ir-stepper-node ir-stepper-node--here' : 'ir-stepper-node'}
                  onClick={() => onJump(i)}
                  aria-current={step.here ? 'step' : undefined}
                  title={`Go to ${step.label}`}
                >
                  <span className={`ir-stepper-dot ir-stepper-dot--${face}`} aria-hidden="true">
                    {face === 'done' ? StepperCheck : step.review ? StepperReview : i + 1}
                  </span>
                  <span className={`ir-stepper-label ir-stepper-label--${face}`}>
                    {step.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ===========================================================================
// The review step (stepped format): the whole report as ONE document
//
// The last step reads the five sections back — label over value, exactly like
// the form's own fields with the controls taken away — so the officer checks
// what they wrote in one scroll before the report is committed. The recap is
// derived from `draft` on every render, so it is never stale.
//
// It is also EDITABLE, one row at a time. The value of a row the officer can
// change is a button; opening it swaps that single value for the control the
// form uses for the field — focused and ready — and Escape, that row's Done
// chip, another row, or a step change puts the read-back back. (A blur does NOT:
// see ReviewFieldEditor — closing re-flows the document under the pointer, which
// is how a click aimed at Submit lands on something else.) Only the OPEN row has
// a second control on screen,
// which is what keeps this a read-back rather than a second form, and it is why
// those controls carry prefixed ids (see src/lib/reviewFields.js): the form's
// copy of every one of these fields is mounted, hidden, right behind them.
//
// Nothing here writes anything itself. The setters it is handed are the
// editor's own, so an edit made from the review is an ordinary edit to the
// draft: same dirty flag, same autosave, same exit and sign-out flush, same
// rule engine, same history.
//
// It shows what will be RECORDED, which is why the per-type block lists only
// the fields that carry a value (blank is absent in this system — see
// TypeSpecificFields) while the sections whose fields are required spell out
// "Not provided" instead of quietly omitting them.
// ===========================================================================

// What the review's single-line editors need to carry to match the form's own
// control for the field — input type, placeholder, autocomplete. The select and
// the two textareas are built in ReviewFieldEditor instead, because each of them
// needs more than an input tag; these are the plain ones.
const REVIEW_INPUTS = {
  reporter_name: { autoComplete: 'name', placeholder: 'Last Name, First Name, M.I.' },
  reporter_id_no: { placeholder: 'e.g. N01-23-456789' },
  reporter_contact: { type: 'tel', autoComplete: 'tel', placeholder: '(000) 000-0000' },
  reporter_email: { type: 'email', autoComplete: 'email', placeholder: 'name@example.com' },
  reporter_address: {
    autoComplete: 'street-address',
    placeholder: 'Street, barangay, city / municipality',
  },
  location: { placeholder: 'Specific address or intersection' },
  ioc_name: { placeholder: 'Name of the officer handling the case' },
  officer_initials: { placeholder: 'e.g. J.D.C.', maxLength: 12 },
};

/**
 * The control the review swaps in for one row's read-back value. It mirrors the
 * form's control for the same field — same input type, placeholder and
 * autocomplete — because the officer is editing the same value from the other
 * end of the flow, and an editor that looked different would read as a second,
 * unrelated form.
 *
 * `edit` is the editor's own kit (setters, errors, which row is open); see
 * `reviewEdit` in ReportEditor for what it carries and why.
 */
function ReviewFieldEditor({ rowPath, label, edit }) {
  const { draft, errors, set, changeType, setNarrative, setActionTaken, endEdit, types = TYPES } = edit;
  const id = reviewFieldId(rowPath);
  const ref = useRef(null);

  // Focus WITHOUT scrolling: a click already put the row where the officer can
  // see it, and an error jump does its own scroll + flash (see focusField).
  // Scrolling here as well would fight it.
  useEffect(() => {
    ref.current?.focus?.({ preventScroll: true });
  }, []);

  // Escape closes the row and hands focus back to the value it was opened from
  // (see endEdit). It stops there, deliberately: the AI panel and the profile
  // menu both close on Escape at the window, and the innermost thing wins.
  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    endEdit(rowPath, { refocus: true });
  }

  // A blur does NOT close the row. Closing is a re-flow — the editor's control
  // goes back to being a line of text — and doing that while the officer is
  // reaching for something BELOW (Save Draft, Submit, Print) moves that control
  // out from under the pointer between mousedown and mouseup. The click is then
  // swallowed, or lands on whatever moved into its place, and an action the
  // officer never aimed at fires. So the row closes on Escape, on the Done chip
  // below, on opening another row, or on leaving the Review step — never on a
  // blur. Nothing is pending while it is open, so there is nothing to lose by
  // leaving it open.
  const shell = (children) => (
    <div className="ir-review-editor" onKeyDown={onKeyDown}>
      {children}
      <button
        type="button"
        className="ir-review-done"
        onClick={() => endEdit(rowPath, { refocus: true })}
      >
        Done
      </button>
    </div>
  );
  const errorFor = (path) => (errors[path] ? <div className="error">{errors[path]}</div> : null);

  if (rowPath === 'incident_type') {
    return shell(
      <>
        <select
          ref={ref}
          id={id}
          value={draft.incident_type}
          onChange={(e) => changeType(e.target.value)}
          aria-label={label}
          aria-invalid={!!errors.incident_type}
        >
          <option value="">Select type…</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {errorFor('incident_type')}
      </>,
    );
  }

  if (rowPath === 'incident_datetime') {
    // The pair and its qualifier open and close together: they are one printed
    // line and one thing to get right, and the checkbox has to be reachable
    // from here because this is the only place it is rendered in the review.
    // The DATE half carries the row's id — the id scheme names
    // `incident_datetime` as the date control (see FORM_FIELD_ALIASES) — and the
    // checkbox carries the id its own rule path resolves to, so an error jump
    // for either lands on the right control.
    return shell(
      <>
        <div className="ir-datetime">
          <div>
            <label className="sr-only" htmlFor={id}>Date</label>
            <input
              ref={ref}
              id={id}
              type="date"
              className="picker-field"
              value={incidentDatePart(draft.incident_datetime)}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) =>
                set('incident_datetime', setIncidentDate(draft.incident_datetime, e.target.value))
              }
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not openable */ } }}
              onFocus={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not openable */ } }}
              aria-label="Date of incident"
              aria-invalid={!!errors.incident_datetime}
            />
          </div>
          <div>
            <label className="sr-only" htmlFor={`${id}-time`}>Time</label>
            <input
              id={`${id}-time`}
              type="time"
              className="picker-field"
              value={incidentTimePart(draft.incident_datetime)}
              onChange={(e) =>
                set('incident_datetime', setIncidentTime(draft.incident_datetime, e.target.value))
              }
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not openable */ } }}
              onFocus={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not openable */ } }}
              aria-label="Time of incident"
              aria-invalid={!!errors.incident_datetime}
            />
          </div>
        </div>
        <label className="ir-approx" htmlFor={reviewFieldId('incident_time_approximate')}>
          <input
            id={reviewFieldId('incident_time_approximate')}
            type="checkbox"
            checked={!!draft.incident_time_approximate}
            onChange={(e) => set('incident_time_approximate', e.target.checked)}
          />
          <span>Time is approximate (e.g. “around 1:00 A.M.”)</span>
        </label>
        {errorFor('incident_datetime')}
      </>,
    );
  }

  const spec = REVIEW_INPUTS[rowPath];
  if (spec) {
    return shell(
      <>
        <input
          ref={ref}
          id={id}
          {...spec}
          value={draft[rowPath] || ''}
          onChange={(e) => set(rowPath, e.target.value)}
          aria-label={label}
          aria-invalid={!!errors[rowPath]}
        />
        {errorFor(rowPath)}
      </>,
    );
  }

  // Narrative and Action Taken are the two multi-line fields, and each carries a
  // side-effect the bare setter does not: the narrative's provenance tag, and
  // dropping the AI's undo offer for the disposition text it rewrote. Hence
  // their own setters — the same ones the form's fields call, so the two copies
  // write the field identically.
  if (rowPath === 'narrative' || rowPath === 'action_taken') {
    const isNarrative = rowPath === 'narrative';
    return shell(
      <>
        <textarea
          ref={ref}
          id={id}
          rows={isNarrative ? 8 : 4}
          value={draft[rowPath] || ''}
          onChange={(e) => (isNarrative ? setNarrative : setActionTaken)(e.target.value)}
          aria-label={label}
          aria-invalid={!!errors[rowPath]}
          placeholder={
            isNarrative
              ? 'Describe the incident in chronological order. Include suspect description, witness information, and any property damage or injuries.'
              : 'e.g. Subject turned over to the station for proper disposition. Follow-up investigation ongoing.'
          }
        />
        {errorFor(rowPath)}
      </>,
    );
  }

  return null;
}

/**
 * One labeled line of the review: the field's label, then its value.
 *
 * A row with a `path` is one the officer can edit, and its value becomes a
 * button that opens the editor IN PLACE — the read-back keeps its shape and
 * loses the box again on close. A row without one stays plain text: that is how
 * the derived read-outs (Badge No., the signed name, the submit timestamp) and
 * a finalized report — where `canEdit` is false — keep offering no edit that
 * could not be saved.
 */
function ReviewRow({ label, value, wide, required, path, edit }) {
  const text = String(value ?? '').trim();
  const editable = Boolean(path && edit?.canEdit);
  const rowClass = wide ? 'ir-review-row ir-review-row--wide' : 'ir-review-row';

  if (editable && edit.editingRow === path) {
    return (
      <div className={rowClass}>
        <div className="ir-review-key">{label}</div>
        <ReviewFieldEditor rowPath={path} label={label} edit={edit} />
      </div>
    );
  }

  // Blank AND required is why the report cannot be submitted, so it must not
  // read like the ordinary blank the sheet simply omits. Blank and optional is
  // that ordinary blank. The row is still openable either way — a missing
  // required value is the one an officer most wants to fix from here.
  const stateClass = text ? '' : required ? ' ir-review-value--missing' : ' ir-review-value--empty';
  const shown = text || (required ? 'Required — not provided' : 'Not provided');

  return (
    <div className={rowClass}>
      <div className="ir-review-key">{label}</div>
      {editable ? (
        <button
          type="button"
          id={reviewRowValueId(path)}
          className={`ir-review-value${stateClass} ir-review-value--editable`}
          // Opening on the PRESS as well as the click: a click on another row's
          // value would otherwise be dispatched after this row's blur has closed
          // the editor, by which time the row being clicked has moved — the
          // browser then dispatches it on an ancestor and the officer's click
          // does nothing. Opening on mousedown means the switch has already
          // happened before anything moves. The click handler is what serves a
          // keyboard: Enter and Space never fire mousedown.
          onMouseDown={(e) => {
            if (e.button === 0) edit.beginEdit(path);
          }}
          onClick={() => edit.beginEdit(path)}
          title={`Edit — ${label}`}
        >
          {shown}
        </button>
      ) : (
        <div className={`ir-review-value${stateClass}`}>{shown}</div>
      )}
    </div>
  );
}

/**
 * A section's heading inside the review: its number and name, and — when the
 * stepper still has it open — a way back to the fields that need it. The flag
 * only navigates: it never validates or edits.
 */
function ReviewHeading({ index, complete, onGoToSection }) {
  return (
    <div className="ir-review-head">
      <span className="ir-review-num">{index + 1}</span>
      <span className="ir-review-title">{STEPPER_STEPS[index].label}</span>
      {!complete[index] && (
        <button type="button" className="ir-review-flag" onClick={() => onGoToSection(index)}>
          Needs attention
        </button>
      )}
    </div>
  );
}

function ReportReview({ draft, user, complete, onGoToSection, edit }) {
  const type = draft.incident_type;
  // Every editable row needs the same two props (the path it edits, and the
  // editor's kit); naming them once keeps the rows below reading like the
  // document they describe rather than like a form definition.
  const editable = (path) => ({ path, edit });
  // Same normalisation the print sheet does: an old single-party record is read
  // through the v3 group shape, so the recap describes what the report will
  // actually record rather than the legacy blob it was stored as.
  const ts = useMemo(() => {
    const raw = draft.type_specific ?? {};
    return hasLegacyShape(raw) ? normalizeLegacyTypeSpecific(raw, type, draft) : raw;
  }, [draft, type]);

  const groups = Object.entries(GROUP_CONFIG[type] ?? {});
  const valueOf = (fld) => String(ts?.[fld.key] ?? '').trim();
  const isRequired = (fld) => fld.required === true || fld.requireWhenShown === true;
  // showIf is honoured here exactly as the form honours it: a dependent field
  // whose controller is blank is not part of this report at all.
  const shownTypeFields = (TYPE_FIELDS[type] ?? []).filter(
    (fld) => !fld.showIf || fld.showIf.values.includes(ts?.[fld.showIf.key] ?? ''),
  );
  const filledTypeFields = shownTypeFields.filter((fld) => valueOf(fld) !== '');
  // Blank AND required: the report cannot be submitted until these exist, and a
  // recap that silently omitted them would be showing the officer a complete
  // looking report whose Submit button refuses to work.
  const missingTypeFields = shownTypeFields.filter((fld) => isRequired(fld) && valueOf(fld) === '');
  // Blank and NOT required: what the sheet leaves out, offered as a checklist.
  // Advisory only — nothing here can block a submission, and the money fields
  // live here on purpose: a value nobody knows yet is not a missing fact.
  const advisoryTypeFields = shownTypeFields.filter((fld) => !isRequired(fld) && valueOf(fld) === '');
  const notable = String(ts?.notable_findings ?? '').trim();
  const when = draft.incident_datetime
    ? `${fmtIncident(draft.incident_datetime)}${draft.incident_time_approximate ? ' (approximate)' : ''}`
    : '';
  const open = complete.filter((c) => !c).length;

  return (
    <div className="ir-review">
      <p className="ir-review-note">
        {open === 0
          ? 'Every section is complete. Read the report back below, then submit it.'
          : `${open} of ${STEPPER_STEPS.length} sections still need attention — jump to one from its heading.`}
        {/* Said once, here, rather than hinted at on every row: the read-back
            has to stay a document, and the officer only needs telling once that
            a value can be opened. */}
        {edit?.canEdit && (
          <span className="ir-review-hint">
            Click any value to change it here, without leaving the review. Esc closes the field.
          </span>
        )}
      </p>

      <section className="ir-review-section">
        <ReviewHeading index={0} complete={complete} onGoToSection={onGoToSection} />
        <div className="ir-review-rows">
          <ReviewRow label="Full Name" value={draft.reporter_name} {...editable('reporter_name')} />
          <ReviewRow
            label="Identification / Driver’s License No."
            value={draft.reporter_id_no}
            {...editable('reporter_id_no')}
          />
          <ReviewRow
            label="Contact Number"
            value={draft.reporter_contact}
            {...editable('reporter_contact')}
          />
          <ReviewRow label="Email Address" value={draft.reporter_email} wide {...editable('reporter_email')} />
          <ReviewRow
            label="Home Address"
            value={draft.reporter_address}
            wide
            {...editable('reporter_address')}
          />
        </div>
      </section>

      <section className="ir-review-section">
        <ReviewHeading index={1} complete={complete} onGoToSection={onGoToSection} />
        <div className="ir-review-rows">
          <ReviewRow label="Type of Incident" value={type} required {...editable('incident_type')} />
          <ReviewRow
            label="Date &amp; Time of Occurrence"
            value={when}
            required
            {...editable('incident_datetime')}
          />
          <ReviewRow
            label="Location of Incident"
            value={draft.location}
            wide
            required
            {...editable('location')}
          />
        </div>
      </section>

      <section className="ir-review-section">
        <ReviewHeading index={2} complete={complete} onGoToSection={onGoToSection} />
        <div className="ir-review-rows">
          <ReviewRow
            label="Detailed Description of Events"
            value={draft.narrative}
            wide
            required
            {...editable('narrative')}
          />
        </div>
      </section>

      <section className="ir-review-section">
        <ReviewHeading index={3} complete={complete} onGoToSection={onGoToSection} />
        {!type ? (
          <div className="ir-review-value ir-review-value--empty">
            No incident type chosen yet, so there are no type-specific details to show.
          </div>
        ) : (
          <div className="ir-review-rows">
            {groups.map(([groupKey, cfg]) => {
              const items = Array.isArray(ts?.[groupKey]) ? ts[groupKey] : [];
              return (
                <div className="ir-review-block" key={groupKey}>
                  <div className="ir-review-block-head">
                    {cfg.label}
                    <span className="ir-review-count">
                      {items.length} {items.length === 1 ? 'record' : 'records'}
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <div className="ir-review-value ir-review-value--empty">None recorded</div>
                  ) : (
                    items.map((item, i) => {
                      const filled = (cfg.itemSchema ?? []).filter(
                        (fld) => String(item?.[fld.key] ?? '').trim() !== '',
                      );
                      return (
                        <div className="ir-review-item" key={i}>
                          <span className="ir-review-item-n">{i + 1}</span>
                          <span className="ir-review-item-body">
                            {filled.length === 0 ? (
                              <span className="ir-review-value--empty">Blank entry</span>
                            ) : (
                              filled.map((fld) => (
                                <span className="ir-review-pair" key={fld.key}>
                                  <span className="ir-review-pair-k">{fld.label}</span>
                                  <span className="ir-review-pair-v">
                                    {String(item[fld.key]).trim()}
                                  </span>
                                </span>
                              ))
                            )}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}

            {(filledTypeFields.length > 0 || missingTypeFields.length > 0) && (
              <div className="ir-review-block">
                <div className="ir-review-block-head">
                  {BLOCK_HEADINGS[type] ?? 'Incident Details'}
                  {missingTypeFields.length > 0 && (
                    <span className="ir-review-count ir-review-count--required">
                      {missingTypeFields.length} still required
                    </span>
                  )}
                </div>
                <div className="ir-review-rows">
                  {/* What is missing leads, because it is what the Submit button
                      is waiting for. */}
                  {missingTypeFields.map((fld) => (
                    <ReviewRow
                      key={fld.key}
                      label={fld.label}
                      value=""
                      wide={Boolean(fld.textarea)}
                      required
                    />
                  ))}
                  {filledTypeFields.map((fld) => (
                    <ReviewRow
                      key={fld.key}
                      label={fld.label}
                      value={ts?.[fld.key]}
                      wide={Boolean(fld.textarea)}
                    />
                  ))}
                </div>
              </div>
            )}

            {notable && <ReviewRow label="Notable Findings" value={notable} wide />}

            {advisoryTypeFields.length > 0 && (
              <p className="ir-review-advisory">
                <span className="ir-review-advisory-label">Worth adding:</span>{' '}
                {advisoryTypeFields.map((fld) => fld.label).join(' · ')}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="ir-review-section">
        <ReviewHeading index={4} complete={complete} onGoToSection={onGoToSection} />
        <div className="ir-review-rows">
          <ReviewRow
            label="Action Taken / Status"
            value={draft.action_taken}
            wide
            required
            {...editable('action_taken')}
          />
          <ReviewRow
            label="Investigator-on-Case (IOC)"
            value={draft.ioc_name}
            required
            {...editable('ioc_name')}
          />
          <ReviewRow
            label="Officer Initials"
            value={draft.officer_initials}
            {...editable('officer_initials')}
          />
          {/* Derived read-outs, deliberately NOT editable: the badge line comes
              from the account, the signed name from Panel I, and the timestamp
              from the server at submit time. A path here would offer an edit
              that has nowhere to be written. */}
          <ReviewRow label="Badge No." value={`${user.badge_number} · ${user.full_name}`} />
          <ReviewRow label="Signature of Reporting Party" value={draft.reporter_name} />
          <ReviewRow
            label="Signature Timestamp"
            value={
              draft.party_signed_at
                ? specTimestamp(draft.party_signed_at)
                : 'Auto-filled when the report is submitted'
            }
          />
        </div>
      </section>
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
  // stands on its own under the masthead — built as an object in its own right
  // (see the note on it below) with one line of its own copy beneath — and the
  // register tail closes the page. Its "View All My Reports" button went with
  // it: the top bar already has that destination, so the card was the second
  // route to a screen one click away.
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

      {/* The page's one action, and it is built as an object rather than as a
          form button: a plate carrying the page glyph the app already uses for
          a report (the review stepper's), the label, and the same arrow the
          gate's primary action wears — so the two loudest buttons in the
          product step the same way.

          The mono line under it is the reassurance a FIRST-TIME officer wants
          before the press, not after: the form is long, and knowing it is kept
          as a draft (rather than submitted by being opened) is the difference
          between starting it and putting it off. */}
      <div className="ir-actions-row ir-home-actions">
        <button type="button" className="ir-submit ir-home-cta" onClick={onNew}>
          <span className="ir-home-cta-glyph" aria-hidden="true">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z" />
              <path d="M14 3.5V8h4.5" />
              <path d="M12 11.5v5M9.5 14h5" />
            </svg>
          </span>
          <span className="ir-home-cta-text">Start a New Report</span>
          <svg
            className="ir-home-cta-arrow"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <p className="ir-home-cta-note">
        Opens a blank incident form. It stays a draft until you submit it.
      </p>

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
  // How to draw the same form (Profile ▸ Preferences ▸ Form format). Three
  // values — 'document', 'sheet', 'steps' — defined once in lib/formFormat.js,
  // because the menu that sets it and this component that answers it must not
  // each keep their own idea of the set. Only the two format-specific answers
  // are asked below; everything else about the editor is format-agnostic.
  formFormat = 'document',
  // Shell hands these down so a sign-out can save the open draft first (see the
  // registration effect below and Shell.flushPending) and so Ctrl+S reaches
  // whichever copy of the editor is on screen.
  onRegisterFlush,
  onRegisterSave,
  // The station's own incident-type list (Station settings), or null when it has
  // not been read — see TYPES above for why this is not always the built-in 14.
  incidentTypes = null,
  // The station's letterhead, from the same /station read (Shell owns it). Used
  // by ONE format: the sheet draws these lines at the head of its page, so the
  // officer writes on the station's own paper rather than on a blank anonymous
  // rectangle. Null falls back to the built-in lines — see resolveHeader.
  // The officer's own recent reports. Shell already fetches the list for Home,
  // and D7 reads the most recent one's declared language to pre-select the
  // selector on a NEW report — a suggestion only, visible and changeable.
  recentReports = null,
  stationHeader = null,
}) {
  const typeOptions = incidentTypes && incidentTypes.length > 0 ? incidentTypes : TYPES;
  const letterhead = resolveHeader(stationHeader);
  // For a new report, start with the empty form immediately; for an existing
  // one, null until fetched. (Starting null for BOTH would crash the first
  // render — effects run after render, so the new-report path must be ready.)
  // A NEW report starts from D7's suggestion — the language of this officer's
  // most recent report, or English when there is none. An EXISTING report is
  // loading at this point (reportId !== null) and always shows its own stored
  // value, so the suggestion can never relabel a report that already has one.
  const [draft, setDraft] = useState(() => (
    reportId === null
      ? { ...EMPTY, narrative_language: suggestedLanguage(recentReports, user.id) }
      : null
  ));
  const [errors, setErrors] = useState({});
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
  // Phase 6 Stage 4 — the DERIVED verification status, lifted from the review
  // panel so the finalize notice reads the SAME code the server gave it. Reset
  // when another report loads, so one report's status can never colour
  // another's notice.
  const [verificationStatus, setVerificationStatus] = useState(null);
  useEffect(() => {
    setVerificationStatus(null);
  }, [editingId]);

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
  const [groupErrors, setGroupErrors] = useState({});
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

  // Which sections of the stepper the officer has been IN. The rules are the
  // completeness signal for every section except section 1, which is
  // all-optional: "no errors" is equally true of a blank card nobody has
  // opened, so the stepper needs the visit to tell "nothing to fill" apart
  // from "not seen yet". Flipped by the focus/blur handlers on that card.
  const [visitedSections, setVisitedSections] = useState(() => new Set());
  function markVisited(index) {
    setVisitedSections((s) => (s.has(index) ? s : new Set(s).add(index)));
  }

  // ---- The stepped form format (Profile ▸ Preferences) --------------------
  // Which panel is on screen. Every other panel stays mounted but hidden, so a
  // field is always resolvable by id; jumpTo below reveals the owning step
  // before focusing. `steppedEnteredRef` marks that the officer has been placed
  // once, so the panel never moves under their hands afterwards.
  const stepped = formFormat === 'steps';
  // ---- The sheet form format (Profile ▸ Preferences) ----------------------
  // The THIRD format, and deliberately not a third tree: it renders exactly what
  // the document format renders — every panel, nothing hidden, no stepper-driven
  // navigation — and differs only in the class on the form, which re-dresses
  // cards as a page and fields as blanks to write on. One tree means a field, a
  // rule, an error jump or a group can never work in two of the three formats
  // and not the third, which is the failure a second layout would eventually
  // have. `stepped` stays false for it on purpose: the stepper's one-panel rule
  // is the thing this format exists to avoid.
  const sheet = formFormat === 'sheet';
  // Whether the sheet format is showing the rest of the report. False is the
  // format's whole promise: it opens as a blank page — no labels, no boxes, no
  // placeholders, nothing to read — and the report's structured fields arrive
  // when the officer asks for them (see `sheetBar` below). Component state, not
  // a stored preference, and NOT part of the editor's key: it is a view of one
  // report, so it resets with the report and never re-lays-out a draft.
  const [sheetFields, setSheetFields] = useState(false);
  const sheetBlank = sheet && !sheetFields;
  const [activeStep, setActiveStep] = useState(0);
  const steppedEnteredRef = useRef(false);
  useEffect(() => {
    if (!stepped) {
      steppedEnteredRef.current = false; // re-entering opens on the current step
      return;
    }
    if (!draft || steppedEnteredRef.current) return;
    steppedEnteredRef.current = true;
    // Open on the section the stepper calls current — the next thing to do —
    // rather than always at the first panel. Keyed on entry only, on purpose:
    // a section completing while the officer types must not yank the panel.
    setActiveStep(computeStepProgress(draft, visitedSections).current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepped, draft]);

  // ---- Editing from the review step --------------------------------------
  // Which read-back row of the review has its editor open (null = none). It
  // lives HERE, not in the review, for one reason: an error jump has to be able
  // to open a row (see jumpTo), and the review is a child that cannot be asked
  // to open something from outside. Opening a row is only ever a view state —
  // nothing is written until the officer types, and every write goes through the
  // same setters as the form, so the exit flush, the autosave and the rule
  // engine need to know nothing new.
  const [editingReviewRow, setEditingReviewRow] = useState(null);
  // Set when Escape (or the row's Done chip) closes a row, so the focus can be
  // handed back to the value the officer opened it from — the editor that held
  // it is gone by then, and a keyboard user would otherwise land at the top of
  // the document.
  // the officer opened it from (the editor that held it is gone by then) — a
  // keyboard user would otherwise land on the top of the document.
  const refocusRowRef = useRef(null);
  useEffect(() => {
    if (editingReviewRow !== null) return;
    const path = refocusRowRef.current;
    if (!path) return;
    refocusRowRef.current = null;
    document.getElementById(reviewRowValueId(path))?.focus?.({ preventScroll: true });
  }, [editingReviewRow]);

  /** Open a row's editor from the review. A locked report opens nothing. */
  function beginReviewEdit(path) {
    if (!canEdit) return;
    const row = reviewRowForPath(path);
    // Only rows the review renders a control for; a path it cannot build (a
    // bare group key, say) would leave the officer staring at a closed row.
    if (!REVIEW_SCALAR_PATHS.includes(row)) return;
    setEditingReviewRow(row);
  }

  /**
   * Close the open row. `refocus` is the keyboard's ask (Escape, or the row's
   * Done chip) — it means "put me back on the line I was editing".
   */
  function endReviewEdit(path, { refocus = false } = {}) {
    if (refocus) refocusRowRef.current = path;
    setEditingReviewRow(null);
  }

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

  // ---- The automatic save path -------------------------------------------
  // ONE writer for every save the officer did not press: the 30s interval, the
  // exit flush, and the sign-out flush Shell holds. The manual Save button
  // stays separate on purpose — it validates first and reports failures, and
  // neither belongs in a save nobody asked for.
  //
  // Returns the report id, or null when there is nothing the API can accept:
  // `incident_type` is NOT NULL in the schema and required by POST /reports, so
  // a report with no type chosen yet cannot be stored at all. Nothing is lost
  // when that happens — it is still in the editor and in the sessionStorage
  // mirror above, which is what the recovery offer restores.
  //
  // `keepalive` keeps the request alive after the document is destroyed. It is
  // the only reason a save fired from a closing tab reaches the server, and it
  // is the one thing an ordinary PATCH cannot do.
  // The write in flight, so the several exits cannot race each other into two
  // reports. Every save before the first one is a POST, and a POST assigns the
  // number — two of them a moment apart would create two reports for one
  // incident. A caller that arrives mid-write JOINS it and gets its id back
  // (and with it the slightly older body, which the next write corrects) rather
  // than starting a second one. A keepalive exit write can therefore ride on an
  // ordinary request already in flight: that request is saving the same draft,
  // and the mirror above still holds the text if it loses the race with unload.
  const inFlightRef = useRef(null);

  const writeDraft = useCallback(({ keepalive = false } = {}) => {
    if (inFlightRef.current) return inFlightRef.current;
    const d = draftRef.current;
    if (!d || !d.incident_type) return Promise.resolve(null);
    const body = { ...d, status: 'draft', narrative_source: narrativeSourceRef.current };
    const request = idRef.current
      ? api(`/reports/${idRef.current}`, { method: 'PATCH', body, keepalive }).then(() => idRef.current)
      : api('/reports', { method: 'POST', body, keepalive }).then((created) => created.report.id);
    inFlightRef.current = request;
    // Free the slot when it settles, WITHOUT consuming the rejection — whoever
    // awaited `request` still has to see it, so the clearing is a second,
    // separate branch rather than a .finally() on the returned promise.
    const clear = () => {
      if (inFlightRef.current === request) inFlightRef.current = null;
    };
    request.then(clear, clear);
    return request;
  }, []);

  // The FIRST save is the one that assigns the number, so every caller has to
  // adopt it or the next write would create a second report.
  const adoptSavedId = useCallback((id) => {
    if (idRef.current === id) return;
    idRef.current = id;
    setEditingId(id);
    setDraft((prev) => (prev ? { ...prev, id, created_by: user.id } : prev));
  }, [user.id]);

  // Autosave draft every 30s while editing and dirty.
  useEffect(() => {
    const iv = setInterval(async () => {
      if (!dirtyRef.current) return;
      const isNew = !idRef.current;
      try {
        const id = await writeDraft();
        if (id === null) return; // no incident type yet — nothing savable
        adoptSavedId(id);
        dirtyRef.current = false;
        // Only a CREATE reaches onMutated: refreshing Home's list is about the
        // new report number, and bumping it every tick would refetch that list
        // every 30 seconds while the officer is typing.
        if (isNew) onMutated?.();
        notify('Draft saved automatically.');
      } catch {
        // silent: next tick retries; explicit Save shows the error
      }
    }, 30000);
    return () => clearInterval(iv);
  }, [notify, onMutated, writeDraft, adoptSavedId]);

  // ---- Saving on the way out ----------------------------------------------
  // The interval alone leaves up to 30 seconds of typing unsaved, and the
  // moments that lose work are exactly the ones between ticks — an officer who
  // closes the tab, is timed out, or clicks away mid-sentence. Three exits are
  // covered, because each one slips past the other two:
  //   · pagehide — tab closed, refreshed, navigated away, window closed. The
  //     write goes out with `keepalive`, so the closing document cannot cancel
  //     it.
  //   · visibilitychange — fires FIRST in practice (tab switch, minimise,
  //     screen lock) while the document is still alive, and still gets a
  //     keepalive write for the one case that skips it: a window closed
  //     directly from the hidden state.
  //   · unmount — leaving this screen inside the app (Home, My Reports, or
  //     another report from the list) fires no page event at all. The document
  //     is alive here, so an ordinary request is enough.
  // Sign-out is a FOURTH route, but it cannot be one of these: the idle timeout
  // destroys the session, and a save after /logout would 401. Shell runs that
  // one itself, through the registration effect below.
  //
  // All of it is silent and best-effort, and there is deliberately NO
  // beforeunload prompt: it would fire on healthy exits too, and the
  // sessionStorage mirror already covers the case where the write cannot get
  // through — an officer never has to answer a dialog to keep their work.
  // Returns a promise so the one caller that can wait — Shell's sign-out, which
  // must not end the session before the write lands — can wait. The page events
  // and the unmount simply ignore it: nothing awaits an unload.
  const flushDraft = useCallback(({ keepalive = false } = {}) => {
    if (!dirtyRef.current) return Promise.resolve();
    const isNew = !idRef.current;
    return writeDraft({ keepalive })
      .then((id) => {
        if (id === null) return;
        adoptSavedId(id);
        dirtyRef.current = false;
        if (isNew) onMutated?.();
      })
      .catch(() => {
        // Offline, or the session ended first: the mirror above is the
        // fallback and the recovery offer picks it up in this tab.
      });
  }, [writeDraft, adoptSavedId, onMutated]);

  useEffect(() => {
    function onPageHide() {
      flushDraft({ keepalive: true });
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushDraft({ keepalive: true });
    }
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      // The unmount route. Runs on every unmount, so the guard is `dirty`: a
      // report just saved or just finalized is not dirty and writes nothing.
      flushDraft();
    };
  }, [flushDraft]);

  // Hand Shell the flush so signing out saves first (Shell.doLogout and the
  // idle timeout both call it BEFORE /logout). Registered only while this
  // editor is mounted, and cleared on the way out so a stale closure from a
  // closed report can never write over the one on screen.
  useEffect(() => {
    if (!onRegisterFlush) return undefined;
    onRegisterFlush(flushDraft);
    return () => onRegisterFlush(null);
  }, [onRegisterFlush, flushDraft]);

  // The same hand-off for Ctrl+S. `saveDraft` is a plain function, redefined
  // every render, so it goes through a ref and the registration depends on a
  // stable wrapper: registering the function itself would re-run this effect on
  // every keystroke. Registered only while the officer may edit — a read-only
  // report has no Save Draft button, so its chord does nothing either.
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;
  const saveFromChord = useCallback(() => saveRef.current(), []);
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(canEdit ? saveFromChord : null);
    return () => onRegisterSave(null);
  }, [onRegisterSave, saveFromChord, canEdit]);

  function set(field, value) {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }

  // The two fields whose editing carries a side-effect beyond the value, named
  // so the form and the review write them the SAME way instead of each keeping
  // its own copy of the rule. (The review edits both: see ReportReview.)
  function setNarrative(value) {
    set('narrative', value);
    // Provenance starts at 'manual' and only the AI accept path raises it to
    // 'ai-assisted' — typing never does — but the rule belongs with the field,
    // not with the one control that happened to hold it.
    if (narrativeSourceRef.current !== 'ai-assisted') narrativeSourceRef.current = 'manual';
  }

  function setActionTaken(value) {
    set('action_taken', value);
    // Editing by hand closes the AI's one-step revert offer for the text it
    // rewrote, so a stale revert can never fight the officer's typing.
    clearAiUndo('action_taken');
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
      // Keep the derived scalars (Item, Owner of Property, vehicle block…) in
      // step with the groups they mirror — including clearing the copies a
      // deleted row leaves behind (see syncMirrors).
      return { ...d, type_specific: syncMirrors(d.type_specific, ts, d.incident_type) };
    });
  }

  // Switching incident type resets the specific fields (they belong to the
  // old type) and keeps common fields intact.
  function changeType(value) {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, incident_type: value, type_specific: {} }));
    setErrors((e) => (e.incident_type ? { ...e, incident_type: undefined } : e));
  }

  // Phase 6 Stage 3/5 — what "Apply" does to the FORM. A translated draft
  // carries its source with it, so applying it stores the officer's verbatim
  // words, its declared language, and marks the report English in the same save.
  // Shared by the plain accept path and Track C's guided step 1.
  function applyAiNarrative(aiText, sourceMeta) {
    set('narrative', aiText);
    narrativeSourceRef.current = 'ai-assisted';
    if (sourceMeta && sourceMeta.language && sourceMeta.language !== 'en') {
      set('narrative_language', 'en');
      set('narrative_source_text', sourceMeta.text ?? '');
      set('narrative_source_language', sourceMeta.language);
    }
  }

  // Phase 6 Stage 5 (Track C) — the guided flow's step 1: apply the reviewed
  // translation AND save it. The save is not decoration: the tighten endpoint
  // refuses while the STORED report still declares a non-English narrative
  // (NarrativeController::tighten), and that guard is deliberately not weakened
  // to spare the client a round trip. The body is built from draftRef — the
  // same latest-values ref the autosave uses — so it saves exactly the report
  // the officer is looking at, with the English text and its source pair on it.
  async function applyGuidedTranslation(aiText, sourceMeta) {
    const hadSource = !!(sourceMeta && sourceMeta.language && sourceMeta.language !== 'en');
    applyAiNarrative(aiText, sourceMeta);
    const current = draftRef.current ?? {};
    if (!current.incident_type) {
      throw new Error('Choose the incident type first — the report cannot be saved without it.');
    }
    const next = hadSource
      ? {
        ...current,
        narrative: aiText,
        narrative_language: 'en',
        narrative_source_text: sourceMeta.text ?? '',
        narrative_source_language: sourceMeta.language,
      }
      : { ...current, narrative: aiText };
    const body = { ...next, status: 'draft', narrative_source: 'ai-assisted' };
    const id = idRef.current
      ? await api(`/reports/${idRef.current}`, { method: 'PATCH', body }).then(() => idRef.current)
      : await api('/reports', { method: 'POST', body }).then((created) => created.report.id);
    adoptSavedId(id);
    dirtyRef.current = false;
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

  // ---- Navigation, shared by both formats --------------------------------
  // The stepped format hides the panels the officer is not on, and a hidden
  // element can neither be focused nor scrolled to — so the jump has to reveal
  // the panel first, then run the same scroll/flash as the document format.
  // That is the one place where the two formats differ in behaviour: the
  // stepper, the error banner links and a blocked Submit all go through here.
  function goToStep(step) {
    // Steps, not sections: the stepped format has the review step after the
    // five sections, and a section is still the only thing a jump can target.
    if (step < 0 || step >= STEP_COUNT) return;
    // Walking away from the review closes whatever row was open in it: the
    // read-back is something you come back to read, not a form left half open.
    if (step !== REVIEW_STEP) setEditingReviewRow(null);
    if (!stepped) {
      scrollToSection(step);
      return;
    }
    setActiveStep(step);
    // One tick for the panel to paint: scrollToSection then lands on the
    // section's first card and flashes every card in it, so the officer sees
    // how many cards this step holds.
    window.setTimeout(() => scrollToSection(step), 60);
  }

  /** Land an error jump on a field: reveal its step first when there is one. */
  function jumpTo(path) {
    // The sheet format's blank state keeps the report's fields off screen, so a
    // jump into one of them has to open the sheet's own control first — the same
    // move the stepped format makes when it reveals the owning step, and for the
    // same reason: a field that is not laid out can be neither focused nor
    // scrolled to. The narrative is the exception, because on the blank page it
    // IS what is on screen; revealing the whole report to focus the page would
    // be throwing the format away to answer a question about the page.
    if (sheetBlank && path !== 'narrative') {
      setSheetFields(true);
      window.setTimeout(() => focusField(path), 60);
      return;
    }
    if (stepped) {
      // Already reading the report back? Then the fix happens HERE: the review
      // carries its own copy of the field, so a blocked Submit opens the row in
      // place instead of throwing the officer back a step to hunt for it. The
      // row is the same control the form has — same setter, same rules — and if
      // the review has no row for the path the jump falls through to the step
      // walk below, exactly as before.
      const row = reviewRowForPath(path);
      if (canEdit && activeStep === REVIEW_STEP && REVIEW_SCALAR_PATHS.includes(row)) {
        beginReviewEdit(path);
        window.setTimeout(() => focusField(path), 60);
        return;
      }
      const step = stepperSectionForPath(path, draft.incident_type);
      if (step !== -1 && step !== activeStep) {
        setActiveStep(step);
        window.setTimeout(() => focusField(path), 60);
        return;
      }
    }
    focusField(path);
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
                    jumpTo(k);
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
        const firstKey = blocking[0]?.path;
        if (firstKey) window.setTimeout(() => jumpTo(firstKey), 350);
      });
      return false;
    }
    setRuleWarnings(null);
    return true;
  }

  // Generate AI draft flags problems FIRST: an incomplete report makes a poor
  // AI draft, so the same banner + jump-to-field runs before any request.
  // Only the narrative is exempt — that is what the AI is there to write.
  function gateAiGenerate() {
    // Phase 6 Stage 3 (D4) — Generate is deliberately NO LONGER refused for a
    // non-English narrative: translating a Bisaya/Tagalog narrative (or notes)
    // into formal English is exactly what this stage adds, and Apply sets the
    // report back to English. Tighten keeps the Stage 1 refusal (see the panel
    // and the server guard), because the English economy engine must never
    // rewrite native text.
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
                // …and the flat scalars those groups supersede are derived the
                // same way, so a report filed before them shows — and later
                // prints — what its ROWS say instead of the copy it carried.
                // Deriving on load never blanks anything (see deriveMirrors),
                // so an old report keeps every value it was filed with.
                ts = deriveMirrors(ts, canonicalType);
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

  // Derived, never stored: every render re-buckets the finalize rules, so the
  // dots keep pace with typing exactly like the red banner does.
  const stepProgress = computeStepProgress(draft, visitedSections);

  // The stepped format shows one step's cards and hides the rest — hidden,
  // never unmounted, so `getElementById` and the error jumps keep working.
  const panelHidden = (step) => (stepped && step !== activeStep ? true : undefined);

  // Which section's cards are CURRENT, i.e. get their headers tinted and their
  // left edge marked. Same index the stepper's emphasis follows, so the rail and
  // the body can never point at different places: the panel on screen in the
  // stepped format (the review step included, which has no section of its own
  // and so matches no card except the review's), and the first section still
  // open in the document format, which has no position to report.
  //
  // A COMPLETE report highlights nothing in the document format — the rail
  // drops its emphasis once every section is filled, and "the first open
  // section" would otherwise quietly point at section 5 forever, so the two
  // would disagree about a report that is finished.
  const currentSection = stepped
    ? activeStep
    : stepProgress.complete.every(Boolean)
      ? null
      : stepProgress.current;

  // The AI writing panel (UC-006/007/008) — the officer's Generate control.
  //
  // It is mounted in ONE place per format, never two. In the stepped format
  // that place is the REVIEW step — the read-back that ends the flow — so the
  // officer meets a single Generate row at a single point instead of the same
  // control on both the narrative step and the last step. The document format
  // has no review step, so there the panel sits in Panel III, under the
  // narrative field, where the writing happens.
  //
  // One instance on screen at a time, deliberately: the panel owns the
  // slide-in side panel, the rough-notes box and the generated draft, so two
  // live copies would draw two side panels and two rails, and would fight over
  // the body class that reserves the panel's space (the divergence that leaves
  // a phantom gap beside the form). A draft generated earlier in the tab
  // survives a step change by design — the panel restores it from the per-tab
  // session store keyed by report id — and so does its own visibility, which
  // is settled by the health probe on mount.
  // The declared language of the narrative (Phase 6 Stage 1). Read through
  // normaliseLanguage so a stored value this build does not know — an older
  // row, a draft restored from sessionStorage — shows as English rather than
  // as a language nobody can name.
  const languageCode = normaliseLanguage(draft?.narrative_language);

  // One element, two mutually-exclusive homes — the rule the AI panel and the
  // action row already follow, and for the same reason: everything inside the
  // sheet's card IS the page, and a <select> is a control, so in the sheet
  // format this renders on the desk beneath the paper instead (see the block
  // after </form>). Never both, so there is always exactly one selector.
  //
  // Changing it RELABELS: set() marks the draft dirty and edits nothing else.
  // No conversion, no translation, no re-processing of a character of text.
  const languagePicker = (
    <div className="ir-language">
      <label className="ir-language-label" htmlFor="r-lang">
        Narrative language
      </label>
      <select
        id="r-lang"
        className="ir-language-select"
        value={languageCode}
        onChange={(e) => set('narrative_language', e.target.value)}
        disabled={!canEdit}
      >
        {narrativeLanguageOptions().map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <p className="field-hint">{languageHint()}</p>
      {untranslatedNotice(languageCode) && (
        <p className="ir-language-note" role="status">
          {untranslatedNotice(languageCode)}
        </p>
      )}
    </div>
  );

  // Track B — the officer's dictionary. Read-only and offline; it never
  // inserts a term anywhere. Kept beside the writing (the narrative card, and
  // on the desk under a blank sheet) rather than inside the AI panel, because
  // it is useful whether or not the model is available.
  const termsPanel = canEdit ? (
    <NarrativeTermsPanel
      reportLanguage={languageCode}
      texts={[
        draft?.narrative || '',
        draft?.action_taken || '',
        draft?.type_specific?.notable_findings || '',
      ]}
    />
  ) : null;

  const aiPanel = canEdit ? (
    <AiNarrativePanel
      reportId={draft?.id ?? null}
      canEdit={canEdit}
      narrative={draft?.narrative || ''}
      // The AI closes the narrative with the recorded disposition,
      // so the panel shows which text it is working from.
      actionTaken={draft?.action_taken || ''}
      // The officer's own observations: the AI weaves them into the
      // narrative AND formalises them into the sheet's NOTABLE
      // FINDINGS block.
      notableFindings={draft?.type_specific?.notable_findings || ''}
      // Completeness gate: flag "The report has N problems" and jump
      // to the missing fields BEFORE any AI request is sent.
      onBeforeGenerate={gateAiGenerate}
      // D3 — the panel disables Generate and Tighten and states the reason,
      // rather than offering a control whose only possible answer is no.
      languageBlocked={aiBlockedReason(languageCode)}
      // Phase 6 Stage 2 — opens the terminology lookup on the language the
      // officer is writing in. A default only; it never edits the narrative.
      narrativeLanguage={languageCode}
      // Human-in-the-loop: the officer explicitly copies the AI draft in; it
      // stays fully editable afterwards. The source tag lands in report_history
      // via the next save/finalize.
      onAccept={applyAiNarrative}
      // Phase 6 Stage 5 (Track C) — step 1 of the guided "Translate & tighten"
      // flow: apply AND save the reviewed translation, so step 2 can run against
      // a record the server already knows is English.
      onApplyGuided={applyGuidedTranslation}
      // Generating the report IS the action for the findings: the
      // drafted lines replace the Notable Findings field outright
      // (one printed line per finding), because that field is what
      // saves, snapshots and prints. A draft with no findings leaves
      // the officer's text alone, and identical text is not rewritten
      // (so no spurious unsaved-changes state).
      onApplyFindings={(lines) => {
        const text = lines.join('\n');
        if (text.trim() === '') return;
        if (text === String(draft?.type_specific?.notable_findings || '')) return;
        // Remember what we are about to replace so the officer can
        // reject the formalisation with one click.
        setAiUndo((u) => ({ ...u, findings: String(draft?.type_specific?.notable_findings || '') }));
        setTypeSpecific('notable_findings', text);
      }}
      // The recorded disposition is enhanced the same way: the
      // formalised line replaces the ACTION TAKEN / STATUS field,
      // which is what saves and prints. A blank disposition in the
      // draft leaves the officer's wording untouched.
      onApplyActionTaken={(text) => {
        if (text.trim() === '') return;
        if (text === String(draft?.action_taken || '')) return;
        setAiUndo((u) => ({ ...u, action_taken: String(draft?.action_taken || '') }));
        set('action_taken', text);
      }}
    />
  ) : null;

  if (error && !draft) {
    return (
      <>
        <div className="alert error" role="alert">{error}</div>
        <button onClick={onClosed}>Back</button>
      </>
    );
  }

  // What the review's rows need to be editable: the draft being read back,
  // which row is open, how to open and close one, and the setters the FORM uses
  // for each field. Handing over the editor's own setters is the whole safety
  // story of the feature — an edit made in the review is an ordinary edit to the
  // draft (dirty flag, autosave, exit flush, inline errors, history) with no
  // second write path to keep in step. `canEdit` is there so a locked report
  // offers no control at all.
  //
  // `draft` is handed over rather than relied on as a prop because a row's
  // editor reads the field it is editing out of the SAME object the row was
  // rendered from (ReviewRow is given a formatted `value`, not the draft).
  const reviewEdit = {
    draft,
    canEdit,
    editingRow: editingReviewRow,
    beginEdit: beginReviewEdit,
    endEdit: endReviewEdit,
    errors,
    set,
    changeType,
    setNarrative,
    setActionTaken,
    // Handed to the review's type editor so the report can be re-typed from the
    // read-back against the SAME list the form offers.
    types: typeOptions,
  };

  // The action row — Save Draft and the rest of the secondary row, then the one
  // full-width Submit — plus the advisory footer that goes with it. Extracted so
  // the sheet format can put it BELOW the paper instead of inside it: everything
  // within `.ir-form--sheet` is the page, and an officer who asked for a blank
  // sheet should not find the report's commit row printed at the foot of it.
  //
  // One element, rendered in one of two places depending on the format (see
  // below): the sheet branch and the in-form branch are mutually exclusive, so
  // there is never a second copy of these controls on screen — the same rule the
  // AI panel follows, and for a stronger reason: two Save buttons is a class of
  // bug this codebase has no room for.
  const actionsCluster = (
    <>
      <div className="ir-actions">
        <div className="ir-actions-row">
          {/* `type="button"` stated rather than inherited: the sheet format
              renders this row OUTSIDE the form, where the default submit type
              has no form to submit — and the two formats should carry identical
              markup in a row that is moved between them. */}
          {canEdit && (
            <button type="button" onClick={saveDraft}>
              Save Draft
            </button>
          )}
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
      </div>

      {/* Footer (spec §5): the system's real writing-assistance advisory —
          no placeholder phone number, since the station has not supplied
          a support line. */}
      <p className="ir-footer">{AI_ADVISORY}</p>
    </>
  );

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
        {/* Phase 6 Stage 4 (D5/D8) — the translation status, wherever the
            report is. Shown only once the server has reported one, so a report
            with no source (and a report not yet read) says nothing here. */}
        {verificationStatus && verificationStatus !== 'english_original' && (
          <span className={`rv-badge ${statusClass(verificationStatus)}`}>
            {statusLabel(verificationStatus)}
          </span>
        )}
        {!canEdit && (
          <span>This report is locked. Only an administrator can make further changes.</span>
        )}
      </div>

      {/* Progress stepper, below the status row and above the error banner:
          the officer's position in the document, read out of the same rules
          the banner uses. It only navigates (never locks or edits), so it is
          safe on a locked report too.

          NOT rendered in the sheet format. The stepper is an instrument of the
          form's own structure — a dot per panel, and in the stepped format the
          thing that decides which panel is on screen — while the sheet's whole
          point is that the panels are not what you are looking at: it is one
          page you read and write on, with no position to report. Left in, it
          would be a progress meter sitting above a sheet of lined paper.

          Nothing the sheet needs is lost with it: the review step it could
          navigate to is itself stepped-only (see the review card below), and
          every other section is already on the page. This is a display choice
          like the format itself — switching back to Document or Steps brings the
          stepper straight back. */}
      {!sheet && (
        <ReportProgressStepper
          complete={stepProgress.complete}
          current={stepProgress.current}
          onJump={goToStep}
          // The review node exists only where it can be reached: the stepped
          // format. It is the one dot whose face is never filled.
          withReview={stepped}
          // Where the officer is standing, which is what the emphasis and the
          // count above it both follow in the stepped format. In the document
          // format there are no steps, so the emphasis falls back to the first
          // open section (`current`).
          here={stepped ? activeStep : null}
        />
      )}

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

      {/* The asterisk key. Not shown on the blank page: it explains a marker
          that is not on screen, since every field carrying one is behind the
          sheet's control. */}
      {!sheetBlank && (
        <p className="ir-required-note">
          <span className="req">*</span> Required before the report can be submitted.
        </p>
      )}

      {/* The sheet format's ONE control, and the only thing it adds to the
          screen. It sits OUTSIDE the sheet deliberately: the format's promise is
          a page with nothing on it, so the control that reveals the rest of the
          report cannot itself be printed on the page it is describing.

          What it reveals is the whole report — every panel, every group, and the
          action row. That row goes behind this control too, and the trade is
          worth stating: from the blank page an officer cannot click Save Draft
          or Submit. Neither can lose work — the draft autosaves, flushes on exit
          and mirrors in sessionStorage, and Ctrl+S still works from the blank
          page (it is a chord, not a button, so it never needed the row).
          Submitting the report is a deliberate act on the whole document, and
          the page you submit is the one this control opens. */}
      {sheet && (
        <div className="ir-sheet-bar">
          <button
            type="button"
            className="ir-sheet-toggle"
            aria-expanded={sheetFields}
            onClick={() => setSheetFields((v) => !v)}
          >
            {sheetFields ? 'Hide the report fields' : 'Show the report fields'}
          </button>
          <span className="ir-sheet-hint">
            {sheetFields
              ? 'The page is your account of the incident; the rest is the report it is filed as.'
              : 'Write on the page. Dates, parties, items and everything else the report needs are one click away — and Ctrl+S saves your draft without leaving it.'}
          </span>
        </div>
      )}

      <form
        onSubmit={(e) => e.preventDefault()}
        className={`ir-form${stepped ? ' ir-form--stepped' : ''}${sheet ? ' ir-form--sheet' : ''}${
          sheetBlank ? ' ir-form--blank' : ''
        }`}
      >
        {/* The spec's four panels, 2x2 on desktop. Panels I and II carry the
            screen's own fields; Panel III is the narrative the AI drafts and
            Panel IV is the signature block. The application's remaining
            document sections follow the grid as full-width cards, so nothing
            the blotter needs was dropped to match the layout. */}
        <div className="ir-grid">
          {/* Panel I is the stepper's section 1. `onFocus`/`onBlur` on the card
              mark it visited — no per-field listener needed. */}
          <IrCard
            num="I"
            title="Reporting Party Information"
            step={0}
            current={currentSection === 0}
            hidden={panelHidden(0)}
            onFocus={() => markVisited(0)}
            onBlur={() => markVisited(0)}
          >
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

          <IrCard
            num="II"
            title="Incident Details"
            step={1}
            current={currentSection === 1}
            hidden={panelHidden(1)}
          >
            <div className="ir-sub">
              {/* Narrow: the 14 type names are the longest thing this select ever
                  shows and they still fit inside 20rem, so spanning the whole
                  half-width column just made a very wide box with nothing in it. */}
              <div className="ir-field ir-field--narrow">
                <IrLabel htmlFor="r-type" icon="hash" required>Type of Incident</IrLabel>
                <select
                  id="r-type"
                  value={draft.incident_type}
                  onChange={(e) => changeType(e.target.value)}
                  disabled={!canEdit}
                  aria-invalid={!!errors.incident_type}
                >
                  <option value="">Select type…</option>
                  {typeOptions.map((t) => (
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
                    {/* The caption is sr-only, not visible: this pair already sits
                        under one "Date & Time of Occurrence" label, and a second
                        caption line over each input dropped both pickers a line
                        lower than the Type select beside them — the two boxes not
                        lining up is what that looked like. The name stays on the
                        input for screen readers, so nothing is lost by hiding it. */}
                    <label className="sr-only" htmlFor="r-date">Date</label>
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
                    <label className="sr-only" htmlFor="r-time">Time</label>
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

          <IrCard
            num="III"
            title="Incident Narrative"
            step={2}
            current={currentSection === 2}
            hidden={panelHidden(2)}
            // The sheet format draws THIS card as the page (see IrCard).
            sheetPage
          >
            {/* The station's letterhead, on the sheet format's page only. It is
                the same seven lines the printed sheet carries (see
                ReportPrint), read from the same place (Station settings), so
                the page an officer writes on and the page that comes out of the
                printer cannot disagree about whose report this is.

                Outside the blank state's hiding rules deliberately: the
                letterhead is not the form — it is the PAPER, and a stationery
                sheet has it before anyone writes on it. */ }
            {sheet && (
              <header className="ir-sheet-head">
                {/* The printed sheet's header band, to the letter: the PNP seal
                    upper LEFT (square, so it never distorts), the organisation
                    block centered, the station's own seal upper RIGHT. The seals
                    carry the same alt text as the print sheet's — they are marks
                    of office, not decoration. */}
                <img className="ir-sheet-seal ir-sheet-seal--code" src={pnpSeal} alt="PNP seal" />
                <div className="ir-sheet-head-lines">
                  <div>{letterhead.agency}</div>
                  <div>{letterhead.commission}</div>
                  <div className="ir-sheet-head-strong">{letterhead.regional_office}</div>
                  <div className="ir-sheet-head-strong">{letterhead.provincial_office}</div>
                  <div className="ir-sheet-head-strong">{letterhead.station_name}</div>
                  <div>{letterhead.station_location}</div>
                </div>
                <img
                  className="ir-sheet-seal ir-sheet-seal--station"
                  src={citySeal}
                  alt="City of Naga Police Station seal"
                />
              </header>
            )}
            {/* The meta row under the band: the office code holding the left
                margin, the report date on the right with its "Date" caption
                beneath — the printed sheet's .pr-code-date, line for line.

                The date is the one the report is DATED with, not today's,
                resolved by reportDateValue (report date → created → incident
                → today, in that order), so a reopened report shows the date it
                will print with. */}
            {sheet && (
              <div className="ir-sheet-head-meta">
                <span className="ir-sheet-head-code">{letterhead.office_code}</span>
                <span className="ir-sheet-date">
                  {specDate(reportDateValue(draft, new Date().toISOString().slice(0, 10)))}
                  <span className="ir-sheet-date-label">Date</span>
                </span>
              </div>
            )}
            <div className="ir-field ir-narrative">
              <IrLabel htmlFor="r-narr" icon="lines" required>
                Detailed Description of Events
              </IrLabel>
              <textarea
                id="r-narr"
                rows={8}
                value={draft.narrative || ''}
                onChange={(e) => setNarrative(e.target.value)}
                disabled={!canEdit}
                aria-invalid={!!errors.narrative}
                placeholder="Describe the incident in chronological order. Include suspect description, witness information, and any property damage or injuries."
              />
              {errors.narrative && <div className="error">{errors.narrative}</div>}
              {/* Phase 6 Stage 4 (D7) — the side-by-side review surface. After
                  Apply the native words are no longer in the narrative field, so
                  the original is shown BESIDE the English, read-only and
                  literal, with the derived status and — when the server says
                  this account may — the verify / dispute form. Mounted only on a
                  saved report that carries a source; a report with no source has
                  nothing to review against. */}
              {hasSource(draft) && editingId && (
                <ReportVerificationPanel
                  reportId={editingId}
                  report={draft}
                  onStatus={setVerificationStatus}
                  notify={notify}
                />
              )}
              {/* ON THE DESK, NOT ON THE PAGE: in the sheet format this card is
                  the paper itself, so the selector renders under the sheet
                  instead (the other home, after </form>). */}
              {!sheet && languagePicker}
              {/* Track B — the full terminology panel, beside the writing. */}
              {!sheet && termsPanel}
            </div>
            {/* Where the AI panel lives is settled PER FORMAT — one home each,
                never two, because the panel owns the slide-in side panel and the
                body class that reserves its space, so two live copies would
                fight over both.

                  stepped   — on the REVIEW step (the AI assistance card at the
                              end). The hint below says where it went, so the
                              control's absence reads as a move rather than as
                              the feature being gone.
                  document  — here, under the narrative field, where the
                              writing happens. It has no review step.
                  sheet     — BELOW the paper (see the block after </form>).
                              This card IS the sheet's page, so a Generate row
                              inside it would be printed on the page; the panel
                              is a control, and controls sit on the desk.

                On the blank page that placement is also what keeps the format
                usable: the writing assistant stays on screen while the report's
                fields do not. */}
            {stepped && (
              <p className="section-hint">
                Writing assistance — Generate AI draft, or Tighten this narrative — is on the
                last step, Review, where the report reads back in one piece. The stepper above
                jumps straight there.
              </p>
            )}
            {!stepped && !sheet && aiPanel}
          </IrCard>

          <IrCard
            title="Signatures"
            step={4}
            current={currentSection === 4}
            hidden={panelHidden(4)}
          >
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
        </div>

        {/* Section 4's two cards are one step: the groups here and the per-type
            field block below. Both mark the visit, both carry the step index
            (`step={3}`) so the dot's jump flashes them together, and the rule
            engine's paths from either bucket into section 4. */}
        <IrCard
          title="Parties Involved"
          wide
          step={3}
          current={currentSection === STEPPER_TYPE_SPECIFIC}
          hidden={panelHidden(3)}
          onFocus={() => markVisited(3)}
          onBlur={() => markVisited(3)}
        >
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
                  // Any row edit re-derives the scalars that mirror this group,
                  // so the read-only copies and the saved blob never lag the
                  // list the officer is actually typing into.
                  type_specific: syncMirrors(
                    d.type_specific,
                    { ...d.type_specific, [groupKey]: nextItems },
                    d.incident_type,
                  ),
                }))
              }
              blankItem={() => ({})}
            />
          ))}
        </IrCard>

        {draft.incident_type && (
          <IrCard
            wide
            title={BLOCK_HEADINGS[draft.incident_type] ?? 'Incident Details'}
            step={3}
            current={currentSection === STEPPER_TYPE_SPECIFIC}
            hidden={panelHidden(3)}
            onFocus={() => markVisited(3)}
            onBlur={() => markVisited(3)}
          >
            <p className="section-hint">Fill in only what applies. Blank fields are left out of the report.</p>
            <TypeSpecificFields
              incidentType={draft.incident_type}
              values={draft.type_specific}
              onChange={setTypeSpecific}
              disabled={!canEdit}
              // The rule engine's per-type errors, keyed by path, so each field
              // can say what is wrong with IT rather than only the banner.
              errors={errors}
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

        {/* Action Taken / Status is a required document block: the narrative
            generator receives it as context, and the report cannot be
            submitted without it. It follows the four spec panels and sits
            directly above the submit bar. */}
        <IrCard
          wide
          title="Action Taken / Status"
          step={4}
          current={currentSection === 4}
          hidden={panelHidden(4)}
        >
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
              onChange={(e) => setActionTaken(e.target.value)}
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

        {/* The narrative moved into Panel III of the grid above (with the AI
            panel beside it) — it is not repeated here. */}
        {/* Section 5 is THREE cards, so all three carry the step index: the
            dot's jump flashes them together, and the current-step highlight
            covers the whole section instead of one card of it. */}
        <IrCard
          wide
          title="Investigator-on-Case"
          step={4}
          current={currentSection === 4}
          hidden={panelHidden(4)}
        >
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

        {/* The final step: the five sections read back as ONE document, with one
            row editable at a time. It is mounted only in the stepped format (the
            document format is already a single scroll, and its Submit puts the
            official sheet up first), and it is conditionally rendered rather
            than hidden like the field panels: the only field ids it ever holds
            are the PREFIXED copies of the open row's control (`rv-…`), so while
            it is away the form's own controls are the only ones on screen and
            every lookup resolves to exactly one element — the invariant the
            IrCard docs are about. */}
        {stepped && (
          <IrCard
            wide
            title={REVIEW_LABEL}
            current={currentSection === REVIEW_STEP}
            hidden={panelHidden(REVIEW_STEP)}
          >
            <ReportReview
              draft={draft}
              user={user}
              complete={stepProgress.complete}
              onGoToSection={goToStep}
              edit={reviewEdit}
            />
          </IrCard>
        )}

        {/* AI assistance on the LAST step — the stepped format's ONE home for
            the panel (see `aiPanel` above), set above the Previous/Next row so
            the officer can generate or tighten from the read-back: the point
            where they can see what the report is still missing AND where every
            structured field is already filled, so the draft is written from a
            complete report instead of from the half of it written so far. The
            stepped format only: the document format has no steps, and there the
            panel already sits under the narrative field, where the writing
            happens. */}
        {stepped && activeStep === REVIEW_STEP && canEdit && (
          <IrCard wide title="AI assistance">
            {aiPanel}
          </IrCard>
        )}

        {/* Stepped format: the way forward sits at the END of the panel, where
            the officer finishes reading it. Previous/Next walk the steps in
            order; the stepper above stays the direct route to any step, and
            its head reads the same "Step N of 6" because both name the panel
            on screen — there is one position, and the two never disagree. */}
        {stepped && (
          <div className="ir-step-nav">
            <button
              type="button"
              onClick={() => goToStep(activeStep - 1)}
              disabled={activeStep === 0}
            >
              ← Previous
            </button>
            <span className="ir-step-nav-where">
              Step {activeStep + 1} of {STEP_COUNT}
            </span>
            <button
              type="button"
              onClick={() => goToStep(activeStep + 1)}
              disabled={activeStep === STEP_COUNT - 1}
            >
              Next →
            </button>
          </div>
        )}

        {/* The actions at the end of the document, in the order the officer
            should reach for them: Save Draft (and the rest of the secondary
            row) FIRST, then the one full-width primary action that commits
            the report. Save Draft used to sit under Submit, which put the
            "keep my work" control after the irreversible one.

            Submit keeps the same completeness gate as before, so a report
            cannot be submitted with required fields missing.

            In the stepped format this whole cluster — Save/History/Print/
            Archive/Close, Submit, and the advisory footer — belongs to the
            LAST step, which is the review: every earlier step is its own
            panel, and committing the report is the end of the flow, not
            something offered while the officer is still on the first panel —
            nor before they have read the report back in one piece.

            NOT in the sheet format, where it goes below the paper instead — see
            the block after </form>. That is why the `!sheet` sits beside the
            step condition rather than inside it: the two answers are "this
            format's position" and "the sheet's position", and only one of them
            can apply. */}
        {(!stepped || activeStep === STEP_COUNT - 1) && !sheet && actionsCluster}
      </form>

      {/* The sheet format's home for the AI panel: below the paper, on the
          workspace — the desk the page lies on. One instance, like every other
          format (see the note in Panel III), and the same one in both of the
          sheet's states, so revealing the report's fields never makes the
          writing assistant move.

          Outside the form on purpose: everything inside `.ir-form--sheet` is the
          page, and an officer who asked for a blank sheet of paper should not
          find a toolbar printed at the foot of it. */}
      {/* The selector's other home, and the same rule: it is a control, so in
          the sheet format it sits on the desk under the paper rather than
          being printed on it. In view in both of the sheet's states, so an
          officer can declare the language while writing on the blank page. */}
      {sheet && <div className="ir-sheet-language">{languagePicker}</div>}

      {sheet && canEdit && <div className="ir-sheet-ai">{aiPanel}</div>}
      {/* Track B — the same panel on the desk under a blank sheet, never on the
          paper: a dictionary printed at the foot of a page would be part of the
          report. */}
      {sheet && canEdit && <div className="ir-sheet-terms">{termsPanel}</div>}

      {/* ...and the action row, under it. The sheet format's whole point is that
          the report's FORM is one click away, not that its controls are: Save
          Draft and Submit stay in view in both of the sheet's states, so the
          blank page is a way to write rather than a locked room. */}
      {sheet && <div className="ir-sheet-actions">{actionsCluster}</div>}

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
                {/* D5 — a non-English narrative is flagged HERE, where the
                    officer confirms — and it never blocks: the confirm button
                    beside this remains the only thing that finalizes, so the
                    warning is read on the way to it rather than instead of it. */}
                {finalizeLanguageWarning(languageCode) && (
                  <span className="finalize-bar-language" role="alert">
                    {finalizeLanguageWarning(languageCode)}
                  </span>
                )}
                {/* Phase 6 Stage 4 (D1/D8) — a translated report that no second
                    officer has verified is SAID here, plainly, and it still
                    files: the confirm button below is unchanged. A verified or
                    disputed report says nothing extra, because its status is
                    already on the form and on the sheet. */}
                {hasSource(draft) && verificationStatus !== 'verified' && (
                  <span className="finalize-bar-language" role="status">
                    {finalizeNotice(languageLabel(draft.narrative_source_language))}
                  </span>
                )}
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
// RowMenu — the register's per-row actions, at the pointer.
//
// The row used to carry four ghost buttons in an ACTIONS column. On a blotter
// that runs to hundreds of rows that is four hundred buttons of chrome competing
// with the data the officer came to read, so the column is gone: the actions
// open on right-click, where the officer is already pointing, and a double-click
// goes straight to the one action that was ever the common case (Open).
//
// Portaled to <body> for two reasons: .table-wrap is a scroll box and would clip
// a menu positioned inside it, and the menu's coordinates are the pointer's,
// which are viewport coordinates. It is measured before it is shown so a
// right-click on the last row of a page does not open a menu off the bottom of
// the screen — where the item the officer wanted would be unreachable.
// ===========================================================================

function RowMenu({ at, items, label, onClose }) {
  const ref = useRef(null);
  // Starts at the pointer and is nudged inside the viewport by the layout effect
  // below, which is why the first paint has no transition to animate.
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      x: Math.max(margin, Math.min(at.x, window.innerWidth - box.width - margin)),
      y: Math.max(margin, Math.min(at.y, window.innerHeight - box.height - margin)),
    });
  }, [at]);

  // Land on the first USABLE item: the menu has to be operable from the keyboard,
  // because Shift+F10 / the Menu key is the only way to reach it without a mouse.
  useEffect(() => {
    ref.current?.querySelector('.row-menu-item:not(:disabled)')?.focus();
  }, []);

  useEffect(() => {
    // A press anywhere outside dismisses. On the menu itself it must not, or the
    // item's own click would never arrive.
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    // A scroll moves the rows out from under the menu (the table scrolls in its
    // own box, so this has to be captured rather than waited for on the window).
    const onMove = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [onClose]);

  // Arrow keys walk the items and wrap at both ends — a menu's own idiom, and
  // the reason a keyboard user does not have to Tab out of the last one to get
  // back to the first. Handled here rather than at the window: it is only right
  // while focus is inside the menu.
  function onKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll('.row-menu-item:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length].focus();
  }

  return createPortal(
    <div
      ref={ref}
      className="row-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'row-menu-item danger' : 'row-menu-item'}
          disabled={item.disabled}
          title={item.hint}
          onClick={() => {
            onClose();
            item.onSelect?.();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ===========================================================================
// ReportsTable — the full blotter with search/filters/sort/pagination.
// Officers see their own reports; admins see everything.
// ===========================================================================

/**
 * What the STATUS heading cycles through, in this order. The register's own
 * order comes first, then the two groupings an officer actually wants from a
 * status sort: the unfinished work on top, and the settled record on top when
 * they are reading the blotter rather than working it.
 *
 * The first state is not "unsorted" — it is the register's normal
 * newest-incident order, the same thing the sort dropdown opens on, which is why
 * the cycle has to come back to it rather than never leaving it.
 *
 * The two status sorts are the server's own `status` column, ascending and
 * descending, so they agree with the dropdown's "Status A→Z / Z→A" and with the
 * export, which reuses the same query. In alphabetical order that reads as
 * draft → finalized (and the reverse); a third status, `submitted`, would sort
 * BETWEEN them rather than after them, which is worth knowing before one is ever
 * used in earnest (see the brief).
 *
 * `hint` is the whole explanation of the state — it is the tooltip, and the only
 * place the state is written out: the heading itself stays the plain word
 * STATUS, with an arrow only while this column is the one sorting.
 */
const STATUS_SORTS = [
  {
    sort: 'incident_datetime',
    dir: 'desc',
    hint: 'Register order — newest incident first. Click for drafts first.',
  },
  {
    sort: 'status',
    dir: 'asc',
    hint: 'Draft reports first, then finalized. Click to put finalized first.',
  },
  {
    sort: 'status',
    dir: 'desc',
    hint: 'Finalized reports first, then drafts. Click for the register order.',
  },
];

export function ReportsTable({
  user,
  notify,
  onMutated,
  onConnError,
  initialStatus,
  formFormat = 'document',
  // Forwarded to the editor this list opens, for the same reason formFormat is
  // (see Shell): a sign-out must save the open draft however it was opened, and
  // Ctrl+S must reach a report opened from the list as well as one opened from
  // Write Report.
  onRegisterFlush,
  onRegisterSave,
  // ...and the station's letterhead, for the same reason again: a report opened
  // from the register gets the sheet format's page exactly as one opened from
  // Write Report does.
  // The officer's own recent reports. Shell already fetches the list for Home,
  // and D7 reads the most recent one's declared language to pre-select the
  // selector on a NEW report — a suggestion only, visible and changeable.
  recentReports = null,
  stationHeader = null,
  // Tells the shell whether this list is showing its own editor panel. The
  // panel replaces the list WITHOUT changing `view.kind` (that is how the
  // list's search, filters and page survive closing a report), so the top bar
  // cannot see it from the route alone — and without this the officer writes a
  // report under a nav that still says My Reports.
  onReportOpenChange,
  // Bumped when the officer navigates TO this list. Clicking My Reports while a
  // report is open here has to land on the LIST: the route was already 'table',
  // so without this the click did nothing at all.
  panelResetSignal = 0,
  // The station's incident-type list, for the type filter's own dropdown — the
  // same list the form offers, since filtering by a type the station no longer
  // records is a filter over an empty set. See TYPES above.
  incidentTypes = null,
}) {
  const typeOptions = incidentTypes && incidentTypes.length > 0 ? incidentTypes : TYPES;
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [conn, setConn] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  // The open row menu: { report, at:{x,y}, rowEl, viaKeyboard }. One at a time,
  // and never for a row with nothing to offer.
  const [menu, setMenu] = useState(null);
  // A report opened for editing from the table (opens in the same panel).
  const [openId, setOpenId] = useState(null);
  // `verification` is a MODE of this same list (Phase 6 Stage 4): 'awaiting'
  // shows translated reports with no review yet, scoped by the server to the
  // languages the account is recorded as reading. Empty = no filter, so an
  // ordinary register is unchanged.
  const [query, setQuery] = useState({ q: '', type: '', status: initialStatus ?? '', date_from: '', date_to: '', sort: 'incident_datetime', dir: 'desc', page: 1, verification: '' });
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState('');
  const [flashId, setFlashId] = useState(null);

  const canFinalize = user.role === 'Admin' || user.role === 'Officer';

  // Which list request this is. Typing fires a request every few hundred
  // milliseconds now (see the debounce effect below), so two can be in flight at
  // once and the NETWORK decides which lands first — a slow "rob" arriving after
  // a fast "robbery" would repaint the register with results for a search the box
  // no longer holds. Only the newest request may write its answer; an older one is
  // dropped, answer and error alike.
  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
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
      if (seq !== loadSeq.current) return;
      setReports(data.reports);
      setPagination(data.pagination);
      setConn(null);
      // The banner belongs to the LAST request: a load that succeeded clears the
      // message an earlier one left behind. Search fires on every pause now, so
      // a refusal (the server caps a query at 12 words) would otherwise sit over
      // a register that has since answered a perfectly good search.
      setError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
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

  // ---- Search runs as you type (there is no Search button any more) --------
  // The box is the immediate value; `query.q` follows it after a pause. The
  // pause is the whole point: this pipeline hits the SERVER — the text ranking
  // and the paging are computed there — so typing "robbery" must not fire seven
  // requests. 350ms sits below the half-second where a search starts to feel
  // laggy and above the gap between ordinary keystrokes, and every other filter
  // on this row still applies the instant it changes (a select is one commit,
  // a text box is not). `query.q` is in the deps only so the guard below can see
  // it catch up; it never starts a timer of its own.
  useEffect(() => {
    if (search === query.q) return;
    const timer = window.setTimeout(() => {
      // Page one: the search has changed, so the page the officer was on means
      // nothing. `q.q` is re-checked here because the box can have moved on
      // (cleared, or edited back) while the timer was pending.
      setQuery((q) => (q.q === search ? q : { ...q, q: search, page: 1 }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, query.q]);

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

  // ---- The row menu --------------------------------------------------------
  // Whether THIS list opens a report, which is one answer used by all three ways
  // in (menu, double-click, Enter) so they can never disagree: the archive is
  // restore-only — an archived report was never opened from here — and a
  // finalized one belongs to an administrator.
  const rowCanOpen = (r) =>
    !showArchived && (r.status !== 'finalized' || user.role === 'Admin');

  /**
   * A report this officer cannot change any more — the register mutes it (see
   * `tbody tr.row-locked`). Finalized is not the same as locked: an admin can
   * still edit one, so for them the row keeps its normal weight.
   */
  const rowLocked = (r) => r.status === 'finalized' && user.role !== 'Admin';

  /** The actions this row offers, in menu order. */
  function rowItems(r) {
    if (showArchived) {
      // Restore is the only action this list has ever offered on an archived
      // report, and it is an administrator's (the Archived toggle is theirs too).
      return user.role === 'Admin'
        ? [{ label: 'Restore', onSelect: () => askRestore(r) }]
        : [];
    }
    return [
      rowCanOpen(r)
        ? { label: 'Open', onSelect: () => setOpenId(r.id) }
        : {
            label: 'Open (locked)',
            disabled: true,
            hint: 'A finalized report can only be edited by an administrator.',
          },
      { label: 'History', onSelect: () => openHistory(r) },
      { label: 'Print', onSelect: () => setPrintingId(r.id) },
      { label: 'Archive', danger: true, onSelect: () => askDelete(r) },
    ];
  }

  /**
   * Which of the three the CURRENT query is on. Derived from sort/dir rather
   * than stored, so the heading stays true when the sort dropdown is used
   * instead: picking "Status A→Z" there lands on the same state as one click
   * here. `-1` (sorted by something else) reads as the default state, which is
   * also what the next click moves on from.
   */
  const statusSort = Math.max(
    0,
    STATUS_SORTS.findIndex((s) => s.sort === query.sort && s.dir === query.dir),
  );

  /** STATUS heading: default → draft first → finalized first → default. */
  function cycleStatusSort() {
    const { sort, dir } = STATUS_SORTS[(statusSort + 1) % STATUS_SORTS.length];
    // Back to page one: page 4 of the new order is a different set of reports,
    // and every other sort control resets the page for the same reason.
    setQuery((q) => ({ ...q, sort, dir, page: 1 }));
  }

  /** What the row tells the officer on hover, which is also its state. */
  function rowHint(r) {
    if (rowCanOpen(r)) return 'Double-click to open · right-click for actions';
    if (showArchived) {
      return user.role === 'Admin' ? 'Archived — right-click to restore' : 'Archived report';
    }
    return 'Finalized — locked. Right-click for actions.';
  }

  /**
   * Open a row's menu. Returns false when the row has nothing to offer, so the
   * caller leaves the browser's own menu alone rather than swallowing a
   * right-click that would lead nowhere.
   */
  function openRowMenu(r, at, rowEl, viaKeyboard) {
    const items = rowItems(r);
    if (items.length === 0) return false;
    setMenu({ report: r, at, rowEl, viaKeyboard });
    return true;
  }

  function closeRowMenu() {
    const opened = menu;
    setMenu(null);
    // A menu opened from the KEYBOARD hands focus back to its row; the editor's
    // own row controls are gone now, so the row is what the officer was on.
    // Not for the mouse: the click that dismissed the menu has already put focus
    // where the officer aimed it.
    if (opened?.viaKeyboard && opened.rowEl && document.contains(opened.rowEl)) {
      opened.rowEl.focus?.({ preventScroll: true });
    }
  }

  // Report the panel to the shell as it opens and closes. On mount this fires
  // `false` too, so a remounted list can never leave the nav claiming a report
  // is open. The shell only reads it while it is displaying THIS list, so a
  // stale value from a list that has been unmounted is harmless.
  useEffect(() => {
    onReportOpenChange?.(openId !== null);
  }, [openId, onReportOpenChange]);

  // A navigation to this list closes the panel. Fires on mount too, where it is
  // a no-op (nothing is open yet).
  useEffect(() => {
    setOpenId(null);
  }, [panelResetSignal]);

  if (openId !== null) {
    return (
      <ReportEditor
        key={openId}
        user={user}
        notify={notify}
        reportId={openId}
        onMutated={onMutated}
        onClosed={() => setOpenId(null)}
        // Same display preference the editor gets from Shell when it is opened
        // from Home or a new report — one report, one layout, however it was
        // opened.
        formFormat={formFormat}
        // ...and the same type list, for the same reason: a report opened from
        // the register must offer what the station actually records, not what
        // the bundle was built with.
        incidentTypes={incidentTypes}
        stationHeader={stationHeader}
        // ...and the officer's own recent reports, which is where D7's
        // suggested language comes from. A report opened from the register is
        // an EXISTING report (its own language is shown), but the same editor
        // creates new ones, so it needs the same input here.
        recentReports={recentReports}
        onRegisterFlush={onRegisterFlush}
        onRegisterSave={onRegisterSave}
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
          {/* The row's actions are behind a right-click now, so the screen has
              to say so somewhere: this is where the officer reads what the page
              does, and the per-row `title` repeats it on hover. */}
          {' '}
          {showArchived
            ? 'Archived reports are restore-only — right-click a row to restore it.'
            : 'Double-click a row to open it; right-click a row for its actions.'}
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
              {/* The box IS the search — see the debounce effect above. The form
                  stays for its `search` landmark and to make Enter inert by
                  default; it has no submit control any more, so the keydown
                  handler below is what Enter means here: "commit what I have
                  typed NOW", which spares a fast typist the pause. Escape still
                  clears the search outright. */}
              <form
                className="reports-search"
                role="search"
                onSubmit={(e) => e.preventDefault()}
              >
                <input
                  type="search"
                  placeholder="Search complainant, victim, suspect, place, narrative, officer…"
                  aria-label="Search reports by complainant, victim, suspect, place, narrative, or officer"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setQuery((q) => ({ ...q, q: search, page: 1 }));
                      return;
                    }
                    if (e.key === 'Escape') {
                      setSearch('');
                      setQuery((q) => ({ ...q, q: '', page: 1 }));
                    }
                  }}
                />
              </form>
              <select
                aria-label="Filter by incident type"
                value={query.type}
                onChange={(e) => setQuery((q) => ({ ...q, type: e.target.value, page: 1 }))}
              >
                <option value="">All types</option>
                {typeOptions.map((t) => (
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
                {/* Open work is the filter an officer actually needs, and it
                    was Admin-only. The server never restricted it: `attention`
                    is a plain `status != 'finalized'` on the same own-reports
                    scope, so an officer's queue is their own queue. */}
                <option value="attention">Needs attention (draft + submitted)</option>
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
              {/* Phase 6 Stage 4 — the awaiting-verification view. A second
                  officer's queue: translated reports they can read and nobody
                  has reviewed yet. The server filters by their recorded
                  languages; this control only asks. */}
              <select
                aria-label="Filter by translation review"
                value={query.verification}
                onChange={(e) => setQuery((q) => ({ ...q, verification: e.target.value, page: 1 }))}
              >
                <option value="">All translations</option>
                <option value="awaiting">Awaiting verification</option>
              </select>
              {(query.q || query.type || query.status || query.date_from || query.date_to || query.verification) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setQuery((q) => ({ q: '', type: '', status: '', date_from: '', date_to: '', sort: q.sort, dir: q.dir, page: 1, verification: '' }));
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
                  <th
                    className="status"
                    // The register's one sortable heading. The states are NOT
                    // printed under it (by request — the heading stays the plain
                    // word); the arrow beside it appears only while this column is
                    // the sort, and the tooltip names which state it is in.
                    // aria-sort is the same thing for assistive tech, and it
                    // matches what the server is actually told to do.
                    aria-sort={statusSort === 0 ? 'none' : statusSort === 1 ? 'ascending' : 'descending'}
                  >
                    <button
                      type="button"
                      className="th-sort"
                      onClick={cycleStatusSort}
                      title={STATUS_SORTS[statusSort].hint}
                    >
                      Status
                      {/* Just the word, as asked. The one thing that has to stay
                          is SOME sign that a click took effect: the arrow shows
                          only while this column is sorting, and it is what says
                          which way the statuses are grouped. The tooltip above
                          spells all three states out. */}
                      {statusSort > 0 && (
                        <span className="th-sort-arrow" aria-hidden="true">
                          {statusSort === 1 ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  </th>
                  <th>Recorded By</th>
                  {/* No Actions column: the actions are the row's context menu
                      now (right-click), and a double-click opens the report.
                      Keeping the column would have left a header with nothing
                      under it. */}
                </tr>
              </thead>
              <tbody>
                {reports &&
                  reports
                    .map((r) => (
                    <tr
                      key={r.id}
                      // Focusable: with the buttons gone, this is what keeps a
                      // row's actions reachable without a mouse — Enter opens,
                      // Shift+F10 / the Menu key opens the menu at the row.
                      tabIndex={0}
                      aria-haspopup="menu"
                      className={rowLocked(r) ? 'row-locked' : undefined}
                      title={rowHint(r)}
                      onDoubleClick={() => {
                        if (rowCanOpen(r)) setOpenId(r.id);
                      }}
                      onContextMenu={(e) => {
                        if (!openRowMenu(r, { x: e.clientX, y: e.clientY }, e.currentTarget, false)) return;
                        e.preventDefault();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && rowCanOpen(r)) {
                          e.preventDefault();
                          setOpenId(r.id);
                          return;
                        }
                        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
                        // A keyboard has no pointer to open at, so the menu drops
                        // from the row's own box — left edge, just below it.
                        e.preventDefault();
                        const box = e.currentTarget.getBoundingClientRect();
                        openRowMenu(r, { x: box.left + 12, y: box.bottom }, e.currentTarget, true);
                      }}
                      style={flashId === r.id ? { transition: 'background 300ms ease', background: 'var(--green-bg)' } : undefined}
                    >
                      <td className="num">BW-{String(r.id).padStart(4, '0')}</td>
                      <td>{r.incident_type}</td>
                      <td>{fmtIncident(r.incident_datetime)}</td>
                      <td>{r.location}</td>
                      <td className="status">
                        <span className={`badge ${r.status}`}>{r.status}</span>
                        {/* Phase 6 Stage 4 (D5/D8) — the translation status,
                            derived server-side from the SAME function every
                            other surface uses. Only shown when there is
                            something to say: a report with no source is left
                            exactly as it was. */}
                        {r.verification_status && r.verification_status !== 'english_original' && (
                          <span
                            className={`rv-badge rv-badge--sm ${statusClass(r.verification_status)}`}
                            title={statusLabel(r.verification_status)}
                          >
                            {statusLabel(r.verification_status)}
                          </span>
                        )}
                      </td>
                      <td>{r.created_by_name || '—'}</td>
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

      {/* The row's actions, at the pointer. Rendered here rather than inside
          the table row so it survives the row's own re-render, and portaled to
          <body> by RowMenu itself. */}
      {menu && (
        <RowMenu
          at={menu.at}
          items={rowItems(menu.report)}
          label={`Actions for report BW-${String(menu.report.id).padStart(4, '0')}`}
          onClose={closeRowMenu}
        />
      )}

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
