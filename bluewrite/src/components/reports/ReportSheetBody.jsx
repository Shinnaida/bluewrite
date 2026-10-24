// BlueWrite — the bondpaper sheet, as ONE component.
//
// This is the inner content of the printed POLICE REPORT (header band through
// the translation appendix). It is shared by:
//
//   1. ReportPrint.jsx — the print portal (unchanged output),
//   2. Reports.jsx — the inline "reveal the bondpaper" view (Task 4), and
//   3. Reports.jsx's inline reveal of an UNCOMMITTED AI draft (Task 9).
//
// One implementation is the point: the editor's inline sheet must look and case
// EXACTLY like the real print sheet, so forking the markup would guarantee the
// two drift. The component is presentational by default — it computes the
// sheet's facts from `report` + `ts` via src/lib/sheetFacts.js and renders;
// it holds no state of its own beyond the typewriter cursor and writes nothing
// unless the host passes `editable` with the onEdit* callbacks, in which case
// the narrative, findings and recorded action lines are inline formatted
// editors — the narrative, findings and action stay strip-free (the blotter
// Upload lives on the form's own strip — see BlotterCapture) and register
// their carets with the sheet's one floating box — and the
// free-text facts are wrapping Word-like fields (owner request — type
// directly on the letter, like in Word).
//
// TASK 9 — THE AI'S WORDS TYPE THEMSELVES INTO THE FINISHED LETTER.
// The sheet's static chrome (the institutional header, the date row, the
// "P O L I C E R E P O R T" title, the salutation, the certification line's
// boilerplate, and every bold field LABEL) is template, not AI output, so it is
// rendered in its final formal position and casing IMMEDIATELY — it is never
// hidden. Only the AI-filled VALUES type themselves into their real slots, top
// to bottom: the labeled fact values, then FACTS OF THE CASE, then NOTABLE
// FINDINGS, then ACTION TAKEN / STATUS. Each value carries Task 2's casing as it
// types, so what appears mid-type is already the final formal-cased text.
//
// The pending proposal arrives as `pending`; when it is absent the sheet is the
// ordinary committed sheet (the print portal's case) and every value renders
// whole. `prefers-reduced-motion` shows the finished sheet immediately, and a
// click on the sheet does the same (a manual Skip).

import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { resolveHeader } from '../../lib/stationSettings.js';
import { languageLabel } from '../../lib/reportLanguages.js';
import {
  hasSource,
  APPENDIX_HEADING,
  appendixIntro,
  appendixSourceLabel,
  appendixReviewLine,
  appendixCloseLine,
} from '../../lib/reportVerification.js';
import {
  buildTypeFacts,
  buildStructuredFindings,
  buildStructuredActions,
  fmtIncidentLong,
  fmtLong,
  properNounsFor,
} from '../../lib/sheetFacts.js';
import { buildActionBlock } from '../../lib/printActions.js';
// Task 2 — the letter's casing layer. `labelCase` spells every bold label in
// Title Case; `toSentenceCase` corrects values and prose (sentence starts plus
// the report's OWN proper nouns) without ever flattening an existing capital or
// changing a word — so the narrative's wording stays exactly as accepted.
import { toUpperCase, toSentenceCase, labelCase, properNounMap } from '../../lib/printCasing.js';
import { stripLeadingBlotterRestatement } from '../../lib/narrativeText.js';
import { sanitizeRichHtml, containsRichTags, richTextToPlain, sanitizeLetterHtml } from '../../lib/richText.js';
import RichTextArea from './RichTextArea.jsx';
import WordField from './WordField.jsx';
import SheetText, { sheetTextOf } from './SheetText.jsx';
import { parseSheetDate, parseSheetDateTime } from '../../lib/sheetDateParse.js';
import pnpLogo from '../../assets/pnp-logo.png';
import citySeal from '../../assets/city-of-naga-seal.png';

// The reviewing official who signs the "Noted by:" line of every printed
// station report. Fixed by the station (not per-report data), so it prints on
// drafts and finalized reports alike.
const NOTED_BY_NAME = 'DEXTER MALEZA CALACAR';

const N = (v) => String(v ?? '').trim();
const has = (v) => N(v) !== '';

// Task 9's typewriter pace. The WHOLE sheet is one sequence (not one block per
// component), so the reveal is a single character cursor walked across every
// typed slot in document order. The cursor advances a few characters per tick
// so a full page lands in a few seconds rather than a few minutes, while staying
// visibly "typed" rather than strobing.
const TYPE_TICK_MS = 16;
const TYPE_TARGET_MS = 6000;

// Item amounts print bare ("- 284,370.00"), matching the scanned sheet.
function fmtItemValue(v) {
  return N(v).replace(/^[₱P]\s*/, '');
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * @param {object} props
 * @param {object} props.report   the report row (or the in-memory draft)
 * @param {object} props.ts       parsed + normalized type_specific
 * @param {object|null} props.stationHeader  station letterhead (may be null)
 * @param {Array}  [props.verifications]     translation review records
 * @param {string|null} [props.verificationStatus]
 * @param {object|null} [props.recordedBy]   { name } of the officer using the app
 * @param {object|null} [props.pending]      Task 9 — the UNCOMMITTED AI draft to
 *   type into the sheet: `{ narrative, findingsText?, statusText?, suspectLines?,
 *   scope }`, where scope is 'generate' (type the facts too) or 'tighten' (type
 *   only the narrative). `suspectLines` is `[{ row, line }]` — the model's own
 *   Suspect sentence per respondent row, drawn in the facts block in place of
 *   the record's composed line (preview only; the report's fields are never
 *   written from it). Absent → the ordinary, fully-rendered sheet.
 * @param {number} [props.revealKey]          replays the reveal when it changes
 * @param {boolean} [props.revealPending]     whether a pending proposal should
 *   TYPE itself in (default true). A host drawing a draft it has already shown
 *   the officer once — one restored from the tab's store after a reload — passes
 *   false, and the proposal is drawn whole rather than replaying the sequence.
 * @param {Function} [props.onRevealComplete] fires once the whole sequence lands
 * @param {Function} [props.onProgress] Task 10 — how much of the sequence has
 *   been typed, as a fraction (0..1), reported once per tick while it runs. A
 *   host with its own fixed-height, scrollable viewport (the AI panel's
 *   fit-to-screen document card) uses it to keep the typing in view, because the
 *   letter is taller than the card and the words below the fold would otherwise
 *   type themselves where nobody is looking. The print portal and the inline
 *   reveal pass nothing and behave exactly as before.
 * @param {boolean} [props.editable] owner request — type directly on the
 *   letter. When true (and the host only passes it once a generated draft has
 *   landed), the narrative, the notable findings and the recorded action lines
 *   render as inline formatted editors — the narrative with its own top
 *   strip (blotter Upload rides it), findings and action strip-free and
 *   served by the sheet's one floating toolbox — and free-text
 *   facts as wrapping Word-like fields — whose edits call the onEdit*
 *   callbacks below, one more ordinary write path into the draft, like the
 *   form fields. Absent → the sheet reads exactly as before; the print
 *   portal never passes it.
 * @param {Function} [props.onEditNarrative] called with the new narrative text
 * @param {Function} [props.onEditFindings] called with the new findings html
 *   (the allowlisted subset, as the record stores it); structured lines stay
 *   read-only and are never written back into the field
 * @param {Function} [props.onEditAction] called with the new recorded action
 *   html; the station's own tail (structured states, on-file and routing
 *   lines) stays read-only
 * @param {Function} [props.onEditFact] owner request — type on the FACTS too.
 *   Called as onEditFact(target, value) where target is { field } for a
 *   report scalar (location, incident_datetime), { tsField } for a
 *   type_specific scalar (date_of_discovery), or { group, index, key } for a
 *   group row cell (complainant/respondent/stolen_items). Only read when
 *   `editable` is true; computed and derived lines stay read-only.
 * @param {Function} [props.onEditChrome] owner request — type on the CHROME
 *   too. Called as onEditChrome(tsKey, value) where tsKey is the flat
 *   `sheet_*` type_specific key holding the per-report override; clearing a
 *   line drops its override and the template default reads again. Only read
 *   when `editable` is true. Row add/remove lives in the revealed form
 *   fields, never on the paper — the sheet is a typing surface, not a grid.
 * @param {string|null} [props.letterHtml] owner request — the letter's own
 *   text (free edit). When non-empty, the body below the letterhead renders
 *   this html as-is instead of composing from the report's fields — the
 *   letter keeps its own text. The station header, the signature block and
 *   the translation appendix always stay composed: a freed letter can never
 *   lose its seals or its signatories.
 * @param {Function} [props.onEditLetterHtml] owner request — free edit.
 *   Called with the canvas html on every keystroke. Only read when
 *   `editable` is true and no AI draft is under review (`pending` null);
 *   while a draft is being reviewed the letter keeps its per-field editors
 *   and this is ignored.
 */
export default function ReportSheetBody({
  report,
  ts,
  stationHeader = null,
  verifications = [],
  verificationStatus = null,
  recordedBy = null,
  pending = null,
  revealKey = 0,
  revealPending = true,
  onRevealComplete,
  onProgress,
  editable = false,
  onEditNarrative = null,
  onEditFindings = null,
  onEditAction = null,
  onEditFact = null,
  onEditChrome = null,
  letterHtml = null,
  onEditLetterHtml = null,
}) {
  const finalized = report.status === 'finalized';
  const reportNo = report.id ? `BW-${String(report.id).padStart(4, '0')}` : 'BW-____';
  const head = resolveHeader(stationHeader);
  // EVERY STATIC LINE TYPES (owner request). The template default reads
  // until the officer types the line; a cleared line drops its override.
  // Overrides ride flat `sheet_*` scalars in type_specific (server-safe:
  // scalar strings, never nested objects). Display logic keeps the canonical
  // keys — only the ink is overridable, never what a label resolves to.
  // FREE EDIT (owner request): the letter as one canvas, not a run of
  // boxes. When the host passes onEditLetterHtml (and no AI draft is under
  // review), the editable letter renders a single Word-like canvas seeded
  // from the composed body instead of per-field editors — typing anywhere is
  // allowed because nothing has to map back into a field. The letterhead,
  // the signature block and the appendix stay composed system ink; only the
  // body frees.
  const freeEdit = !!(editable && onEditLetterHtml && !pending);
  // Inside the free canvas (and its hidden seed copy) nothing binds to a
  // field, so the inner tree always renders read-only.
  const editInner = freeEdit ? false : editable;
  const chromeEdit = !!(editInner && onEditChrome);
  const st = (key, fallback) => sheetTextOf(ts, key, fallback);
  for (const hk of ['agency', 'commission', 'regional_office', 'provincial_office', 'station_name', 'station_location', 'office_code']) {
    head[hk] = st(`head ${hk}`, head[hk]);
  }
  // A plain helper, NOT a component: called as {CL(...)} so the elements it
  // returns keep their own identity across renders. An inline <Chrome/>
  // would be a new element type on every keystroke's re-render, remounting
  // the focused WordField and dropping the caret mid-word.
  const CL = (k, fb) =>
    chromeEdit ? (
      <SheetText
        ts={ts}
        textKey={k}
        fallback={fb}
        onEditChrome={onEditChrome}
        ariaLabel={typeof fb === 'string' ? fb : k}
      />
    ) : (fb);
  // The signing official: a per-report override, then the report's own noting
  // official, then the station default — never a blank line on the paper.
  const stationNoted = typeof stationHeader?.noted_by === 'string' ? stationHeader.noted_by.trim() : '';
  const notedName = st('noted name', String(report.noted_by_name || '').trim() || stationNoted || NOTED_BY_NAME);
  // Task 9 — a draft under review brings the model's own Suspect sentence for
  // each respondent row it described; the facts block draws it in place of the
  // record's composed line. A tighten carries none: it rewrites the officer's
  // prose, not the record's facts.
  const facts = buildTypeFacts(report.incident_type, {
    report,
    ts,
    suspectLines: pending && pending.scope !== 'tighten' ? pending.suspectLines : null,
  });
  const recorderName = recordedBy?.name || report.created_by_name || '—';
  const showAppendix = hasSource(report);
  const sourceLanguageLabel = languageLabel(report.narrative_source_language);
  const latestReview = verifications.length > 0 ? verifications[0] : null;
  const reviewLine = appendixReviewLine(verificationStatus, latestReview);
  // The report's own proper nouns (party names, the capitalized words of the
  // place) — the allow-list the value/narrative caster corrects against.
  const proper = properNounMap(properNounsFor(report, ts));
  const caseValue = (v) => toSentenceCase(v, proper);

  // ---- Inline fact editing (owner request — type on the facts too). Which
  // labeled facts accept typing, and where an edit lands. Labels are the
  // sheet's own (see sheetFacts.js); person/item rows edit the underlying
  // group rows cell by cell through onEditFact, so a letter edit is an
  // ordinary draft edit. Computed lines (totals, derived action lines,
  // boilerplate) stay read-only: there is nothing truthful to type into.
  const VICTIM_LABELS = new Set(['Victim', 'Complainant', 'Complainant/Victim', 'Reporting Person', 'Owner', 'Owner/Occupant']);
  const SUSPECT_LABELS = new Set(['Suspect', 'Suspect(s)', 'Suspect (if any)', 'Respondent']);
  const factEdit = !!(editInner && onEditFact);

  // EVERY REMAINING VALUE TYPES (owner request). The generic facts below are
  // printed from type_specific fields, so each label resolves to the field
  // (or fields) it prints: single-source labels offer their box even when
  // the value is still unrecorded, composites offer one box per recorded
  // source, and a label with nothing recorded anywhere offers its first
  // field — there is always somewhere to type. Money fields show the raw
  // stored figure and parse digits back on write (the formatted display is
  // read-only chrome, like the totals). Dates use the native picker.
  //
  // No clean write path, so static by design: Vehicle N and the traffic
  // Injuries (composed group lines with no row editor on the sheet), Name of
  // Missing Person (a composed person line), Point of Entry / Last Seen /
  // Place & Date Lost (templated or fallback composites), and any const-only
  // display ('N/A', '—') with no backing field at all.
  const EDIT_TARGETS = {
    'Weapon/Force Used': { fields: ['weapon_description', 'method_used'] },
    'Weapon Used (if any)': { fields: ['weapon_used'] },
    'Relationship': { fields: ['relationship_between_parties'] },
    'Nature of Incident': { fields: ['type_of_abuse', 'threats_made', 'incident_category', 'persons_involved'] },
    'Injuries (if any)': { fields: ['physical_injury'] },
    'Injuries Sustained': { fields: ['type_of_injury', 'body_part_injury', 'body_part_injured'] },
    'Medical Treatment': { fields: ['medical_treatment', 'medical_facility'] },
    'Medico-Legal Examination': { fields: ['medical_examination', 'medical_facility'] },
    'Suspected Origin': { fields: ['fire_location', 'type_of_property'] },
    'Suspected Cause': { fields: ['possible_cause'] },
    'Quantity': { fields: ['quantity'] },
    'Operation Type': { fields: ['operation_type', 'incident_classification'] },
    'Items/Substance Seized': { fields: ['items_seized', 'packaging_description', 'evidence_found'] },
    'Property/Item Damaged': { fields: ['damaged_property', 'property_description'] },
    'Description of Damage': { fields: ['type_of_damage', 'cause_of_damage'] },
    'Mode/Scheme Used': { fields: ['transaction_method', 'transaction_type', 'promised_service_or_item'] },
    'Item(s) Lost': { fields: ['property_type', 'property_description', 'quantity'] },
    'Items/Damage Involved': { fields: ['property_involved', 'injuries_or_damage'] },
    'Casualties': { fields: ['injuries', 'fatalities'] },
    'Estimated Value': { fields: ['estimated_value'], money: ['estimated_value'] },
    'Amount Involved': { fields: ['amount_involved'], money: ['amount_involved'] },
    'Estimated Cost': { fields: ['estimated_damage_cost'], money: ['estimated_damage_cost'] },
    'Estimated Damage': { fields: ['estimated_property_loss', 'extent_of_damage'], money: ['estimated_property_loss'] },
    'Date(s) of Transaction': { fields: ['transaction_date'], date: true },
    'Circumstances': {
      group: { group: 'missing_person', index: 0, key: 'circumstances' },
      fields: ['circumstances_of_loss'],
    },
    'Distinguishing Marks/Clothing': {
      group: { group: 'missing_person', index: 0 },
      groupKeys: ['clothing_last_seen', 'physical_description'],
      fields: ['clothing_last_seen', 'physical_description'],
    },
  };
  const moneyDigits = (v) => String(v ?? '').replace(/[^0-9.]/g, '');
  const resolveFactSpec = (label) => {
    const spec = EDIT_TARGETS[label];
    if (!spec || !factEdit) return null;
    if (spec.group) {
      const rows = Array.isArray(ts[spec.group.group]) ? ts[spec.group.group] : [];
      if (rows.length > spec.group.index) {
        const keys = spec.groupKeys || [spec.group.key];
        return { editors: keys.map((key) => ({ kind: 'group', group: spec.group.group, index: spec.group.index, key })) };
      }
      if (!spec.fields) return null;
    }
    const fields = spec.fields || [];
    const live = fields.filter((f) => has(ts[f]));
    const editFields = live.length > 0 ? live : fields.slice(0, 1);
    return {
      editors: editFields.map((field) => ({
        kind: spec.date ? 'date' : 'field',
        field,
        money: (spec.money || []).includes(field),
      })),
    };
  };
  const complainantRows = Array.isArray(ts.complainant) ? ts.complainant : [];
  const respondentRows = Array.isArray(ts.respondent) ? ts.respondent : [];
  const stolenRows = Array.isArray(ts.stolen_items) ? ts.stolen_items : [];
  // Incident datetime editing reuses the form's own split: a date and a time
  // held separately, combined exactly the way the report's pickers combine
  // them, so the sheet never invents a midnight it was not given.
  const dtRaw = N(report.incident_datetime);
  const dtDate = dtRaw.slice(0, 10);
  const dtTime = dtRaw.includes('T') ? dtRaw.split('T')[1].slice(0, 5) : '';
  const editDateTime = (which, v) => {
    let next;
    if (which === 'date') next = v ? (dtTime ? `${v}T${dtTime}` : v) : '';
    else next = v ? `${dtDate || new Date().toISOString().slice(0, 10)}T${v}` : dtDate;
    onEditFact({ field: 'incident_datetime' }, next);
  };
  // Typed dates (owner request — no pickers on the paper). A commit is READ
  // back into the stored shape; an unreadable line keeps the stored value
  // and says what it takes, instead of writing the guess.
  const [dateHint, setDateHint] = useState(null);
  const commitIncidentDateTime = (text) => {
    const { date, time } = parseSheetDateTime(text);
    if (!date && !time) {
      setDateHint('Use 21/10/2026 09:40 pm — kept the saved date and time.');
      return;
    }
    setDateHint(null);
    if (date) editDateTime('date', date);
    if (time) editDateTime('time', time);
  };
  const commitDiscoveryDate = (text) => {
    const date = parseSheetDate(text);
    if (!date) {
      setDateHint('Use 21/10/2026 — kept the saved discovery date.');
      return;
    }
    setDateHint(null);
    onEditFact({ tsField: 'date_of_discovery' }, date);
  };
  const commitReportDate = (text) => {
    const date = parseSheetDate(text);
    if (!date) {
      setDateHint('Use 23/10/2026 — kept the saved report date.');
      return;
    }
    setDateHint(null);
    onEditFact({ field: 'report_date' }, date);
  };
  const sexOptions = ['', 'Male', 'Female', 'Unknown'];
  const personEditor = (row, i, group, legend) => (
    <div className="pr-person-edit" key={`${group}-${i}`}>
      <WordField
        className="pr-edit--inline pr-edit--grow"
        value={N(row.name)}
        onChange={(v) => onEditFact({ group, index: i, key: 'name' }, v)}
        ariaLabel={`${legend} name`}
        placeholder="Full name"
      />
      <input
        className={`pr-edit pr-edit--inline pr-edit--age${N(row.age) ? '' : ' pr-edit--empty'}`}
        value={N(row.age)}
        onChange={(e) => onEditFact({ group, index: i, key: 'age' }, e.target.value)}
        aria-label={`${legend} age`}
        placeholder="Age"
      />
      <select
        className={`pr-edit pr-edit--inline${sexOptions.includes(row.sex) && row.sex ? '' : ' pr-edit--empty'}`}
        value={sexOptions.includes(row.sex) ? row.sex : ''}
        onChange={(e) => onEditFact({ group, index: i, key: 'sex' }, e.target.value)}
        aria-label={`${legend} sex`}
      >
        <option value="">Sex</option>
        <option value="Male">Male</option>
        <option value="Female">Female</option>
        <option value="Unknown">Unknown</option>
      </select>
    </div>
  );
  const suspectEditor = (row, i) => {
    const status = N(row.suspect_status);
    const known = status === 'Identified' || status === '';
    return (
      <div className="pr-person-edit pr-person-edit--suspect" key={`respondent-${i}`}>
        <select
          className={`pr-edit pr-edit--inline${status ? '' : ' pr-edit--empty'}`}
          value={status}
          onChange={(e) => onEditFact({ group: 'respondent', index: i, key: 'suspect_status' }, e.target.value)}
          aria-label="Suspect identity"
        >
          <option value="">Identity</option>
          <option value="Unidentified">Unknown</option>
          <option value="Identified">Known</option>
        </select>
        {known && (
          <WordField
            className="pr-edit--inline pr-edit--grow"
            value={N(row.name)}
            onChange={(v) => onEditFact({ group: 'respondent', index: i, key: 'name' }, v)}
            ariaLabel="Suspect name"
            placeholder="Full name"
          />
        )}
        <input
          className={`pr-edit pr-edit--inline pr-edit--age${N(row.age) ? '' : ' pr-edit--empty'}`}
          value={N(row.age)}
          onChange={(e) => onEditFact({ group: 'respondent', index: i, key: 'age' }, e.target.value)}
          aria-label="Suspect age"
          placeholder="Age"
        />
        <WordField
          className="pr-edit--inline pr-edit--grow"
          value={N(row.clothing)}
          onChange={(v) => onEditFact({ group: 'respondent', index: i, key: 'clothing' }, v)}
          ariaLabel="Suspect clothing"
          placeholder="Clothing / attire"
        />
        <WordField
          className="pr-edit--inline pr-edit--grow"
          value={N(row.suspect_description)}
          onChange={(v) => onEditFact({ group: 'respondent', index: i, key: 'suspect_description' }, v)}
          ariaLabel="Suspect description"
          placeholder="Description"
        />
      </div>
    );
  };

  // Task 9 — when a proposal is being typed, the sheet renders the PROPOSAL's
  // values in place of the committed ones; `scope` says whether the fact values
  // belong to this reveal too (a generate) or only the narrative does (a
  // tighten, which rewrites the officer's own prose and leaves the rest alone).
  const pendingOn = !!pending;
  const typeFacts = pendingOn && pending.scope !== 'tighten';
  const typeBody = pendingOn; // narrative (both scopes)
  const typeFindings = typeFacts;
  const typeStatus = typeFacts;

  // What the narrative slot prints: the proposal's text while it is being
  // reviewed, the committed narrative otherwise. The blotter-strip and casing
  // are applied to BOTH, so a proposal types already cleaned and formal-cased.
  const narrativeRaw = pendingOn && pending.narrative != null ? pending.narrative : report.narrative;
  // Word-like ink (owner request): a narrative carrying the allowlisted subset
  // renders its html as-is — casing and the blotter-strip only ever read
  // PLAIN text, and walking them over tags would mangle the ink. AI drafts
  // never carry tags, so proposals always take the cased plain path below.
  const narrativeRich = containsRichTags(narrativeRaw);
  // The cased plain path below never sees tags: a rich narrative renders its
  // html as-is, so its casing is not computed at all rather than computed
  // over markup it would mangle.
  const narrativeText = narrativeRich ? '' : caseValue(stripLeadingBlotterRestatement(narrativeRaw)) || '—';

  // NOTABLE FINDINGS / ACTION TAKEN: a generate proposal replaces them; a
  // tighten (or no proposal) leaves the committed values untouched.
  //
  // Word-like ink (owner request): the officer's own words in both fields may
  // carry the allowlisted subset. Everything the sheet DERIVES from them —
  // the line split, the emptiness filter, the casing, the routing-line test —
  // reads the PLAIN text, while the committed html itself is what the rich
  // read path renders and the letter editor writes. AI proposals never carry
  // tags, so a draft under review always takes the plain path below.
  const pendingFindings = pendingOn && pending.findingsText != null ? String(pending.findingsText) : null;
  const findingsHtml = pendingFindings ?? String(ts.notable_findings ?? '');
  const findingsRich = containsRichTags(findingsHtml);
  const officerFindings = richTextToPlain(findingsHtml).split('\n').map((s) => s.trim()).filter(Boolean);
  const structuredFindings = buildStructuredFindings(ts);
  const effectiveFindings =
    pendingFindings != null ? officerFindings : [...officerFindings, ...structuredFindings];
  const pendingStatus = pendingOn && pending.statusText != null ? String(pending.statusText) : null;
  const statusHtml = pendingStatus ?? String(report.action_taken || '');
  const statusRich = containsRichTags(statusHtml);
  const officerStatus = richTextToPlain(statusHtml).split('\n').map((s) => s.trim()).filter(Boolean);
  const actionLines = buildActionBlock({
    recordedLines: officerStatus,
    structured: buildStructuredActions(ts),
    perTypeLabels: facts.map((f) => f.label),
    finalizedLine:
      finalized && report.finalized_by_name
        ? `The entry was reviewed and finalized by ${report.finalized_by_name} on ${fmtLong(report.finalized_at)}.`
        : '',
  });
  // The officer's own lines print first, in order, so everything past their
  // count is the station's own tail (structured states, finalization or
  // on-file note, routing line) — the part the rich read path and the letter
  // editor both leave alone.
  const actionTail = actionLines.slice(officerStatus.length);

  // ---- The typewriter: one character cursor over every typed slot, in
  // document order. `val()` registers a value's FINAL text (in `slots`, with
  // its own start offset) and returns the part revealed so far. Slots that do
  // not type (Task 9's chrome — labels, headers, boilerplate) render whole and
  // are on screen from the first frame.
  //
  // The cursor is state, so the slice is computed DURING body construction from
  // the current render's `cursor` — no ordering problem, and a cursor change
  // simply rebuilds the body with more text revealed.
  // A proposal that must not be replayed (see `revealPending`) — or one with no
  // values to type — draws whole from the first frame, exactly as the committed
  // sheet does.
  const animate = revealPending && pendingOn;
  const [cursor, setCursor] = useState(() => (animate ? 0 : Number.MAX_SAFE_INTEGER));
  // The free canvas seeds itself from the composed body it replaces: the
  // hidden copy below renders read-only, so its innerHTML is clean paper
  // html — no editors, no caret traps. A passed letterHtml owns the canvas
  // instead; clearing it re-seeds from the composed letter on the next edit.
  const [seed, setSeed] = useState(null);
  const seedRef = useRef(null);
  useEffect(() => {
    if (!freeEdit) {
      setSeed(null);
      return;
    }
    if (letterHtml) return;
    if (seedRef.current && seedRef.current.innerHTML) setSeed(seedRef.current.innerHTML);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeEdit, letterHtml]);
  const slots = [];
  let slotAcc = 0;
  const val = (text) => {
    const t = String(text ?? '');
    if (!typeOn) return t;
    const start = slotAcc;
    slotAcc += t.length;
    slots.push({ start, length: t.length });
    if (cursor >= start + t.length) return t;
    if (cursor <= start) return '';
    return t.slice(0, cursor - start);
  };

  // Only the values that belong to this reveal register a typed slot;
  // everything else renders whole. `typeOn` is the gate for the CURRENT value
  // and is set immediately before each `val` call, so the JSX stays declarative.
  let typeOn = false;

  // The composed middle — everything the free canvas replaces (office
  // code row through action taken) and everything a kept letter overrides.
  // Built with the inner flag, so the hidden seed copy below reads clean.
  const midPart = (
    <>
      {/* ---- Office code | Date: one row under the seals. CHROME. ---- */}
      <div className="pr-code-date">
        <span className="pr-office-code">{CL('head office code', head.office_code)}</span>
        <span className="pr-date">
          {factEdit ? (
            <WordField
              className="pr-edit--inline pr-edit--grow"
              value={fmtLong(report.report_date || new Date())}
              onChange={commitReportDate}
              ariaLabel="Report date — type 23/10/2026"
              placeholder="Report date"
            />
          ) : (fmtLong(report.report_date || new Date()))}
          <span className="pr-date-label">{CL('date label', "Date")}</span>
        </span>
      </div>

      <h1 className="pr-title">{CL('title', "POLICE REPORT")}</h1>

      <p className="pr-salutation">{CL('salutation', "To whom it may concern:")}</p>

      {/* CHROME — the certification line's boilerplate, with only its two
          recorded values (blotter no. and date) filled in. Those are template
          facts the officer's own record supplies, not AI output. */}
      <p className="pr-certify">
        {CL('certify a', "This is to certify that, according to the police")}{' '}
        <strong>blotter entry # {reportNo}</strong>, dated{' '}
        <strong>{fmtLong(report.incident_datetime)},</strong>{' '}
        {CL('certify b', "appeared among other things the following data to wit;")}
      </p>

      {/* Full caps: the quoted category follows the letter's own convention. */}
      <p className="pr-incident-type">&ldquo;{CL('incident type', toUpperCase(report.incident_type))}&rdquo;</p>

      {/* ---- Per-type labeled facts — bold chrome LABELS, typed values ---- */}
      <div className="pr-facts">
        {facts.map((entry, i) => {
          if (entry.items) {
            // Numbered Stolen/Items block with optional TOTAL. Editable: each
            // row's description, quantity and value type straight into the
            // group row. Rows are added and removed in the revealed form
            // fields — the paper is a typing surface, never a grid.
            if (factEdit) {
              return (
                <div className="pr-items" key={`fact-${i}`}>
                  <div className="pr-fact">
                    <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                  </div>
                  {stolenRows.map((row, j) => (
                    <div className="pr-item-edit" key={`item-${j}`}>
                      <span className="pr-item-num">{j + 1}.)</span>
                      <WordField
                        className="pr-edit--inline pr-edit--grow"
                        value={N(row.item_description)}
                        onChange={(v) => onEditFact({ group: 'stolen_items', index: j, key: 'item_description' }, v)}
                        ariaLabel={`Item ${j + 1} description`}
                        placeholder="Item description"
                      />
                      <input
                        className="pr-edit pr-edit--inline pr-edit--qty"
                        value={N(row.quantity)}
                        onChange={(e) => onEditFact({ group: 'stolen_items', index: j, key: 'quantity' }, e.target.value)}
                        aria-label={`Item ${j + 1} quantity`}
                        placeholder="Qty" />
                      <input
                        className="pr-edit pr-edit--inline pr-edit--qty"
                        value={N(row.estimated_value)}
                        onChange={(e) => onEditFact({ group: 'stolen_items', index: j, key: 'estimated_value' }, e.target.value)}
                        aria-label={`Item ${j + 1} value`}
                        placeholder="₱" />
                    </div>
                  ))}
                  {stolenRows.length === 0 && entry.items.map((it, j) => {
                    // Legacy scalars predate the group: read-only until a row
                    // is added in the revealed form fields.
                    typeOn = typeFacts;
                    const line = `${j + 1}.) ${caseValue(it.desc)}${it.value ? ` - ${fmtItemValue(it.value)}` : ''}`;
                    return (
                      <div className="pr-item" key={`item-${j}`}>
                        {val(line)}
                      </div>
                    );
                  })}
                  {entry.total !== null && (() => {
                    typeOn = typeFacts;
                    const total = `TOTAL, - - - ${entry.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
                    return <div className="pr-item-total">{val(total)}</div>;
                  })()}
                </div>
              );
            }
            return (
              <div className="pr-items" key={`fact-${i}`}>
                <div className="pr-fact">
                  <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                </div>
                {entry.items.map((it, j) => {
                  typeOn = typeFacts;
                  const line = `${j + 1}.) ${caseValue(it.desc)}${it.value ? ` - ${fmtItemValue(it.value)}` : ''}`;
                  return (
                    <div className="pr-item" key={`item-${j}`}>
                      {val(line)}
                    </div>
                  );
                })}
                {entry.total !== null && (() => {
                  typeOn = typeFacts;
                  const total = `TOTAL, - - - ${entry.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
                  return <div className="pr-item-total">{val(total)}</div>;
                })()}
              </div>
            );
          }
          // Editable scalars: Place and the dates type into the record — as
          // typed text, parsed back on commit (no pickers on the paper).
          if (factEdit && entry.label === 'Place') {
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <WordField
                  className="pr-edit--inline pr-edit--grow"
                  value={N(report.location)}
                  onChange={(v) => onEditFact({ field: 'location' }, v)}
                  ariaLabel="Place of incident"
                  placeholder="Place of incident"
                />
              </div>
            );
          }
          if (factEdit && entry.label === 'Date & Time of Incident') {
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <span className="pr-fact-value">
                  <WordField
                    className="pr-edit--inline pr-edit--grow"
                    value={`Around ${fmtIncidentLong(report.incident_datetime)}`}
                    onChange={commitIncidentDateTime}
                    ariaLabel="Date and time of incident — type 21/10/2026 09:40 pm"
                    placeholder="Around 21/10/2026 09:40 pm"
                  />
                </span>
              </div>
            );
          }
          if (factEdit && entry.label === 'Date of Discovery') {
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <span className="pr-fact-value">
                  <WordField
                    className="pr-edit--inline pr-edit--grow"
                    value={fmtLong(ts.date_of_discovery)}
                    onChange={commitDiscoveryDate}
                    ariaLabel="Date of discovery — type 21/10/2026"
                    placeholder="Date of discovery"
                  />
                </span>
              </div>
            );
          }
          // Editable people: victim and suspect rows edit cell by cell. Rows
          // are added in the revealed form fields; an empty group with no
          // composed lines reads as a dash on the paper.
          if (factEdit && VICTIM_LABELS.has(entry.label)) {
            return (
              <div className="pr-fact pr-fact--people" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <span className="pr-fact-value">
                  {complainantRows.length > 0
                    ? complainantRows.map((row, j) => personEditor(row, j, 'complainant', entry.label))
                    : (entry.values || []).filter(Boolean).map((line, j) => {
                      typeOn = typeFacts;
                      return (
                        <React.Fragment key={j}>
                          {j > 0 && <br />}
                          {val(caseValue(line))}
                        </React.Fragment>
                      );
                    })}
                  {complainantRows.length === 0 && (entry.values || []).filter(Boolean).length === 0 && (
                    <span className="pr-fact-value">—</span>
                  )}
                </span>
              </div>
            );
          }
          if (factEdit && SUSPECT_LABELS.has(entry.label)) {
            return (
              <div className="pr-fact pr-fact--people" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <span className="pr-fact-value">
                  {respondentRows.length > 0
                    ? respondentRows.map((row, j) => suspectEditor(row, j))
                    : (entry.values || []).filter(Boolean).map((line, j) => {
                      typeOn = typeFacts;
                      return (
                        <React.Fragment key={j}>
                          {j > 0 && <br />}
                          {val(caseValue(line))}
                        </React.Fragment>
                      );
                    })}
                  {respondentRows.length === 0 && (entry.values || []).filter(Boolean).length === 0 && (
                    <span className="pr-fact-value">—</span>
                  )}
                </span>
              </div>
            );
          }
          const values = (entry.values || []).filter(Boolean);
          // Every resolved value types: one box per source field, joined the
          // way the read path joins them. Resolved first, so an unrecorded
          // field still offers its box instead of a dash. The const fallbacks
          // ('None', '—') never enter a box — an empty box means "not recorded".
          const factSpec = resolveFactSpec(entry.label);
          if (values.length === 0 && !factSpec) {
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <span className="pr-fact-value">—</span>
              </div>
            );
          }
          if (factSpec) {
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
                <span className="pr-fact-value">
                  {factSpec.editors.map((ed, k) => (
                    <React.Fragment key={k}>
                      {k > 0 && ', '}
                      {ed.kind === 'group' ? (
                        <WordField
                          className="pr-edit--inline pr-edit--grow"
                          value={N(ts[ed.group]?.[ed.index]?.[ed.key])}
                          onChange={(v) => onEditFact({ group: ed.group, index: ed.index, key: ed.key }, v)}
                          ariaLabel={`${entry.label} ${ed.key}`}
                          placeholder={labelCase(entry.label)}
                        />
                      ) : ed.kind === 'date' ? (
                        <WordField
                          className="pr-edit--inline pr-edit--grow"
                          value={N(ts[ed.field]) ? fmtLong(ts[ed.field]) : ''}
                          onChange={(text) => {
                            const date = parseSheetDate(text);
                            if (!date) {
                              setDateHint(`Use 21/10/2026 — kept the saved ${String(entry.label).toLowerCase()}.`);
                              return;
                            }
                            setDateHint(null);
                            onEditFact({ tsField: ed.field }, date);
                          }}
                          ariaLabel={`${entry.label} — type 21/10/2026`}
                          placeholder={labelCase(entry.label)}
                        />
                      ) : (
                        <WordField
                          className="pr-edit--inline pr-edit--grow"
                          value={N(ts[ed.field])}
                          onChange={(v) => onEditFact({ tsField: ed.field }, ed.money ? moneyDigits(v) : v)}
                          ariaLabel={entry.label}
                          placeholder={labelCase(entry.label)}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </span>
              </div>
            );
          }
          // One fact per entry: the value span holds every line so any
          // wrap aligns under the FIRST value character (hanging indent).
          return (
            <div className="pr-fact" key={`fact-${i}`}>
              <span className="pr-fact-label">{CL(`label ${entry.label}`, labelCase(entry.label))}:</span>
              <span className="pr-fact-value">
                {values.map((line, j) => {
                  typeOn = typeFacts;
                  return (
                    <React.Fragment key={j}>
                      {j > 0 && <br />}
                      {val(caseValue(line))}
                    </React.Fragment>
                  );
                })}
              </span>
            </div>
          );
        })}
        {factEdit && dateHint && (
          <div className="pr-date-hint" role="status">{dateHint}</div>
        )}
      </div>

      {/* ---- Narrative — printed VERBATIM in WORDING (Task 1): no reformat,
           no re-generation. React escapes it; line-wrap is CSS only. Task 2
           adds only capitals (sentence starts and the report's own proper
           nouns) and never flattens or rewrites a word. Task 6 — a LEADING
           blotter-entry restatement is dropped, because the certification
           line directly above already states it; this also cleans a legacy
           row stored before the server stopped adding one. Task 9 — the label
           is chrome; the text types itself in. ---- */}
      <div className="pr-narrative">
        <strong>{CL('facts head', "FACTS OF THE CASE:")} </strong>
        {editInner && onEditNarrative ? (
          <RichTextArea
            value={narrativeRaw}
            onChange={onEditNarrative}
            className="pr-narrative-edit"
            ariaLabel="Facts of the case — edit on the letter"
            rows={10}
            toolbar="none"
          />
        ) : narrativeRich ? (
          <div
            className="pr-narrative-html"
            dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(narrativeRaw) }}
          />
        ) : (
          <span className="pr-narrative-text">{(() => { typeOn = typeBody; return val(narrativeText); })()}</span>
        )}
      </div>

      {/* NOTHING HERE ABOUT THE NARRATIVE'S LANGUAGE (owner request,
          2026-10-06). A one-line "Narrative language: Bisaya (not translated)"
          note used to sit between this block and the next one, for any report
          whose narrative was filed in a language other than English (Phase 6
          Stage 1, D6 — `printLanguageLine`). The sheet is the incident's
          document, and how the record was PROCESSED is not part of what the
          incident contains; whoever needs that statement reads it on the
          screens that keep it, and every one of those is untouched — the
          editor's notice, the finalize warning, the history note, and the
          review appendix, which prints the original text with its language
          named. Neither the node nor its helper is left behind: nothing renders
          a line here, and nothing computes one. */}

      {/* NOTABLE FINDINGS prints only when the report carries findings (owner
          request, 2026-10-26 — retiring the always-on rule): an empty result
          omits the section instead of printing the absence. A model with
          nothing to formalise writes that fact as "- None recorded."; the
          emptiness filter upstream (see the panel's draftedFindings) stops it
          before it reaches this block, so a section that reaches here with no
          lines genuinely has nothing to say. */}
      {(effectiveFindings.length > 0 || (editInner && onEditFindings)) && (
        <div className="pr-section">
          <strong>{CL('findings head', "NOTABLE FINDINGS:")}</strong>
          {editInner && onEditFindings ? (
            <RichTextArea
              value={findingsHtml}
              onChange={onEditFindings}
              className="pr-edit pr-findings-edit"
              ariaLabel="Notable findings — edit on the letter"
              placeholder="Type directly on the letter — your edits land in the report."
              rows={Math.min(12, Math.max(3, effectiveFindings.length + 1))}
              toolbar="none"
            />
          ) : findingsRich ? (
            <>
              <div
                className="pr-findings-html"
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(findingsHtml) }}
              />
              {structuredFindings.map((fnd, i) => {
                typeOn = typeFindings;
                return (
                  <div className="pr-entry" key={`find-struct-${i}`}>{val(`- ${caseValue(fnd)}`)}</div>
                );
              })}
            </>
          ) : (
            effectiveFindings.map((fnd, i) => {
              typeOn = typeFindings;
              return (
                <div className="pr-entry" key={`find-${i}`}>{val(`- ${caseValue(fnd)}`)}</div>
              );
            })
          )}
        </div>
      )}

      {/* Flush-left entries (scanned reference: the action text starts at the
          same margin as the heading). */}
      <div className="pr-section pr-actions">
        <strong>{CL('actions head', "ACTION TAKEN / STATUS:")}</strong>
        {editInner && onEditAction ? (
          <>
            <RichTextArea
              value={statusHtml}
              onChange={onEditAction}
              className="pr-edit pr-actions-edit"
              ariaLabel="Action taken — edit on the letter"
              placeholder="Type directly on the letter — your edits land in the report."
              rows={Math.min(12, Math.max(3, officerStatus.length + 1))}
              toolbar="none"
            />
            {actionTail.map((act, i) => {
              typeOn = typeStatus;
              return (
                <div className="pr-entry" key={`act-derived-${i}`}>{val(caseValue(act))}</div>
              );
            })}
          </>
        ) : statusRich ? (
          <>
            <div
              className="pr-actions-html"
              dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(statusHtml) }}
            />
            {actionTail.map((act, i) => {
              typeOn = typeStatus;
              return (
                <div className="pr-entry" key={`act-${i}`}>{val(caseValue(act))}</div>
              );
            })}
          </>
        ) : (
          actionLines.map((act, i) => {
            typeOn = typeStatus;
            return (
              <div className="pr-entry" key={`act-${i}`}>{val(caseValue(act))}</div>
            );
          })
        )}
      </div>

    </>
  );

  // What sits between the letterhead and the signature block: the free
  // canvas (with its hidden seed copy) while freeing, the freed text while
  // kept, the composed body otherwise.
  const midHost = freeEdit ? (
    <>
      <div ref={seedRef} hidden>{midPart}</div>
      <RichTextArea
        value={letterHtml || seed || ''}
        onChange={onEditLetterHtml}
        className="pr-freeedit"
        ariaLabel="Letter \u2014 free edit"
        placeholder="Type freely on the letter \u2014 it keeps its own text."
        rows={24}
        toolbar="none"
        sanitize={sanitizeLetterHtml}
      />
    </>
  ) : letterHtml ? (
    <div
      className="pr-letter-html"
      dangerouslySetInnerHTML={{ __html: sanitizeLetterHtml(letterHtml) }}
    />
  ) : (
    midPart
  );

  // The sheet body is built with `val`, which is what fills `slotAcc`.
  const body = (
    <>
      {/* ---- Agency header: station seal (upper LEFT, 1x1, with the bold
           Arial "NCPS-INVEST" code beneath it) + org block, RP seal on the
           right. CHROME — rendered immediately, never typed. ---- */}
      <header className="pr-head">
        <div className="pr-head-left">
          <img className="pr-code-logo" src={pnpLogo} alt="PNP seal" />
        </div>
        <div className="pr-org">
          {CL('head agency', head.agency)}
          <br />
          {CL('head commission', head.commission)}
          <br />
          <strong>{CL('head regional office', head.regional_office)}</strong>
          <br />
          <strong>{CL('head provincial office', head.provincial_office)}</strong>
          <br />
          <strong>{CL('head station name', head.station_name)}</strong>
          <br />
          {CL('head station location', head.station_location)}
        </div>
        <img
          className="pr-seal"
          src={citySeal}
          alt="City of Naga Police Station seal"
        />
      </header>

      {midHost}

      {/* ---- Signature block: Recorded by / IOC / Noted by. The labels type
           like every other line; the signing name resolves per-report, then
           the station default (see notedName above). ---- */}
      <div className="pr-footer-block">
        <p className="pr-recorded">
          <strong>{CL('recorded label', "Recorded by:")}</strong> {recorderName}
        </p>

        <p className="pr-recorded">
          <strong>{CL('ioc label', "IOC:")}</strong> {String(report.ioc_name || '').trim() || '—'}
        </p>

        <div className="pr-noted">
          <span className="pr-noted-label">{CL('noted label', "Noted by:")}</span>
          <span className="pr-noted-name">
            {chromeEdit ? (
              <SheetText
                ts={ts}
                textKey="noted name"
                fallback={notedName}
                onEditChrome={onEditChrome}
                ariaLabel="Noted by"
              />
            ) : notedName}
          </span>
        </div>
      </div>

      {/* ---- D2 — the appendix page, only when a stored source exists. This is
           the officer's OWN verbatim source text, not AI output, so it is
           chrome here: it never types. ---- */}
      {showAppendix && (
        <section className="pr-appendix">
          <h2 className="pr-appendix-title">{APPENDIX_HEADING}</h2>
          <p className="pr-appendix-intro">{appendixIntro(sourceLanguageLabel)}</p>
          <div className="pr-appendix-label">{appendixSourceLabel(sourceLanguageLabel)}</div>
          <p className="pr-appendix-source">{report.narrative_source_text}</p>
          <p className="pr-appendix-note">{reviewLine}</p>
          <p className="pr-appendix-close">{appendixCloseLine}</p>
        </section>
      )}
    </>
  );

  // `slotAcc` is now the whole sequence's length.
  const totalChars = slotAcc;
  const typing = animate && totalChars > 0;

  // TASK 10 — the progress handler is held in a ref so the interval below is
  // still created once per reveal, while always calling the host's LATEST
  // function: a host that re-renders mid-sequence (the AI panel does) would
  // otherwise be answered by the closure captured when the typing started.
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  // The one driver. A new reveal (new key) always restarts from zero; a reduced-
  // motion preference — or a non-typing sheet — shows everything at once.
  useLayoutEffect(() => {
    if (!typing) {
      setCursor(Number.MAX_SAFE_INTEGER);
      // A proposal with nothing to type (no values at all) still has to release
      // the editor's gate, or Accept could never be pressed. Non-proposal
      // renders (the print portal) must not fire it.
      if (pendingOn) onRevealComplete?.();
      return undefined;
    }
    if (prefersReducedMotion()) {
      setCursor(totalChars);
      onRevealComplete?.();
      return undefined;
    }
    setCursor(0);
    progressRef.current?.(0); // a new reveal starts at the top of the letter
    const perTick = Math.max(1, Math.ceil(totalChars / (TYPE_TARGET_MS / TYPE_TICK_MS)));
    let shown = 0;
    const timer = setInterval(() => {
      shown += perTick;
      if (shown >= totalChars) {
        clearInterval(timer);
        setCursor(totalChars);
        progressRef.current?.(1);
        onRevealComplete?.();
      } else {
        setCursor(shown);
        progressRef.current?.(shown / totalChars);
      }
    }, TYPE_TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, typing, totalChars]);

  const done = !typing || cursor >= totalChars;
  const skip = () => {
    if (!done) {
      setCursor(totalChars);
      onRevealComplete?.();
    }
  };

  // The reveal wrapper carries the click-to-finish affordance. It is inert for
  // the print portal and after the sequence lands, so the committed sheet (and
  // the printed page) behaves exactly as before.
  return (
    <div
      className={`pr-sheet-body${typing && !done ? ' pr-sheet-typing' : ''}`}
      onClick={typing && !done ? skip : undefined}
      title={typing && !done ? 'Click to show the whole draft' : undefined}
    >
      {/* One live announcement for assistive tech, once the sequence lands —
          the paced text itself is not a live region, so nothing chatters. */}
      {typing && done && (
        <div className="sr-only" role="status">Draft typed into the report sheet.</div>
      )}
      {body}
    </div>
  );
}
