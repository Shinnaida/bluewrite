import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
// The row menu lives in its own file now: the dashboard chart offers the same
// right-click menu on a day of "Reports over time".
import RowMenu from './RowMenu.jsx';
// The register is a SHELF OF FOLDERS now: one glass folder per incident type
// per status shelf, and opening a folder lists the reports inside it.
import GlassFolder from './GlassFolder.jsx';
import ReportList from './ReportList.jsx';
// The type glyph, worn by the header of an OPENED folder — the folder face
// itself carries no icon (its label is the label), which is what the design
// asks for. The glyph map, the shelf/tally folding and the sentences a folder
// and a row say about themselves all live in the same pure module, so they can
// be asserted in tests rather than eyeballed in the JSX.
import ReportTypeIcon from './ReportTypeIcon.jsx';
import {
  typeIcon,
  buildShelves,
  shelvesFor,
  folderTrail,
  statusBucket,
  reportNumber,
} from '../lib/reportFolder.js';
import { AI_ADVISORY } from '../lib/appInfo.js';
import ReportPrint from './ReportPrint.jsx';
// The same bondpaper the print sheet draws, rendered INLINE after the officer
// accepts an AI draft (Task 4). One implementation, shared with ReportPrint, so
// the reveal and the print-out cannot drift.
import ReportSheetBody from './ReportSheetBody.jsx';
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
  meaningfulRows,
  // The review step's copy of a group row reads the same two rules the form
  // does: which fields that row is showing, and the words a stored value is
  // shown under (Identity: "Identified" is offered and read as "Known").
  rowFieldVisible,
} from '../lib/reportRules.js';
import { optionLabel } from '../lib/dropdownOptions.js';
// Phase 7 — the account read's merge rules (POST /ai/classify → the form).
// Pure and separately tested: it owns the ONE rule the silent fill depends on,
// which is that it fills blanks and touches nothing the officer has written.
import { buildClassifyFill, buildTypeDetailsFill, classifyFillIsEmpty } from '../lib/classifyFill.js';
import { normalizeLegacyTypeSpecific, hasLegacyShape } from '../lib/normalizeLegacy.js';
import { stripLeadingBlotterRestatement } from '../lib/narrativeText.js';
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
// Every option list on this screen: the two typeable boxes (the incident type
// and the reporting party's capacity) and each per-type dropdown. Drawn rather
// than native, because a native menu cannot be painted — see the component.
import Dropdown from './Dropdown.jsx';
import AiNarrativePanel from './AiNarrativePanel.jsx';
// Phase 6 Stage 4 — the translation review surface: the original beside the
// English, the derived status, and (when the server allows it) the verify /
// dispute form. Same component for the editor and the reviewing officer, since
// a verifier opens the report read-only through the same screen.
import ReportVerificationPanel from './ReportVerificationPanel.jsx';
// Phase 6 Stage 5 Track B — the terminology table (NarrativeTermsPanel.jsx) is
// deliberately NOT imported here: the glossary ships with zero approved terms
// today, so the only thing it could draw on this screen is its empty-state
// disclaimer, which reads like a fault on a form that otherwise works. The
// component is untouched and returns with the glossary — see `termsPanel` below
// for the two places to re-add it.
// Home's backdrop only — the animated grid behind the wordmark and the register
// tail. Nothing else in the app renders it (see HomeGrid.jsx).
import HomeGrid from './HomeGrid.jsx';
// The official-document stylesheet: the navy top bar, page head, card panels,
// field labels and signature blocks. Shared by every screen now that the whole
// application uses this look (the tokens themselves live in styles.css).
import '../incident-report.css';
import {
  caseNumber,
  reportDateValue,
  specDate,
  CUSTOM_TYPE,
  incidentTypeBoxValue,
  resolveIncidentTypeInput,
} from '../lib/incidentReport.js';
// Phase 6 Stage 1 — the language of the narrative. One module behind the
// detector, the "not translated" notice, the AI guard's reason, the finalize
// warning and the printed line, so the editor and the sheet cannot disagree
// about what a code means.
//
// There is no language SELECTOR any more. The language is read from the text
// the officer writes (detectNarrativeLanguage) instead of declared by hand, so
// nothing here offers the four codes — that is the module's own job now.
import {
  detectNarrativeLanguage,
  DEFAULT_LANGUAGE,
  languageLabel,
  normaliseLanguage,
  aiBlockedReason,
  finalizeLanguageWarning,
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
  // Reporting party (migration 006, Panel I of the Write Report screen).
  // Separate from created_by: the person filing the report is not always the
  // officer on the record.
  //
  reporter_name: '',
  reporter_contact: '',
  reporter_address: '',
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

// What an EMPTY shelf says. It names the shelf rather than a generic "nothing
// here", because WHICH one is empty is the fact worth stating: no drafts is a
// clean desk, nothing submitted is work still to do, and an empty archive is a
// station that has never thrown a report away.
function emptyShelfNote(shelf, { archived, awaiting }) {
  if (archived) return 'Nothing is archived here.';
  if (awaiting) return 'Nothing is waiting for a review.';
  return shelf.key === 'draft'
    ? 'No drafts here — a new report starts on this shelf.'
    : 'Nothing submitted here yet.';
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
  reporter_contact: 'Contact number',
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
  // A card that is NOT one of the report's ordinary sections: accent-edged and
  // tinted so it reads as a different kind of block (today, the AI assistant).
  accent,
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
        accent ? ' ir-card--accent' : ''
      }${sheetPage ? ' ir-card--sheet-page' : ''}`}
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
          {title && <span>{title}</span>}
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

// There is deliberately NO scheme-flipping machinery here any more. It existed
// for the menus the BROWSER drew behind `<input list>`: a menu that is not a DOM
// node, painted from the option values, reachable only by `color-scheme` — and
// therefore near-black in the dark theme, which is why the document had to
// answer as light while one was open. Every option list on this screen is now
// drawn by Dropdown.jsx, which is a real element on the page and wears the theme
// like everything else, so nothing has to be flipped and no attribute has to be
// put on and taken off while a field is engaged.

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
              <Dropdown
                id={id}
                options={fld.select}
                emptyLabel="Select…"
                value={val}
                onChange={set}
                disabled={disabled}
                required={isRequired}
                invalid={problem ? true : undefined}
                placeholder="Select…"
              />
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
  { label: 'Reporting party', paths: ['reporter_name', 'reporter_contact', 'reporter_address'] },
  { label: 'Incident details', paths: ['incident_type', 'incident_datetime', 'location'] },
  { label: 'Narrative', paths: ['narrative'] },
  // The polymorphic section: the repeatable groups (a bare key like `vehicles`
  // or a per-item path like `vehicles[2].plate_number`) plus any per-type
  // scalar path. Checked against the type chosen NOW, so a group that does not
  // exist for this type can never count against it.
  { label: 'Type-specific', paths: [], typeSpecific: true },
  { label: 'Action taken', paths: ['action_taken', 'ioc_name'] },
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
    // The type-specific section reads "no problems" without anything having
    // been filled in, so the rules alone would call it finished, and it is not:
    // on a type whose groups are ALL optional and whose scalars are unrequired
    // (Drug-Related Incident) every other type is caught by a count floor, but
    // that one would read done the moment a type was chosen. So it needs the
    // officer to have engaged with it, and a type to exist at all.
    // Section 1 used to be in the same boat (every reporter field was optional).
    // It is not any more — the reporting party's name and contact number are
    // required at finalize (validateReporterParty), so a blank card is FLAGGED,
    // and the engagement fallback below only covers the already-complete case.
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
  reporter_contact: { type: 'tel', autoComplete: 'tel', placeholder: '(000) 000-0000' },
  reporter_address: {
    autoComplete: 'street-address',
    placeholder: 'Street, barangay, city / municipality',
  },

  location: { placeholder: 'Specific address or intersection' },
  ioc_name: { placeholder: 'Name of the officer handling the case' },
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
  const {
    draft,
    errors,
    set,
    setNarrative,
    setActionTaken,
    setIncidentTypeTyped,
    endEdit,
    types = TYPES,
  } = edit;
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
    // Typeable here too, calling the SAME setter the form does — an edit made
    // from the read-back has to store what the form would have stored.
    return shell(
      <>
        <Dropdown
          ref={ref}
          id={id}
          typeable
          options={types}
          placeholder="Type or choose an incident type…"
          value={incidentTypeBoxValue(draft)}
          onChange={setIncidentTypeTyped}
          label={label}
          invalid={!!errors.incident_type}
          optionIcon={<LabelIcon name="hash" />}
        />
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
          {/* Name and Contact Number are what the report cannot be submitted
              without (see validateReporterParty): a blank one has to read as a
              MISSING requirement here, not as an ordinary blank the sheet
              omits. The address stays optional. */}
          <ReviewRow
            label="Full Name"
            value={draft.reporter_name}
            required
            {...editable('reporter_name')}
          />
          <ReviewRow
            label="Contact Number"
            value={draft.reporter_contact}
            required
            {...editable('reporter_contact')}
          />
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
          {/* The type row reads back what the box shows — for an Other Incident
              that carries a specification, that is the specification itself, so
              the read-back matches the field the officer typed into. */}
          <ReviewRow
            label="Type of Incident"
            value={incidentTypeBoxValue(draft)}
            required
            {...editable('incident_type')}
          />
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
                        // A field this row is not showing is not part of what the
                        // row says, even if a stale value is still sitting in
                        // the draft.
                        (fld) =>
                          rowFieldVisible(fld, item) &&
                          String(item?.[fld.key] ?? '').trim() !== '',
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
                                    {optionLabel(String(item[fld.key]).trim(), fld.optionLabels)}
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
          {/* A derived read-out, deliberately NOT editable: the badge line comes
              from the account. A path here would offer an edit that has nowhere
              to be written. The signature rows that used to close this section
              went with Panel IV — the station asked for the signature block off
              the form, so the read-back must not promise a line the paper does
              not carry. */}
          <ReviewRow label="Badge No." value={`${user.badge_number} · ${user.full_name}`} />
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
      {/* Home's backdrop: the React Bits ShapeGrid, behind everything and
          marking nothing (see HomeGrid.jsx for the tokens it reads, why it
          stands down for reduced motion, and the numbers). FIRST child, so it
          is the bottom layer; it is absolutely positioned, so it costs the
          layout nothing. */}
      <HomeGrid />

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
  // The officer's own recent reports. Shell already fetches this list for Home,
  // which is why the prop is still wired here: it used to feed D7's suggestion
  // (the most recent report's language, pre-selected on a new one), and D7 went
  // with the selector when the language became detected. Nothing reads it now.
  recentReports = null,
  stationHeader = null,
}) {
  const typeOptions = incidentTypes && incidentTypes.length > 0 ? incidentTypes : TYPES;
  const letterhead = resolveHeader(stationHeader);
  // For a new report, start with the empty form immediately; for an existing
  // one, null until fetched. (Starting null for BOTH would crash the first
  // render — effects run after render, so the new-report path must be ready.)
  // A NEW report starts from the empty form. It does NOT start from the
  // language of the officer's last report any more: nothing declares a language
  // now, and a suggestion would be a label with no officer behind it — a fresh
  // report would open claiming 'ceb' and quietly disable Tighten until the
  // first sentence was typed. The field fills itself from the text (see
  // setNarrative), which is the only thing that can answer the question.
  const [draft, setDraft] = useState(() => (reportId === null ? EMPTY : null));
  // Task 4 — the narrative area's view: the raw fields, or the bondpaper the
  // accepted draft will print on. LOCAL UI state (like formFormat): it is never
  // sent to the API and never written into `draft`. The editor is keyed per
  // report, so navigating to a fresh report remounts this back to 'fields'.
  // Accept (applyAiDraft) is the only thing that flips it to 'sheet' — the AI
  // panel types an uncommitted draft into its OWN card (see the `sheet` prop
  // below), so nothing here previews work that has not been accepted yet.
  const [narrativeView, setNarrativeView] = useState('fields');
  // Bumped by the inline sheet's Regenerate control; the AI panel watches it and
  // re-runs the last press (see AiNarrativePanel's `regenSignal`).
  const [regenNonce, setRegenNonce] = useState(0);
  // The type_specific the inline sheet reads: normalized the same way the print
  // sheet normalizes it (legacy flat keys → groups), so the reveal and the
  // print-out agree about every fact. Purely derived; nothing is written back.
  const inlineTs = useMemo(
    () => normalizeLegacyTypeSpecific(draft?.type_specific ?? {}, draft?.incident_type ?? '', draft),
    [draft],
  );
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
  // format's opening state: the station's letterhead on a blank page and nothing
  // else — no labels, no boxes, no fields to read — with the report's structured
  // part arriving when the officer asks for it (the reveal control below the
  // paper). Component state, not a stored preference, and NOT part of the
  // editor's key: it is a view of one report, so it resets with the report and
  // never re-lays-out a draft.
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
    // The record's language follows the TEXT, in the same update as the text.
    // This is the only thing that writes narrative_language now that the
    // selector is gone (see detectNarrativeLanguage): detection cannot be
    // skipped by a caller, cannot go stale against a narrative it no longer
    // describes, and never touches a character of what the officer wrote.
    //
    // A functional update, so it reads the narrative set() just queued, and it
    // returns the SAME object when the verdict has not changed — a long English
    // narrative re-renders exactly as often as it used to.
    const detected = detectNarrativeLanguage(value);
    setDraft((d) => (d.narrative_language === detected ? d : { ...d, narrative_language: detected }));
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

  // The Incident Details type box is TYPABLE (see Panel II's dropdown): the
  // station's types are its suggestions, and anything else the officer types is
  // recorded as an "Other Incident" whose Category is that text — where such a
  // report already keeps its specification, so no field is added or revealed.
  // What the text RESOLVES to is a pure rule of its own (resolveIncidentTypeInput,
  // covered by node:test); this only writes it.
  //
  // Every keystroke rewrites the type, so a half-typed "Theft" reads as a custom
  // Other Incident for a moment. That is deliberate: the alternative is holding
  // the text outside the draft, and the draft is what autosave, the stepper and
  // the rule engine all read. It corrects itself the instant the text matches a
  // type on the list.
  function setIncidentTypeTyped(text) {
    const { type, custom } = resolveIncidentTypeInput(text, typeOptions);
    if (type !== CUSTOM_TYPE) {
      // A real type on the list, or the box cleared. The specific fields belong
      // to the OLD type, which is exactly what changeType has always ruled — so
      // this reuses it rather than restating the rule. Skipped when nothing
      // changed, so re-picking the type already chosen does not wipe the
      // type-specific fields underneath it.
      if (String(draftRef.current?.incident_type ?? '') !== type) changeType(type);
      return;
    }
    // Not a type on this station's list: an Other Incident, specified. Its
    // Category IS the specification (a required field of that type), so the text
    // lands where such a report already keeps it and no field is revealed.
    dirtyRef.current = true;
    setDraft((d) => ({
      ...d,
      incident_type: CUSTOM_TYPE,
      type_specific: { ...d.type_specific, incident_category: custom },
    }));
    if (errors.incident_type) setErrors((e) => ({ ...e, incident_type: undefined }));
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
  // words, the language they were written in, and marks the report English in
  // the same save. Shared by the plain accept path and Track C's guided step 1.
  function applyAiNarrative(aiText, sourceMeta) {
    // Task 6 — the certification line above FACTS OF THE CASE already carries
    // the blotter entry number and its date, so a leading restatement of it is
    // dropped before the text reaches the report. The server does this too;
    // this keeps the form's own copy identical for a draft that arrived by any
    // other path.
    const narrative = stripLeadingBlotterRestatement(aiText);
    set('narrative', narrative);
    narrativeSourceRef.current = 'ai-assisted';
    if (sourceMeta && sourceMeta.language && sourceMeta.language !== 'en') {
      // The text IS the English translation of a known source: the language is
      // a fact the server just established, so it is not re-detected.
      set('narrative_language', 'en');
      set('narrative_source_text', sourceMeta.text ?? '');
      set('narrative_source_language', sourceMeta.language);
    } else {
      // No source pair: this draft was written from the report itself rather
      // than translated from a stored source, so its language is read from the
      // text like any other. Detecting here keeps the rule in one place — the
      // AI writing English must leave the record saying English.
      set('narrative_language', detectNarrativeLanguage(narrative));
    }
  }

  // THE DRAFT'S TWO FORMALISED BLOCKS, written into the fields that save,
  // snapshot and print. Generating a draft writes nothing (see the AI panel):
  // the panel holds all three parts and Accept carries them over, so these two
  // helpers and the officer's own typing are the only ways either field changes.
  //
  // Empty is "nothing to propose", never "clear the field": a draft with no
  // findings left the officer's own wording alone, and it still does — which is
  // also why every control that calls these is offered only when it actually
  // proposes something. Identical text is not a rewrite either (it would raise a
  // spurious unsaved-changes state for no change).
  function applyFindingsText(text) {
    const next = String(text ?? '');
    const prev = String(draftRef.current?.type_specific?.notable_findings || '');
    if (next.trim() === '' || next === prev) return;
    // Remember what is about to be replaced so the formalisation can be rejected
    // with one click. Only the FIRST snapshot counts: Undo must reach the
    // officer's own pre-AI wording, not the last AI text the field happened to
    // hold.
    setAiUndo((u) => ({ ...u, findings: u.findings ?? prev }));
    setTypeSpecific('notable_findings', next);
  }
  // Same rule for the formalised ACTION TAKEN / STATUS line.
  function applyActionTakenText(text) {
    const next = String(text ?? '');
    const prev = String(draftRef.current?.action_taken || '');
    if (next.trim() === '' || next === prev) return;
    setAiUndo((u) => ({ ...u, action_taken: u.action_taken ?? prev }));
    set('action_taken', next);
  }

  // ACCEPT, in the panel's own terms: one draft, one action, three parts. The
  // parts it was not given are simply not written — a tighten result hands over
  // its narrative alone, because its two field proposals have their own buttons
  // and accepting the wording must not smuggle them in.
  function applyAiDraft(parts, sourceMeta) {
    const narrative = String(parts?.narrative ?? '');
    applyAiNarrative(narrative, sourceMeta);
    if (typeof parts?.findingsText === 'string') applyFindingsText(parts.findingsText);
    if (typeof parts?.statusText === 'string') applyActionTakenText(parts.statusText);
    // Task 4 — accepting reveals the bondpaper the draft will print on, in place
    // of the raw narrative field. The fields stay MOUNTED (hidden), so an error
    // jump to r-narr still resolves; an empty narrative reveals nothing, because
    // there would be no page to show. TASK 9 — this is also the FIRST time the
    // recorded page appears in the FORM: the typing preview happens in the AI
    // panel's own card (see the `sheet` prop below), where Generate was pressed,
    // so Accept is what puts the words into the report and this view is what
    // shows they arrived.
    if (narrative.trim() !== '') setNarrativeView('sheet');
  }

  // The inline sheet's two controls. Edit returns to the raw fields; Regenerate
  // asks the AI panel to run its last press again (the panel watches
  // `regenNonce`), and the new accept reveals the sheet once more.
  function editNarrativeFields() {
    setNarrativeView('fields');
  }

  function regenerateNarrative() {
    // TASK 9 — the new draft types into the AI panel's own bondpaper (see the
    // `sheet` prop below), which is where the panel lives; the panel brings
    // itself into view for a press made out here, so the officer follows the
    // words instead of being left on the page they pressed from. The committed
    // page stays exactly as it is until the new draft is accepted.
    setRegenNonce((n) => n + 1);
  }

  // Phase 7 — the account read (POST /ai/classify), wired to the AI panel's
  // Generate button IN THE SHEET FORMAT ONLY.
  //
  // WHY IT EXISTS. The sheet opens on a blank page: the officer types the whole
  // account on it, and every structured field is empty. Generate is then the one
  // press that has to make a report out of that page — and it cannot, because a
  // report is created with an incident type, a date and a place (see
  // ensureAiReportId → writeDraft), none of which the officer typed. So the read
  // runs first, fills the blanks out of the officer's own words, and the save
  // and the narrative draft follow exactly as they always did.
  //
  // WHY ONLY THERE. In the stepped and document formats the fields are on
  // screen to type into and Generate already works, so the panel is handed no
  // reader at all (`onReadAccount` is undefined) and this function is never
  // called from them.
  //
  // WHAT IT MAY CHANGE is the whole of src/lib/classifyFill.js — the account
  // read (buildClassifyFill) and the TYPE-SCOPED read that follows it
  // (buildTypeDetailsFill, for the type's own vehicles/items/injuries/entry
  // point, which the first call has no field for): blanks only, a type on the
  // form's own list, named people into groups this type actually has. It writes
  // nothing itself — every field goes through the form's own setter, so the
  // dirty flag, the autosave, the rule engine and the history see an ordinary
  // edit and nothing else.
  //
  // THE SECOND CALL IS SCOPED BY THE FIRST ONE'S ANSWER, which is why the two
  // are ordered inside this one function rather than offered as two props: the
  // type the form now holds IS the field list to read against, and it cannot be
  // known before the first answer lands. A read that names no type — and an
  // officer who typed none either — skips it entirely; the panel's own message
  // then says the report still needs a type, and the next press reads on.
  async function readAccountForForm(accountText) {
    const account = String(accountText || '').trim();
    if (account === '') {
      return { ok: false, message: 'Write the incident in your own words first — there is nothing to read yet.' };
    }
    try {
      const out = await api('/ai/classify', { method: 'POST', body: { account } });
      const before = draftRef.current ?? {};
      const fill = buildClassifyFill(out?.fields ?? {}, before, typeOptions);
      // Nothing to change is a real answer (a report already filled in by hand),
      // and the honest response to it is to change nothing at all.
      if (!classifyFillIsEmpty(fill)) {
        // The ref is brought up to date HERE, before the setters below, and the
        // reason is the very next thing Generate does: `ensureReportId` SAVES
        // the draft (writeDraft) and it reads `draftRef`, not the state this
        // function is about to queue — React has not re-rendered yet, and it
        // will not until this async function yields. Without this line the save
        // would post the report the officer typed (no type, no date, no place)
        // and be refused, seconds after the read just filled all three.
        draftRef.current = {
          ...before,
          ...fill.patch,
          type_specific: mergeClassifiedGroups(before.type_specific, fill.groups, fill),
        };
        // One `set` per field: it is a functional update, so the patch lands in
        // a single render and the form is never seen half-filled.
        for (const [key, value] of Object.entries(fill.patch)) set(key, value);
        if (Object.keys(fill.groups).length > 0) {
          dirtyRef.current = true;
          setDraft((d) => ({ ...d, type_specific: mergeClassifiedGroups(d.type_specific, fill.groups, fill) }));
        }
      }
      // THE SECOND HALF OF THE READ. The first call settles WHAT the incident
      // is; only then does that kind's own field list exist — the vehicles and
      // their plates, the items taken, the injuries, the entry point. Without
      // it the type-specific block stays empty on the one format where nothing
      // else is going to fill it (the officer types an account on the page, not
      // a form), which is the whole reason this read exists. It is scoped by
      // the type the form now holds, and REFUSED SERVER-SIDE for a type whose
      // field list the app does not know.
      const afterFirst = draftRef.current ?? before;
      let details = null;
      // A failed SECOND read is not a failed first one, but it is not nothing
      // either: the type's own block is the half an officer is most likely to
      // notice missing, and silence there reads as "the AI found nothing" when
      // it means "the AI was never asked". Reported on the receipt.
      let detailsFailed = false;
      if (afterFirst.incident_type) {
        try {
          const answer = await api('/ai/classify/details', {
            method: 'POST',
            body: { account, type: afterFirst.incident_type },
          });
          details = buildTypeDetailsFill(answer ?? {}, afterFirst);
          if (!classifyFillIsEmpty(details)) {
            draftRef.current = { ...afterFirst, type_specific: applyTypeDetailsFill(afterFirst, details) };
            setDraft((d) => ({ ...d, type_specific: applyTypeDetailsFill(d, details) }));
            // A group row or a scalar written straight into the draft is an
            // ordinary edit like any other (the first read's own patch goes
            // through `set`, which flags it the same way).
            dirtyRef.current = true;
          }
        } catch {
          // Never fatal, for the same reason the first call is not: what the
          // first read already put on the form stands, and an unread detail
          // block is exactly the state the sheet was in before this call
          // existed. The press continues to the save and the draft.
          details = null;
          detailsFailed = true;
        }
      }

      const changed = !classifyFillIsEmpty(fill)
        || (details !== null && !classifyFillIsEmpty(details));
      if (changed) {
        // The verdict on the page was reached BEFORE these fields existed, so
        // it is dropped the same way a generate that passes drops it ("a
        // previous failed attempt's banner must not linger"): a red "Incident
        // type is required." left under a field the read just filled is the
        // one thing that would make the fill look like it had not happened.
        // Submit re-runs every rule, so nothing is being excused here.
        setError(null);
        setErrors({});
        setGroupErrors({});
        setRuleWarnings(null);
      }

      // WHAT THE REPORT ITSELF STILL NEEDS. Not the model's view of the account
      // — the rule engine's view of the DRAFT, which is what Submit will say in
      // a moment. Only the type's own fields (type_specific paths) are taken:
      // the common fields and the group floors are already on screen with the
      // officer's own attention on them, and a read that ends in "Submit is
      // still blocked and nothing said why" is the confusion this line exists
      // to end. It is a REPORT, not a gate — the read has made its changes and
      // nothing here blocks or retries anything.
      const stillNeeded = validateReport(draftRef.current ?? {}, 'finalize')
        .errors.filter((e) => String(e.path ?? '').startsWith('type_specific.'))
        .map((e) => e.message);

      return {
        ok: true,
        filled: [...fill.filled, ...(details?.filled ?? [])],
        stillNeeded,
        // Both halves answer about the SAME account, so the lines are joined
        // rather than one list replacing the other — and deduplicated, because
        // a name neither read could mask is a fact about the account, and
        // stating it twice would read as two findings.
        unstated: [...new Set([...fill.unstated, ...(details?.unstated ?? [])])],
        // Names the account mentions that nothing could have masked: on this
        // call there is no structured record to build a value map from. The
        // endpoint reports them rather than hiding them, and so does the panel.
        residual: Array.isArray(out?.residualRisk) ? out.residualRisk : [],
        detailsFailed,
      };
    } catch (err) {
      // Never fatal. The gate that follows says what the report still needs,
      // with its jump-to-field links, and the panel adds this line to it.
      //
      // `retryable` is the SERVER's verdict, not this client's guess: the
      // provider's failures travel as `manual_mode` (true when the provider
      // said no — a rejected key, a bad request — and false when it was merely
      // busy or had a fault of its own). Only the second kind is worth waiting
      // out, and only the panel decides how (see READ_ATTEMPTS).
      return {
        ok: false,
        message: err?.message || 'Your account could not be read.',
        retryable: err?.manual_mode === false,
      };
    }
  }

  // The TYPE-SCOPED read's answer, written into a draft's type_specific. ONE
  // implementation, called twice: once for the ref the save reads, once for the
  // state the officer sees — the two must agree, and the way to make them agree
  // is to compute it once. Unlike mergeClassifiedGroups below, the rows in
  // `fill.groups` are each group's COMPLETE list (src/lib/classifyFill.js has
  // already merged the officer's own rows into it), so they REPLACE the group
  // rather than being appended to it — appending would duplicate the officer's
  // own vehicle every time they press Generate.
  function applyTypeDetailsFill(base, fill) {
    const ts = { ...(base.type_specific ?? {}), ...fill.patch };
    for (const [groupKey, rows] of Object.entries(fill.groups)) ts[groupKey] = rows;
    return syncMirrors(base.type_specific, ts, base.incident_type ?? '');
  }

  // The named people the read found, placed in the groups this type actually
  // has, and the derived scalars those groups supersede (Owner of Property,
  // Item…) brought along with them. ONE implementation, called twice: once to
  // prime the ref the save reads, once for the state the officer sees — the two
  // must agree, and the way to make them agree is to compute it once.
  function mergeClassifiedGroups(typeSpecific, groups, fill) {
    if (!groups || Object.keys(groups).length === 0) return typeSpecific;
    const ts = { ...typeSpecific };
    for (const [groupKey, rows] of Object.entries(groups)) {
      // A row the officer left BLANK is not a row (see meaningfulRows), so the
      // named people take those slots instead of queueing behind them.
      ts[groupKey] = [...meaningfulRows(ts[groupKey]), ...rows];
    }
    return syncMirrors(typeSpecific, ts, fill.type || '');
  }

  // Phase 6 Stage 5 (Track C) — the guided flow's step 1: apply the reviewed
  // draft AND save it. The save is not decoration: the tighten endpoint refuses
  // while the STORED report still declares a non-English narrative
  // (NarrativeController::tighten), and that guard is deliberately not weakened
  // to spare the client a round trip. The body is built from draftRef — the same
  // latest-values ref the autosave uses — with the three reviewed parts written
  // over it, because the setters below only QUEUE and this save has to carry
  // them itself. It is the guided flow's accept, so it carries all three: half a
  // draft would leave the record holding one part in English and two in the
  // officer's own language.
  async function applyGuidedTranslation(parts, sourceMeta) {
    const narrative = String(parts?.narrative ?? '');
    const findings = String(parts?.findingsText ?? '');
    const status = String(parts?.statusText ?? '');
    const hadSource = !!(sourceMeta && sourceMeta.language && sourceMeta.language !== 'en');
    const current = draftRef.current ?? {};
    if (!current.incident_type) {
      throw new Error('Choose the incident type first — the report cannot be saved without it.');
    }
    const ts = { ...(current.type_specific ?? {}) };
    if (findings.trim() !== '') ts.notable_findings = findings;
    const next = {
      ...current,
      narrative,
      // An empty block proposes nothing, exactly as it does on the plain accept
      // path, so the field the officer wrote keeps what they wrote.
      action_taken: status.trim() !== '' ? status : current.action_taken,
      type_specific: ts,
      ...(hadSource
        ? {
          narrative_language: 'en',
          narrative_source_text: sourceMeta.text ?? '',
          narrative_source_language: sourceMeta.language,
        }
        : {}),
    };
    const body = { ...next, status: 'draft', narrative_source: 'ai-assisted' };
    const id = idRef.current
      ? await api(`/reports/${idRef.current}`, { method: 'PATCH', body }).then(() => idRef.current)
      : await api('/reports', { method: 'POST', body }).then((created) => created.report.id);
    adoptSavedId(id);
    // The form is brought up to what was just saved — through the SAME appliers
    // the plain accept uses, so the two ways into a draft leave the form in
    // exactly one state. The dirty flag is cleared last, after them: those
    // setters raise it, and the record is already saved.
    applyAiDraft(parts, sourceMeta);
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

  /**
   * The AI's report id, guaranteed — the id the AI panel addresses its requests
   * to, and the reason the panel can be offered on a report that has never been
   * saved.
   *
   * Generate, Translate and Tighten are all per-report endpoints: the server
   * files the request against a row and reads the report's stored language back.
   * So the FIRST ask has to create the report, and this is what does it — off
   * the officer's Generate click, not off a Save Draft they had to find
   * themselves (which in the sheet format sits below a full sheet of paper).
   *
   * The write is writeDraft, the autosave's own: same body, same latest-values
   * ref, and the same in-flight de-duplication, so asking for the id can never
   * race an autosave into creating a second report — and it returns null for a
   * report with no incident type, which is why the panel's own message names
   * the three fields Gate 1 wants.
   */
  async function ensureAiReportId() {
    if (idRef.current) return idRef.current;
    let id;
    try {
      id = await writeDraft();
    } catch (err) {
      // Offline, session ended, server refused: the editor's own banner says
      // which, and the panel does not go on to make a request it cannot file.
      setError(err.message || 'The draft could not be saved, so the AI has nothing to write against yet.');
      return null;
    }
    if (id == null) return null; // nothing savable yet (no incident type)
    adoptSavedId(id);
    dirtyRef.current = false;
    notify('Draft saved — the report number is assigned.');
    onMutated?.();
    return id;
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
      // THREE LINES, NOT ONE RUN-ON SENTENCE. A comma-separated list of
      // six error sentences is unreadable at a glance; a title that states
      // the count, a one-line instruction, then each problem as its own
      // chip makes every problem a visible, separately clickable target.
      const problemCount = Object.keys(all).length;
      setError(
        <span className="error-summary-block">
          <span className="error-summary-title">
            The report has {problemCount} problem{problemCount === 1 ? '' : 's'}
          </span>
          <span className="error-summary-hint">
            Select a problem below to jump straight to the field that needs it:
          </span>
          <span className="error-summary-links">
            {Object.entries(all).map(([k, msg]) => (
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
            ))}
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
    // non-English narrative: translating a Bisaya/Tagalog narrative into formal
    // English is exactly what this stage adds, and Apply sets the
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
  // has no review step, so there the panel sits at the FOOT of the report,
  // under Investigator-on-Case (see the AI assistance card below).
  //
  // One instance on screen at a time, deliberately: the panel owns the
  // generated draft, so two live copies would offer the same draft twice and
  // would write over each other's per-tab session slot. A draft generated
  // earlier in the tab survives a step change by design — the panel restores it
  // from the per-tab session store keyed by report id — and so does its own
  // visibility, which is settled by the health probe on mount.
  // The language of the record (Phase 6 Stage 1), read through normaliseLanguage
  // so a stored value this build does not know — an older row, a draft restored
  // from sessionStorage — shows as English rather than as a language nobody can
  // name. Nothing here declares it: setNarrative writes the detector's verdict
  // into the draft, and every reader below (the AI guard's reason, the finalize
  // warning, the printed line) reads it from there — so the record and the
  // decisions made about it cannot disagree.
  const languageCode = normaliseLanguage(draft?.narrative_language);

  // Track B — the officer's dictionary, NOT MOUNTED ON THIS SCREEN TODAY.
  //
  // The glossary is Stage 2/3 functionality that has not been built out: with no
  // approved terms published, the panel's only contribution to the Write Report
  // screen is the "Report terminology — Approved report terminology — not a
  // translator … / No approved report terminology has been published yet"
  // disclaimer, which is confusing on a form that is otherwise ready to file.
  //
  // It comes back in two moves, when the station's records/legal officer has
  // approved the first terms: re-add the NarrativeTermsPanel import at the top
  // of this file, and render `termsPanel` where the comment under the narrative
  // sits (see the Track B comment in Panel III). Nothing else changed — the
  // component, its CSS namespace (term-panel-*) and its offline data file are all
  // still in the tree.
  //
  // What it looked like when mounted: kept beside the writing (the narrative
  // card) rather than inside the AI panel, because it is useful whether or not
  // the model is available. Never in the sheet format — everything inside
  // `.ir-form--sheet` IS the page, so the dictionary would have been printed.
  // The dictionary is a Document/Steps affordance.

  const aiPanel = canEdit ? (
    <AiNarrativePanel
      reportId={draft?.id ?? null}
      // The panel renders on a report that has never been saved too, so the id
      // its requests are filed against is resolved when they are made: this is
      // what saves the draft and hands the new id back (see ensureAiReportId).
      ensureReportId={ensureAiReportId}
      canEdit={canEdit}
      // Regenerate from the inline sheet: the panel watches this nonce and
      // re-runs its last press (see regenerateNarrative).
      regenSignal={regenNonce}
      narrative={draft?.narrative || ''}
      // The AI closes the narrative with the recorded disposition,
      // so the panel shows which text it is working from.
      actionTaken={draft?.action_taken || ''}
      // The officer's own observations: the AI weaves them into the
      // narrative AND formalises them into the sheet's NOTABLE
      // FINDINGS block.
      notableFindings={draft?.type_specific?.notable_findings || ''}
      // Completeness gate: flag "The report has N problems" and jump to the
      // missing fields BEFORE any AI request is sent (@see gateAiGenerate).
      //
      // NOT in the sheet format, and that is a decision rather than an omission:
      // the sheet's blank page IS the source. The officer types the whole
      // incident there, the account read fills the fields it names, and the
      // officer should not be stopped short of the AI by the form's own blanks —
      // the missing-field banner belongs to SUBMIT, where a report genuinely
      // cannot go on without a type, a date and a place. In the stepped and
      // document formats the gate stays exactly as it was.
      onBeforeGenerate={sheet ? undefined : gateAiGenerate}
      // Phase 7 — the account read, handed over in the SHEET format only: on the
      // blank page Generate fills the report's own fields out of the account
      // before it saves or drafts anything (see readAccountForForm).
      onReadAccount={sheet ? readAccountForForm : undefined}
      // The way OUT of a refusal that names the report's own fields: the sheet
      // keeps them behind its reveal control, and jumpTo opens that state and
      // lands on the field — so the panel's message can hand the officer the
      // control that fixes what it complains about instead of naming fields
      // that are off screen.
      onRevealFields={sheet ? () => jumpTo('incident_type') : undefined}
      // D3 — the panel disables Generate and Tighten and states the reason,
      // rather than offering a control whose only possible answer is no.
      languageBlocked={aiBlockedReason(languageCode)}
      // Phase 6 Stage 2 — opens the terminology lookup on the language the
      // officer is writing in. A default only; it never edits the narrative.
      narrativeLanguage={languageCode}
      // Human-in-the-loop: the officer explicitly copies the AI draft in — the
      // WHOLE draft (the facts, the notable findings and the action taken),
      // because generating one writes nothing and this is the only action that
      // does. It stays fully editable afterwards. The source tag lands in
      // report_history via the next save/finalize.
      onAccept={applyAiDraft}
      // TASK 9 — the bondpaper, for the panel to type the draft into IN ITS OWN
      // CARD. This hands over exactly what the sheet needs to draw the letter
      // for the report on screen and nothing more; the panel owns the preview
      // from there (it types the words, reports when they land, and holds its
      // gate shut until they have), so a draft arrives where the officer pressed
      // Generate, in EVERY format — including the stepped one, whose narrative
      // panel is hidden at the step the AI panel lives on. Purely presentational
      // input: the sheet computes the page's own facts (src/lib/sheetFacts.js)
      // and writes nothing.
      sheet={{
        report: { ...(draft || {}), id: draft?.id ?? editingId },
        ts: inlineTs,
        stationHeader,
        recordedBy: { name: user?.full_name || user?.name || draft?.created_by_name },
      }}
      // Phase 6 Stage 5 (Track C) — step 1 of the guided "Translate & tighten"
      // flow: apply AND save the reviewed draft, so step 2 can run against a
      // record the server already knows is English.
      onApplyGuided={applyGuidedTranslation}
      // TIGHTEN'S PROPOSALS for the officer's own two fields — the only callers
      // left now that generating a draft writes nothing. Each is reached by its
      // own button, and the button is offered only when it actually proposes a
      // change; the field helpers hold the rest of the rules (empty proposes
      // nothing, identical text is not a rewrite, and the first snapshot is the
      // one Undo reaches).
      onApplyFindings={(lines) => applyFindingsText(
        Array.isArray(lines) ? lines.join('\n') : String(lines ?? ''),
      )}
      onApplyActionTaken={(text) => applyActionTakenText(text)}
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
    setNarrative,
    setActionTaken,
    setIncidentTypeTyped,
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
        {/* Labelled pairs rather than "CASE NO: …" run-on strings: the key
            says what the value IS, the value carries the weight, and both
            line up on the right edge of the masthead as a block. */}
        <div className="ir-meta">
          <div className="ir-meta-row">
            <span className="ir-meta-key">Case no.</span>
            <span className="ir-meta-val">{caseNumber(draft)}</span>
          </div>
          <div className="ir-meta-row">
            <span className="ir-meta-key">Date</span>
            <span className="ir-meta-val">
              {specDate(reportDateValue(draft, new Date().toISOString().slice(0, 10)))}
            </span>
          </div>
        </div>
      </div>

      <div className="ir-status ir-status--flag">
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

      {/* The asterisk key. Not shown on the blank sheet: it explains a marker
          that is not on screen, since every field carrying one is behind the
          sheet's control. */}
      {!sheetBlank && (
        <p className="ir-required-note">
          <span className="req">*</span> Required before the report can be submitted.
        </p>
      )}

      {/* The sheet's chrome — the AI panel and the officer's dictionary — is on
          the desk BELOW the paper: see the block after </form>. Nothing sits
          between an officer and the page they came here to write. */}
      <form
        onSubmit={(e) => e.preventDefault()}
        className={`ir-form${stepped ? ' ir-form--stepped' : ''}${sheet ? ' ir-form--sheet' : ''}${
          sheetBlank ? ' ir-form--blank' : ''
        }`}
      >
        {/* The screen's opening panels: Panels I and II side by side on
            desktop, and the narrative (Panel III) SPANNING the row beneath them
            so the longest field on the form gets the full measure. The
            signature block that used to be the grid's fourth cell is gone — the
            station asked for it off the form, and the officer initials it
            collected went with it, which is what left a half-column empty.
            The application's remaining document sections follow the grid as
            full-width cards, so nothing the blotter needs was dropped to match
            the layout. */}
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
                <IrLabel htmlFor="r-reporter-name" icon="person" required>Full Name</IrLabel>
                <input
                  id="r-reporter-name"
                  autoComplete="name"
                  placeholder="Last Name, First Name, M.I."
                  value={draft.reporter_name || ''}
                  onChange={(e) => set('reporter_name', e.target.value)}
                  disabled={!canEdit}
                  aria-required="true"
                  aria-invalid={!!errors.reporter_name}
                />
                {errors.reporter_name && <div className="error">{errors.reporter_name}</div>}
              </div>
              <div className="ir-field">
                <IrLabel htmlFor="r-reporter-contact" icon="phone" required>Contact Number</IrLabel>
                <input
                  id="r-reporter-contact"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(000) 000-0000"
                  value={draft.reporter_contact || ''}
                  onChange={(e) => set('reporter_contact', e.target.value)}
                  disabled={!canEdit}
                  aria-required="true"
                  aria-invalid={!!errors.reporter_contact}
                />
                {errors.reporter_contact && <div className="error">{errors.reporter_contact}</div>}
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
                {/* TYPABLE, not a menu to hunt through: the station's types are
                    what the card under it offers and anything else is typed into
                    this same box. Text that is not a type on the list is recorded
                    as an Other Incident whose Category is what was typed — the
                    same place that type already keeps its specification — so no
                    second field is revealed. See resolveIncidentTypeInput. */}
                <Dropdown
                  id="r-type"
                  typeable
                  options={typeOptions}
                  placeholder="Type or choose an incident type…"
                  value={incidentTypeBoxValue(draft)}
                  onChange={setIncidentTypeTyped}
                  disabled={!canEdit}
                  invalid={!!errors.incident_type}
                  optionIcon={<LabelIcon name="hash" />}
                />
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
            wide
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
            <div className="ir-field ir-narrative" hidden={narrativeView === 'sheet'}>
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
              {/* Track B — the terminology glossary is NOT rendered here today
                  (see the comment where `termsPanel` used to be built): the
                  approved-terms table ships empty, so all it could say is the
                  "no approved report terminology published yet" disclaimer. It
                  mounts back under this line when the glossary has entries. */}
            </div>
            {/* Task 4 — the accepted draft's bondpaper, inline. Purely
                presentational and shared with the print sheet (ReportSheetBody);
                the raw fields above stay MOUNTED and hidden, so every error jump
                (r-narr included) still resolves. */}
            {narrativeView === 'sheet' && (
              <div className="ir-sheet-reveal">
                {/* TASK 9 — this strip belongs to the COMMITTED page, and that
                    is all this reveal ever is: the draft was typed into the AI
                    panel's own bondpaper (where Generate was pressed) and
                    Accept is what puts the recorded page here. So Edit (the way
                    back to the raw fields) and Regenerate are always offered —
                    there is no uncommitted moment left to hide them for. */}
                <div className="ir-sheet-reveal-bar">
                  <span className="ir-sheet-reveal-label">
                    Bondpaper preview — this is what will print
                  </span>
                  <div className="ir-sheet-reveal-actions">
                    <button type="button" onClick={editNarrativeFields}>
                      Edit
                    </button>
                    <button type="button" className="primary" onClick={regenerateNarrative}>
                      Regenerate
                    </button>
                  </div>
                </div>
                <div className="ir-sheet-reveal-paper">
                  {/* `.print-sheet` carries the paper's own colours, font and
                      page width, and the h1/h2/h3 override that keeps the
                      title dark — the same stylesheet the print portal uses,
                      so the reveal is the printed page, not a lookalike. */}
                  <div className="print-sheet">
                    <ReportSheetBody
                      report={{ ...draft, id: draft.id ?? editingId }}
                      ts={inlineTs}
                      stationHeader={stationHeader}
                      recordedBy={{ name: user?.full_name || user?.name || draft.created_by_name }}
                    />
                  </div>
                </div>
              </div>
            )}
            {/* Where the AI panel lives is settled PER FORMAT — one home each,
                never two, because the panel owns the slide-in side panel and the
                body class that reserves its space, so two live copies would
                fight over both.

                  stepped   — on the REVIEW step (the AI assistance card at the
                              end). The hint below says where it went, so the
                              control's absence reads as a move rather than as
                              the feature being gone.
                  document  — in its own card at the FOOT of the report, under
                              Investigator-on-Case (see the AI assistance card
                              near the submit cluster). It used to sit here,
                              under the narrative field, which put a Generate
                              row in the middle of the document — above the
                              Parties, the Action Taken and the IOC the draft is
                              written FROM. The officer fills the report top to
                              bottom, so the assistant now waits where that
                              filling is done.
                  sheet     — on the desk BELOW the paper (see the desk block
                              after the form). This card IS the sheet's page,
                              so a Generate row inside it would be printed on
                              the page; the panel is a control, and controls sit
                              on the desk, which in this format is under the
                              sheet: the page comes first, and the assistant
                              waits at the foot of it with the rest of the
                              chrome. */}
            {stepped && (
              <p className="section-hint">
                Writing assistance — Generate AI draft, or Tighten this narrative — is on the
                last step, Review, where the report reads back in one piece. The stepper above
                jumps straight there.
              </p>
            )}
          </IrCard>

          {/* The Signatures panel used to close this grid: the reporting
              party's name over a signature rule, its submit timestamp, and the
              officer's initials. The station asked for it off the form — a
              typed name is not a signature, and the initials next to the badge
              number are already on the sheet from the account that filed the
              report (see ReportPrint, which draws its own "Recorded by" block).
              Nothing is lost from the record: the server still dates the party's
              signature at submit time, it is simply no longer asked for here. */}
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
                Optional. Enter additional observations or findings that are not
                already captured in the fields above. Leave blank if there are
                none. Printed in the NOTABLE FINDINGS block of the sheet, one
                line per typed line.
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

        {/* Section 5 pairs the section's ONE long field with its ONE short
            field: the two cards below share a row so the section reads as a
            pair rather than as two stacked full-width bands, which is also one
            fewer scroll to reach the Submit bar. Both keep their own header
            bar, their own hint and their own step index, so the dot's jump
            still flashes them together and the current-step highlight still
            covers the whole section instead of one card of it.

            Neither card carries `wide`: inside `.ir-card-row` that modifier
            would span the row and put them back one above the other. */}
        <div className="ir-card-row">
          {/* Action Taken / Status is a required document block: the narrative
              generator receives it as context, and the report cannot be
              submitted without it. It follows the four spec panels and sits
              directly above the submit bar. */}
          <IrCard
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
          <IrCard
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
        </div>

        {/* AI assistance — where the document format keeps the writing
            assistant (see `aiPanel` above), and why it is HERE rather than
            under the narrative field it works on.

            Under the Investigator-on-Case, at the foot of the report, because
            that is the order the officer works in: the form is filled top to
            bottom, and the draft is written from what is in it — the parties,
            the Action Taken, the IOC and the narrative among them. Mid-document
            the Generate row interrupted that filling (and the account read it
            can start would fill fields BELOW the control that was pressed).
            From here the officer reaches the last field, then the assistant,
            then Submit: one pass down the page, nothing to scroll back for.

            The sheet format keeps its own home for the panel (on the desk under
            the paper) and the stepped format its own (on the Review step), so
            this card is the document format's and the document format's only —
            one live copy on screen at a time, which is what the panel's own
            side panel and body class require. */}
        {!stepped && !sheet && canEdit && (
          <IrCard wide accent title="AI assistance">
            {aiPanel}
          </IrCard>
        )}

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
          <IrCard wide accent title="AI assistance">
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

      {/* ---- The desk BELOW the paper ----------------------------------------
          Everything the sheet's page needs that is not the page, in the order an
          officer reaches for it: open the report's fields, call on the writing
          assistant, then save or submit.

          All of them are CONTROLS, not paper — everything inside
          `.ir-form--sheet` IS the page, so none of them may be printed on it —
          and all of them therefore sit OUTSIDE the form.

          BELOW the paper, not above it. Above, the reveal control, the AI panel
          and the dictionary all came first: on the blank page — the state the
          format opens in — the page the officer came here to write on was the
          fourth thing down the screen. The page comes first and its controls
          follow it.

          The dictionary used to be one of these controls and is not any more:
          everything inside the sheet is the page, so it cannot sit beside the
          narrative there, and this desk was its only home in this format. The
          dictionary is a Document/Steps affordance now (and is off the screen
          entirely until the glossary has terms — see the Track B comment above
          `aiPanel`).

          The one thing deliberately not on this desk is the narrative-language
          selector: the language is read from the narrative (see setNarrative)
          instead of declared by hand. The record still carries one, and the AI
          guard, the finalize warning and the printed line all still read it —
          there is simply nothing left to choose.

          One home each, in BOTH of the sheet's states, so revealing the report's
          fields never makes any of them move under the officer's hands. */}

      {/* The sheet format's ONE control, and the only thing it adds to the
          screen. It sits OUTSIDE the sheet deliberately: the format's promise is
          a page with nothing on it, so the control that reveals the rest of the
          report cannot itself be printed on the page it is describing.

          What it reveals is the whole report — every panel and every group. The
          action row is NOT behind it: Save Draft and Submit are rendered below
          the paper in both of the sheet's states (see below), so filing the
          report never depends on these fields being open. Submitting is a
          deliberate act on the whole document, and the page you submit is the
          one this control opens. */}
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
        </div>
      )}

      {sheet && canEdit && <div className="ir-sheet-ai">{aiPanel}</div>}

      {/* ...and the action row, under it. Filing is never behind anything in this
          format: Save Draft and Submit are rendered, on screen, under the paper
          they commit — which is the guarantee the reveal control used to have to
          make. */}
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
              {/* The confirm's own tone wins where it has one: a destructive
                  default is right for archiving and wrong for EDITING a draft,
                  which is an ordinary action wearing a red button. */}
              <button
                className={confirm.tone ?? (confirm.confirmLabel === 'Finalize Report' ? 'primary' : 'danger')}
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

// The register's STATUS sort cycle used to live here as a sortable table
// heading (STATUS_SORTS / statusSort / cycleStatusSort). The grid has no heading
// row, so it went with the table — and every one of its three states is still
// reachable from the filter bar's own sort dropdown ("Newest/Oldest incident"
// and "Status A→Z / Z→A"), which drives the SAME `query` state the heading used
// to. No sort capability was lost, only the duplicate affordance a table header
// hid it behind.

export function ReportsTable({
  user,
  notify,
  onMutated,
  onConnError,
  initialStatus,
  // The day, and the incident type, the register was asked to open on — set by the
  // dashboard chart's right-click menu. They are the SAME keys the query below
  // already carries, seeded on mount rather than filtered by a new mechanism, so
  // the two controls in the filter bar show them and the officer can clear them
  // like any other filter. Only the mount value is read: after that the bar owns
  // them (Shell keys the component on these, which is what makes a second visit
  // with another day a second mount).
  initialDateFrom = '',
  initialDateTo = '',
  initialType = '',
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
  // The officer's own recent reports. Shell already fetches this list for Home,
  // which is why the prop is still wired here: it used to feed D7's suggestion
  // (the most recent report's language, pre-selected on a new one), and D7 went
  // with the selector when the language became detected. Nothing reads it now.
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
  const [query, setQuery] = useState({
    q: '',
    type: initialType || '',
    status: initialStatus ?? '',
    date_from: initialDateFrom || '',
    date_to: initialDateTo || '',
    sort: 'incident_datetime',
    dir: 'desc',
    page: 1,
    verification: '',
  });
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState('');
  const [flashId, setFlashId] = useState(null);
  // ---- The folder shelf ----------------------------------------------------
  // The per-type tally behind the folders. `null` until the first answer, so
  // "nothing found" and "not asked yet" cannot be drawn the same way.
  const [folders, setFolders] = useState(null);
  // Which folder is open, or null for the shelf of folders:
  //   { shelf, label, type }  — shelf is the bucket the contents are scoped to
  //   ('draft' / 'submitted'), or null in a mode that draws a single shelf (the
  //   archive, the translation queue), where the type alone is the scope.
  //
  // Deliberately NOT part of `query`: opening a folder must not make the filter
  // bar claim the officer chose a type they only opened. The request the
  // contents list makes is composed from the two (see listParams/folderParams).
  const [openFolder, setOpenFolder] = useState(null);
  // One id prefix for the per-type section headings. `useId` rather than a slug
  // of the type name: two types can differ only in punctuation, and a slug
  // could collide with an element elsewhere on the page. The suffix is the
  // group's index, so the id is stable for the life of the render.
  const groupId = useId();

  const canFinalize = user.role === 'Admin' || user.role === 'Officer';

  // ---- What the register is showing ----------------------------------------
  // The list's own name, for the breadcrumb: the page head shouts it, the trail
  // states it.
  const listTitle = user.role === 'Admin' ? 'All Reports' : 'My Reports';
  // The translation queue is a MODE of this same list, and the register draws it
  // as ONE shelf rather than Draft/Submitted — an archived report was archived
  // whatever it was, and a report awaiting a translation review is waiting on a
  // language, not on a stage (see shelvesFor).
  const awaiting = query.verification === 'awaiting';
  // The shelves, with their folders, folded here from the server's raw status
  // tally — the ONE place that tally enters the UI.
  const shelves = useMemo(
    () =>
      buildShelves(folders, {
        shelves: shelvesFor({ archived: showArchived, awaiting }),
        typeOrder: typeOptions,
      }),
    [folders, showArchived, awaiting, typeOptions],
  );
  // Which list request this is. Typing fires a request every few hundred
  // milliseconds now (see the debounce effect below), so two can be in flight at
  // once and the NETWORK decides which lands first — a slow "rob" arriving after
  // a fast "robbery" would repaint the register with results for a search the box
  // no longer holds. Only the newest request may write its answer; an older one is
  // dropped, answer and error alike.
  const loadSeq = useRef(0);

  // The list's own query string, with ONE spelling for every caller: the
  // contents list, the folder tally and the CSV export. All three have to agree
  // about what is being looked at — a folder whose face counted a set the list
  // inside it did not show would be a register lying to itself, and an export
  // that ignored the open folder would put the whole blotter in a CSV the
  // officer asked for one shelf of. `extra` carries the folder itself (bucket +
  // type) and OVERWRITES anything the filter bar set, which is what makes an
  // opened folder authoritative over the list it opens onto.
  function listParams(extra = {}) {
    const params = new URLSearchParams();
    if (showArchived) {
      params.set('archived', '1');
    } else {
      for (const [k, v] of Object.entries(query)) {
        if (v !== '' && !(k === 'page' && v === 1)) params.set(k, String(v));
      }
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined || v === '') continue;
      params.set(k, String(v));
    }
    return params;
  }

  // The open folder as list filters: the shelf IS the bucket, the folder IS the
  // type. Empty when no folder is open, so the register's ordinary list is the
  // plain filtered set. A single-shelf mode (the archive, the translation queue)
  // has no bucket to state — the type alone is its scope.
  const folderParams = openFolder ? { bucket: openFolder.shelf, type: openFolder.type } : {};

  async function load() {
    const seq = ++loadSeq.current;
    try {
      const qs = listParams(folderParams).toString();
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

  // The FOLDER SHELF. Its own request rather than a count of the rows the list
  // returned: the list is paged, so counting its rows answers for one page and
  // not for the register. Shares `loadSeq` with load() — the two are mutually
  // exclusive (one or the other view is showing), so a slow answer for the view
  // the officer has left can never repaint the one they are on.
  async function loadFolders() {
    const seq = ++loadSeq.current;
    try {
      const qs = listParams().toString();
      const data = await api(`/reports/folders${qs ? `?${qs}` : ''}`);
      if (seq !== loadSeq.current) return;
      setFolders(Array.isArray(data.folders) ? data.folders : []);
      setConn(null);
      setError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (isUnreachable(err)) {
        setConn(classifyError(err));
        setFolders((cur) => cur ?? []);
        onConnError?.(err);
      } else {
        setError(err.message);
      }
    }
  }

  /** Re-read whatever the register is showing — the shelf, or the open folder. */
  function refresh() {
    return openFolder ? load() : loadFolders();
  }

  useEffect(() => {
    if (openFolder) load();
    else loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, query, openFolder]);

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
    // An EDIT confirm is not a mutation: it opens the report in the writer, so
    // there is nothing to announce and nothing to re-read — the writer loads the
    // record itself.
    if (c.kind === 'edit') {
      c.action();
      return;
    }
    try {
      await c.action();
      notify(c.doneMessage);
      await refresh();
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
   * Everything a register ROW needs to know about itself, in one call.
   *
   * The list is a presentation shell (see ReportList), so this is where the
   * rules stay: which reports open, which are locked, what the ⋮ menu holds, and
   * whether the row offers Edit. Computing it per row rather than passing five
   * booleans keeps the rules readable and in one place — the shape the old card
   * grid used for the same reason.
   */
  function rowMeta(r) {
    return {
      dateText: fmtIncident(r.incident_datetime),
      locked: rowLocked(r),
      archived: showArchived,
      // The click OPENS a report, so it is the list's own `rowCanOpen` — false in
      // the archive (a report was never opened from there) and false for a
      // finalized report a non-admin may not edit.
      canOpen: rowCanOpen(r),
      // ...while restoring is the archive's separate, admin-only action, which
      // is why the ⋮ menu and the "Restore archived" wording answer to it
      // rather than to `canOpen`.
      canRestore: showArchived && user.role === 'Admin',
      hasMenu: showArchived ? user.role === 'Admin' : true,
      // Edit is the DRAFT's own action: a submitted report has already gone to
      // the station, and an archived draft is restore-only.
      canEdit: !showArchived && statusBucket(r.status) === 'draft' && rowCanOpen(r),
    };
  }

  /**
   * Edit a draft — ASK FIRST.
   *
   * Opening the writer is a deliberate act with a confirmation in front of it,
   * so an officer cannot land in the middle of a half-written report by
   * brushing a row. Confirming then opens exactly the same editor the row's own
   * click does (`setOpenId`), pre-loaded with the report — the officer edits it
   * in place rather than starting a new one.
   */
  function askEdit(r) {
    setConfirm({
      title: `Edit draft report ${reportNumber(r.id)}?`,
      message:
        'This draft will open in Write Report with everything already recorded in it. Nothing changes until you save it there.',
      confirmLabel: 'Edit Draft',
      // Confirming an edit is not a destructive act; it opens the writer.
      tone: 'primary',
      kind: 'edit',
      action: () => setOpenId(r.id),
    });
  }

  // ---- Opening and closing a folder ----------------------------------------
  // Both reset to page one: the page the officer was on belonged to the list
  // they were looking at, not to the one they are looking at now.
  function openFolderAt(shelf, type) {
    setOpenFolder({ shelf: shelf.all ? null : shelf.key, label: shelf.label, type });
    // Clear the list the LAST view was showing: keeping it would put the
    // folder's name over another folder's reports for as long as the request
    // takes, which reads as a folder that lies about its contents.
    setReports(null);
    setPagination(null);
    setQuery((q) => (q.page === 1 ? q : { ...q, page: 1 }));
  }

  function closeFolder() {
    setOpenFolder(null);
    setReports(null);
    setPagination(null);
    setQuery((q) => (q.page === 1 ? q : { ...q, page: 1 }));
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
        actions={
          <>
            {user.role === 'Admin' && (
              <button type="button" onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? 'Show Active' : 'Show Archived'}
              </button>
            )}
            {/* Export honors the CURRENT filters AND the open folder (the server
                reuses the same query pipeline) — what you see is what you get,
                down to the shelf. */}
            <a
              className="button-link"
              href={`/api/v1/reports/export${
                listParams(folderParams).toString()
                  ? `?${listParams(folderParams).toString()}`
                  : ''
              }`}
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
                onChange={(e) => {
                  // A folder IS an incident type, so choosing one here leaves the
                  // folder you were in: the register must not keep showing one
                  // folder's reports under another type's filter. (While a folder
                  // is open the bar shows "All types", because the officer did
                  // not CHOOSE a type — they opened a folder.)
                  setOpenFolder(null);
                  setQuery((q) => ({ ...q, type: e.target.value, page: 1 }));
                }}
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
                    // Clearing the filters puts the officer back on the shelf:
                    // a folder is a view OF a filtered set, and there is no
                    // filtered set left to be inside.
                    setOpenFolder(null);
                    setQuery((q) => ({ q: '', type: '', status: '', date_from: '', date_to: '', sort: q.sort, dir: q.dir, page: 1, verification: '' }));
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
        </div>
      </IrCard>

      <IrCard wide flush headless>
        {openFolder ? (
          <>
            {/* ---- One folder, OPEN: the reports inside it --------------- */}
            {/* Where you are, and the way back. A breadcrumb rather than only a
                back button, because the register has two levels of scoping now
                (the shelf and the type) and the officer should be able to read
                which two they are under without counting clicks. */}
            <nav className="report-trail" aria-label="Folder">
              <button type="button" className="report-trail__back" onClick={closeFolder}>
                <span aria-hidden="true">←</span> All folders
              </button>
              <ol className="report-trail__crumbs">
                {folderTrail(listTitle, openFolder.label, openFolder.type).map(
                  (crumb, i, all) => {
                    const last = i === all.length - 1;
                    return (
                      <li
                        key={crumb}
                        className="report-trail__crumb"
                        aria-current={last ? 'page' : undefined}
                      >
                        {last && (
                          <span className="report-trail__icon" aria-hidden="true">
                            <ReportTypeIcon name={typeIcon(openFolder.type)} />
                          </span>
                        )}
                        {crumb}
                      </li>
                    );
                  },
                )}
              </ol>
            </nav>

            {reports === null ? (
              <p className="ir-card-empty">
                {conn ? 'Waiting for the connection to come back…' : 'Loading reports…'}
              </p>
            ) : reports.length === 0 ? (
              <p className="ir-card-empty">
                {conn
                  ? 'Waiting for the connection to come back…'
                  : 'No reports in this folder.'}
              </p>
            ) : (
              <ReportList
                reports={reports}
                rowMeta={rowMeta}
                flashId={flashId}
                onOpen={setOpenId}
                onEdit={askEdit}
                onMenu={openRowMenu}
              />
            )}

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
        ) : (
          <>
            {/* ---- The SHELF of folders ----------------------------------
                One glass folder per incident type per shelf, and only the types
                the shelf actually holds — an empty folder is a promise it
                cannot keep. The counts come from the server's own tally, folded
                through the SAME filter pipeline the list uses, so a folder's
                face and the list inside it cannot disagree. */}
            {folders === null ? (
              <p className="ir-card-empty">
                {conn ? 'Waiting for the connection to come back…' : 'Loading reports…'}
              </p>
            ) : (
              <div className="folder-shelves">
                {shelves.map((shelf, i) => (
                  <section
                    className="folder-shelf"
                    key={shelf.key}
                    aria-labelledby={`${groupId}-${i}`}
                  >
                    {/* A real heading, so the shelf can be reached by landmark
                        the way the eye reaches it by colour. */}
                    <h3 className="folder-shelf__head" id={`${groupId}-${i}`}>
                      <span className="folder-shelf__name">{shelf.label}</span>
                      <span className="folder-shelf__count">
                        {shelf.total} {shelf.total === 1 ? 'report' : 'reports'}
                      </span>
                    </h3>
                    {shelf.folders.length === 0 ? (
                      <p className="folder-shelf__empty">
                        {emptyShelfNote(shelf, { archived: showArchived, awaiting })}
                      </p>
                    ) : (
                      <div className="folder-shelf__row">
                        {shelf.folders.map((folder) => (
                          <GlassFolder
                            key={folder.type}
                            type={folder.type}
                            count={folder.count}
                            onOpen={(type) => openFolderAt(shelf, type)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ))}
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
              {/* The confirm's own tone wins where it has one: a destructive
                  default is right for archiving and wrong for EDITING a draft,
                  which is an ordinary action wearing a red button. */}
              <button
                className={confirm.tone ?? (confirm.confirmLabel === 'Finalize Report' ? 'primary' : 'danger')}
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
