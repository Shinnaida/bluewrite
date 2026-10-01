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
// two drift. The component is purely presentational — it computes the sheet's
// facts from `report` + `ts` via src/lib/sheetFacts.js and renders; it holds no
// state of its own beyond the typewriter cursor and never writes anything.
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

import React, { useRef, useState, useLayoutEffect } from 'react';
import { resolveHeader } from '../lib/stationSettings.js';
import { printLanguageLine, languageLabel } from '../lib/reportLanguages.js';
import {
  hasSource,
  APPENDIX_HEADING,
  appendixIntro,
  appendixSourceLabel,
  appendixReviewLine,
  appendixCloseLine,
} from '../lib/reportVerification.js';
import {
  buildTypeFacts,
  buildFindings,
  buildStructuredActions,
  fmtLong,
  properNounsFor,
} from '../lib/sheetFacts.js';
import { buildActionBlock } from '../lib/printActions.js';
// Task 2 — the letter's casing layer. `labelCase` spells every bold label in
// Title Case; `toSentenceCase` corrects values and prose (sentence starts plus
// the report's OWN proper nouns) without ever flattening an existing capital or
// changing a word — so the narrative's wording stays exactly as accepted.
import { toUpperCase, toSentenceCase, labelCase, properNounMap } from '../lib/printCasing.js';
import { stripLeadingBlotterRestatement } from '../lib/narrativeText.js';
import pnpLogo from '../assets/pnp-logo.png';
import citySeal from '../assets/city-of-naga-seal.png';

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
 *   type into the sheet: `{ narrative, findingsText?, statusText?, scope }`,
 *   where scope is 'generate' (type the facts too) or 'tighten' (type only the
 *   narrative). Absent → the ordinary, fully-rendered sheet.
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
}) {
  const finalized = report.status === 'finalized';
  const reportNo = report.id ? `BW-${String(report.id).padStart(4, '0')}` : 'BW-____';
  const head = resolveHeader(stationHeader);
  const languageLine = printLanguageLine(report.narrative_language);
  const facts = buildTypeFacts(report.incident_type, { report, ts });
  const findings = buildFindings(ts);
  const recorderName = recordedBy?.name || report.created_by_name || '—';
  const showAppendix = hasSource(report);
  const sourceLanguageLabel = languageLabel(report.narrative_source_language);
  const latestReview = verifications.length > 0 ? verifications[0] : null;
  const reviewLine = appendixReviewLine(verificationStatus, latestReview);
  // The report's own proper nouns (party names, the capitalized words of the
  // place) — the allow-list the value/narrative caster corrects against.
  const proper = properNounMap(properNounsFor(report, ts));
  const caseValue = (v) => toSentenceCase(v, proper);

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
  const narrativeText = caseValue(stripLeadingBlotterRestatement(narrativeRaw)) || '—';

  // NOTABLE FINDINGS / ACTION TAKEN: a generate proposal replaces them; a
  // tighten (or no proposal) leaves the committed values untouched.
  const effectiveFindings =
    pendingOn && pending.findingsText != null
      ? String(pending.findingsText).split('\n').map((s) => s.trim()).filter(Boolean)
      : findings;
  const effectiveRecorded =
    pendingOn && pending.statusText != null
      ? String(pending.statusText).split('\n')
      : String(report.action_taken || '').split('\n');
  const actionLines = buildActionBlock({
    recordedLines: effectiveRecorded,
    structured: buildStructuredActions(ts),
    perTypeLabels: facts.map((f) => f.label),
    finalizedLine:
      finalized && report.finalized_by_name
        ? `The entry was reviewed and finalized by ${report.finalized_by_name} on ${fmtLong(report.finalized_at)}.`
        : '',
  });

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

      {/* ---- Office code | Date: one row under the seals. CHROME. ---- */}
      <div className="pr-code-date">
        <span className="pr-office-code">{head.office_code}</span>
        <span className="pr-date">
          {fmtLong(report.report_date || new Date())}
          <span className="pr-date-label">Date</span>
        </span>
      </div>

      <h1 className="pr-title">POLICE REPORT</h1>

      <p className="pr-salutation">To whom it may concern:</p>

      {/* CHROME — the certification line's boilerplate, with only its two
          recorded values (blotter no. and date) filled in. Those are template
          facts the officer's own record supplies, not AI output. */}
      <p className="pr-certify">
        This is to certify that, according to the police{' '}
        <strong>blotter entry # {reportNo}</strong>, dated{' '}
        <strong>{fmtLong(report.incident_datetime)},</strong> appeared among
        other things the following data to wit;
      </p>

      {/* Full caps: the quoted category follows the letter's own convention. */}
      <p className="pr-incident-type">&ldquo;{toUpperCase(report.incident_type)}&rdquo;</p>

      {/* ---- Per-type labeled facts — bold chrome LABELS, typed values ---- */}
      <div className="pr-facts">
        {facts.map((entry, i) => {
          if (entry.items) {
            // Numbered Stolen/Items block with optional TOTAL.
            return (
              <div className="pr-items" key={`fact-${i}`}>
                <div className="pr-fact">
                  <span className="pr-fact-label">{labelCase(entry.label)}:</span>
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
          const values = (entry.values || []).filter(Boolean);
          if (values.length === 0) {
            return (
              <div className="pr-fact" key={`fact-${i}`}>
                <span className="pr-fact-label">{labelCase(entry.label)}:</span>
                <span className="pr-fact-value">—</span>
              </div>
            );
          }
          // One fact per entry: the value span holds every line so any
          // wrap aligns under the FIRST value character (hanging indent).
          return (
            <div className="pr-fact" key={`fact-${i}`}>
              <span className="pr-fact-label">{labelCase(entry.label)}:</span>
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
        <strong>FACTS OF THE CASE: </strong>
        <span className="pr-narrative-text">{(() => { typeOn = typeBody; return val(narrativeText); })()}</span>
      </div>

      {/* D6 — rendered ONLY for a non-English declaration. */}
      {languageLine && <p className="pr-language">{languageLine}</p>}

      {effectiveFindings.length > 0 && (
        <div className="pr-section">
          <strong>NOTABLE FINDINGS:</strong>
          {effectiveFindings.map((fnd, i) => {
            typeOn = typeFindings;
            return (
              <div className="pr-entry" key={`find-${i}`}>{val(`- ${caseValue(fnd)}`)}</div>
            );
          })}
        </div>
      )}

      {/* Flush-left entries (scanned reference: the action text starts at the
          same margin as the heading). */}
      <div className="pr-section pr-actions">
        <strong>ACTION TAKEN / STATUS:</strong>
        {actionLines.map((act, i) => {
          typeOn = typeStatus;
          return (
            <div className="pr-entry" key={`act-${i}`}>{val(caseValue(act))}</div>
          );
        })}
      </div>

      {/* ---- Signature block: Recorded by / IOC / Noted by. CHROME. ---- */}
      <div className="pr-footer-block">
        <p className="pr-recorded">
          <strong>Recorded by:</strong> {recorderName}
        </p>

        <p className="pr-recorded">
          <strong>IOC:</strong> {String(report.ioc_name || '').trim() || '—'}
        </p>

        <div className="pr-noted">
          <span className="pr-noted-label">Noted by:</span>
          <span className="pr-noted-name">{NOTED_BY_NAME}</span>
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
