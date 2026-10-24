// BlueWrite — Phase 3 AI narrative panel (UC-006/007/008).
// Generate opens the draft INLINE, in the assistant's own card and directly
// under the Generate row: the officer asked for it there, so it comes back
// there rather than docking a second column onto the right edge of the
// workspace (which squeezed the report they were reading it against).
//
// The draft body shows while a request is running, while an error is on
// screen, and while a draft is waiting to be reviewed; ✕ (or Escape) hides it
// again and keeps the draft — "A draft is ready" is the way back to it.
// Actions: Accept (copies the WHOLE draft into the report), Regenerate (with
// feedback note), Close. The AI NEVER writes the report directly; generation
// is always an explicit officer action. On 503 the panel shows the
// persistent manual-mode banner and hides Generate entirely.
//
// The draft is REVIEWED in the three parts the printed sheet names — FACTS OF
// THE CASE (the narrative), NOTABLE FINDINGS and ACTION TAKEN / STATUS (what
// Generate formalised into the report's own two fields) — and all three are
// editable boxes in the panel. Nothing reaches the report until Accept: a
// generated draft is a PROPOSAL, and the narrative alone is only a third of
// what one contains.

import React, { useEffect, useRef, useState } from 'react';
// The fullscreen page is portaled to document.body, exactly as the print
// portal is: it is not content of the card it was asked for, it is a SCREEN of
// its own, and nothing about the app may be part of that picture.
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import NarrativeReveal from './NarrativeReveal.jsx';
// TASK 9 — the bondpaper itself. The AI's words type into THE LETTER — the same
// component the print portal draws, so the page reviewed and the page that
// prints cannot drift — in this card, directly under the button that asked for
// them (see `sheet` below). It is purely presentational: it computes the page's
// facts from the report it is handed and never writes anything.
import ReportSheetBody from './ReportSheetBody.jsx';
// The assistant's voice orb, above the two actions in the ready state — the
// panel's one moving part, and the reason a wait reads as the assistant working
// rather than as the panel having stalled. It is a plain SVG badge; see
// AiVoiceOrb.jsx for why it is drawn rather than simulated.
import AiVoiceOrb from './AiVoiceOrb.jsx';
// The glowing gradient behind that orb (the pasted gradient-orb shader, ported
// to plain three — see AiOrbBackdrop.jsx). It is mounted in the same centred
// column as the orb and sized from the same number, so the aura cannot drift
// off the ball it is backing.
import AiOrbBackdrop from './AiOrbBackdrop.jsx';
// The specular rim on the panel's primary action (see the mount below). Vendored
// from React Bits; its header records the one adaptation it needed here.
import SpecularButton from './SpecularButton.jsx';
// The ⓘ marker that carries this panel's explanations. It is a component rather than a
// private function here because the account form uses the same marker for the sentences
// under its fields — see InfoHint.jsx for the whole of its contract.
import InfoHint from './InfoHint.jsx';
import { useRotatingStatus, holdVerifyPhase, VERIFY_PHRASE, THINKING_PHRASES } from '../lib/useRotatingStatus.js';
// Phase 6 Stage 4/5 — the language vocabulary all comes from the registry
// (never a list held here), and the one wording for a language whose AI
// translation is switched off. `narrativeLanguageOptions` is NOT read here any
// more: nothing in this panel offers a language to pick. The narrative's own
// language is DETECTED from the text (src/lib/reportLanguages.js), so there is
// no selector to fill and no codes to list. The registry function stays for the
// callers that still offer them.
import { languageLabel } from '../lib/reportLanguages.js';
import { translationEnabled, translationDisabledNotice } from '../lib/languageRegistry.js';
// Phase 6 Stage 5 (Track C) — the guided "Translate & tighten" flow. The rule
// is a pure state machine (src/lib/guidedFlow.js) and this component only ever
// drives it, so "tighten before the officer reviewed and applied the
// translation" cannot be expressed here at all.
import {
  GUIDED_IDLE,
  guidedFlowReduce,
  guidedIsReviewing,
  guidedIsTerminal,
  guidedStepLabel,
} from '../lib/guidedFlow.js';

// Phase 5 economy kinds → the officer's label. The server sends a `kind` as
// well as a sentence so the label stays short here and the sentence stays
// available to anything that only renders text.
const REDUNDANCY_LABEL = {
  merged: 'Merged into one finding',
  'restates-narrative': 'Dropped — the narrative already says it',
  negation: 'Dropped — not an observation',
  padding: 'Trimmed as padding',
};

// The panel's two actions share ONE toolbar row, and the explanation each of
// them used to carry in a hint paragraph under it rides on the ⓘ marker beside
// them instead (see InfoHint). Same words, one line of the panel instead of
// three — the panel is chrome beside the report, not a second page of it.
const AI_TOOLBAR_HINT =
  'Generate writes a formal draft from the report you have filled in — or, when the report is written in another language, translates that narrative into formal English. The draft arrives in a box you can edit before accepting it. Tighten runs the economy rules over the narrative you wrote: repeated propositions merged, padding and closing formulas removed. Nothing is written into the report until you review and accept it.';
const AI_GUIDED_HINT =
  'Step 1 translates your narrative into formal English; you check it against the glosses and apply it. Step 2 then offers a tightened version of that English text as a proposal — nothing is written into the report until you click.';

// The account read is ONE attempt server-side by design (nothing to queue a
// retry against — see NarrativeService::classifyAccount), so a service that is
// merely BUSY would otherwise be handed straight back to the officer as a
// failed press they can do nothing about. "Busy" is a wait, not a failure: the
// press waits it out once, in the open, and only a second busy answer reaches
// the officer — by which time the panel can honestly say to try again in a
// minute. (Waiting longer would hold the officer on a spinner longer than a
// retry is worth; the retry control is there for that.)
const READ_ATTEMPTS = 2;
const READ_RETRY_WAIT_MS = 5000;

// THE LEAF, IN CSS PIXELS. A sheet of short bond is 8.5 × 11in, and the page's
// own rule states exactly that (`.print-sheet` — "US Letter, the station's
// paper" — with border-box sizing, so the leaf is the paper). At 96 CSS px to
// the inch these are the same two numbers, and they are written here only
// because the size below is a RATIO of the frame's box to this page, and CSS
// cannot divide one length by another. The WIDTH is the one the frame is sized
// against; the height is the leaf's, and the frame scrolls over it. If the
// station's paper ever changes, both move with that rule.
const SHEET_PX = { width: 8.5 * 96, height: 11 * 96 };

// THE THREE PARTS OF A DRAFT, in the order the printed sheet prints them, plus
// where the arrival sequence ends. The reveal walks this list: each part types
// itself in (NarrativeReveal) and then hands over to the next, so what the
// officer watches is the draft being written in the order it will be read —
// what happened, what was found, what was done about it.
//
// A part the draft has nothing for is SKIPPED, never played empty (see
// stageAfter below): a report with no notable findings goes straight from the
// facts to the action taken rather than pausing on a blank heading.
const REVEAL_STAGES = ['facts', 'findings', 'status', 'done'];

// The two formalised blocks get a much shorter ceiling than the narrative.
// NarrativeReveal's own 3.5s is right for a paragraph an officer reads against
// the form, and absurd for a single finding — three 3.5s turns back to back
// would hold the panel for ten seconds before a button appeared. At this cap a
// one- or two-line block lands in about a second; the component's own per-char
// floor keeps a long one readable rather than strobing.
const SUB_REVEAL_CAP_MS = 1200;

// THE GENERATE PILL'S OWN CURVE. A pill is a radius of half the button's own
// height, and 999 is how both halves of the control are told that: CSS clamps
// the value down to the half-height it can actually reach, and so does the
// rim's SDF (see SpecularButton.jsx), so the drawn edge and the CSS edge are
// one curve at whatever size the button is drawn at. ONE number: it is passed
// as the `radius` prop, which is also what sets `--sb-radius` on the element —
// change the pill's height and nothing here needs editing.
const RUN_RADIUS = 999;

// The block's head: the badge, the name, and the ⓘ that carries what both
// actions do. ONE definition, because the block has two states (ready, and
// "a draft is waiting") and the two must not drift into naming themselves
// differently.
function AssistHead() {
  return (
    <div className="ai-assist-head">
      <span className="ai-assist-badge" aria-hidden="true">AI</span>
      <span className="ai-assist-title">Writing assistant</span>
      <InfoHint text={AI_TOOLBAR_HINT} />
    </div>
  );
}

// THE TWO DRAWINGS THE FULLSCREEN PREVIEW NEEDS — the expand mark on the
// control that opens it and the ✕ on the one way out of it. Same 24-unit box,
// same 1.8 stroke and round caps as the section glyphs in Reports.jsx, so they
// belong to the document's own drawing set rather than to an icon font that may
// or may not be installed on a station workstation.
const PREVIEW_GLYPH = ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'];
const CLOSE_GLYPH = ['M18 6 6 18', 'M6 6l12 12'];

// HOW BIG THE FULL-SCREEN PAGE IS DRAWN (the card's page is a fixed 50% — see
// the stylesheet; it has no controls). `FIT` is the whole leaf measured to the
// screen: the state the screen opens in, and the state the officer returns to.
// A number is the paper at that fraction of its OWN size, so 1 is 100% — the
// sheet at the size the station prints it, which is the size to read it at.
//
// WHY THE LADDER IS SO COARSE, and why FIT IS ITS FLOOR rather than one rung in
// the middle: the fit on a screen lands near 0.6, and an officer who reaches for
// "bigger" has already decided the whole-leaf view is too small to read. One
// press therefore takes them to the real thing — 100%, the sheet at the size the
// station prints it — from whatever the fit happened to be, and the stops above
// are for reading a page from across the room. Below the fit there is nothing
// worth offering: a stop under it is a smaller page with no more of it visible,
// which is what the overview already is.
const FIT = 'fit';
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3];

// The next stop on the ladder, from wherever the page is NOW. `current` is the
// size actually on screen — in fit mode that is the MEASURED fit, not a number
// held in state, because the fit moves with the frame and the ladder has to be
// climbed from the page the officer is looking at. Stepping DOWN past the
// lowest stop lands on the overview: Fit is the bottom of the ladder, which is
// why the "smaller" stepper is disabled there and nowhere else.
function stepZoom(current, direction) {
  if (direction > 0) {
    return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? FIT;
}

// THE SIZE CONTROLS — the full-screen preview's corner. They were drawn in the
// card as well until the card's page became a fixed 50% (owner request,
// 2026-10-05); the screen is the frame that keeps them, because reading a page
// from across the room is what it is for.
//
// `value` is the panel's own state: FIT, or a stop on the ladder. The readout
// NAMES the state rather than inventing a number for it — in fit mode the size
// is measured and moves with the frame, so "60%" that is really 58% would be a
// made-up figure; "Fit" is the truth, and the moment a stop is picked the
// readout becomes that stop's own percentage. "Fit" as a BUTTON appears only
// when there is something to go back to, and the steppers are disabled at the
// ends of the ladder: a control that cannot change anything says so instead of
// taking the press and doing nothing.
function ZoomControls({ value, onStep, onFit, className = '' }) {
  const atFit = value === FIT;
  const index = atFit ? -1 : ZOOM_STEPS.indexOf(value);
  return (
    <div
      className={`ai-zoom${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Page size"
    >
      <button
        type="button"
        className="ai-zoom-btn"
        onClick={() => onStep(-1)}
        // Disabled ONLY at the overview: below that the page would be smaller
        // with no more of it visible. From any stop, "smaller" is a real size
        // (and the bottom stop steps back to Fit).
        disabled={atFit}
        aria-label="Zoom out"
        title="Draws the page smaller — the overview is as small as it goes."
      >
        −
      </button>
      <span
        className="ai-zoom-value"
        title="The page is a real 8.5 × 11in sheet. Fit shows the whole leaf; the steppers draw it at an exact size, where 100% is the sheet at the size it prints."
      >
        {atFit ? 'Fit' : `${Math.round(value * 100)}%`}
      </span>
      <button
        type="button"
        className="ai-zoom-btn"
        onClick={() => onStep(1)}
        disabled={index === ZOOM_STEPS.length - 1}
        aria-label="Zoom in"
        title="Draws the page larger — 100% is the sheet at the size it prints."
      >
        +
      </button>
      {!atFit && (
        <button
          type="button"
          className="ai-zoom-fit"
          onClick={onFit}
          title="Back to the whole leaf, fitted to the frame it is drawn in."
        >
          Fit
        </button>
      )}
    </div>
  );
}

// The Generate button's file mark is GONE (owner request, 2026-10-06): the
// button is its words alone. The old drawing — the record with the spark, and
// the hairline that parted it from the words — was removed with it.

function SheetGlyph({ paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// A draft box that grows to its own content instead of scrolling inside a
// scroller. THREE of the panel's fields are like this — the narrative and the
// two formalised blocks — and the rule is the same for all of them: the panel
// body is the one scroll, because a document being reviewed must not be a
// window with a scrollbar of its own.
function GrowTextarea({ value, onChange, ariaLabel, rows = 4 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `auto` first: without it the box can only ever grow, never shrink.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="ai-draft-sub"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      aria-label={ariaLabel}
    />
  );
}

// Line-set comparison for the tighten proposals. Order- and blank-insensitive
// on purpose: the analyser's list is the officer's OWN lines with duplicates
// merged and repeats dropped, so a difference in the SET is the only thing
// worth offering to apply.
const normaliseLineSet = (lines) =>
  [...new Set((Array.isArray(lines) ? lines : []).map((l) => String(l).trim().toLowerCase()).filter(Boolean))]
    .sort()
    .join('\n');

// Session persistence (per tab): the AI draft survives navigation and
// reloads within the same browser tab. Keyed by report id so opening a
// different report never shows another report's draft.
const draftStoreKey = (rid) => `bw-ai-draft-${rid ?? 'new'}`;
function loadStoredDraft(rid) {
  try {
    const raw = window.sessionStorage.getItem(draftStoreKey(rid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.narrative === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export default function AiNarrativePanel({
  reportId,
  // The report id the panel's requests are addressed to, resolved on demand:
  // returns `reportId` when the report exists, and otherwise asks the editor to
  // SAVE the draft and hand back the id the server assigned (null when it could
  // not — the editor has already said why, on its own banner, and the panel then
  // goes no further).
  //
  // Generate, Translate and Tighten are all per-report endpoints — the server
  // files the request against a row and reads the stored language back — so a
  // report has to exist before the AI can be asked for anything. Requiring the
  // officer to find Save Draft first was the old answer; saving it FOR them on
  // the click that needs it is this one, and it is why the panel renders on a
  // report that has never been saved (see the guard near the render).
  ensureReportId,
  canEdit,
  narrative,
  actionTaken = '',
  // The form's current Notable Findings text: shown in the Generate row so
  // the officer knows it is what the AI formalises into the draft.
  notableFindings = '',
  // ACCEPT — the ONE action that moves a draft into the report, called with the
  // whole draft: `{ narrative, findingsText, statusText }` (and the source meta
  // for a translated draft). Generating writes nothing, and neither does
  // editing the blocks in the panel, so this is where all three parts of a
  // draft land — together, by one rule. A part the draft does not carry is
  // simply absent from the object: a tighten result hands over its narrative
  // alone (see acceptDraft).
  onAccept,
  // Phase 6 Stage 5 (Track C) — Apply for the guided flow's step 1: the editor
  // applies the reviewed draft to the form AND saves it, because the second step
  // is refused by the server while the STORED report still declares a
  // non-English narrative (that guard is deliberately not weakened). Falls back
  // to onAccept when the editor does not provide it. Same parts argument.
  onApplyGuided,
  // TIGHTEN'S TWO PROPOSALS for the officer's own fields — the only callers left
  // now that generating a draft writes nothing. Each is reached by its own
  // button (“Apply merged findings”, “Apply trimmed status”), and the button is
  // only offered when it actually proposes a change. The editor writes the text
  // into the form field (the record the sheet prints from) and never blanks a
  // field the proposal is empty for.
  onApplyFindings,
  // Same rule for the formalised ACTION TAKEN / STATUS line.
  onApplyActionTaken,
  // Optional completeness gate owned by the editor (Reports.jsx): when it
  // returns false, generation is refused BEFORE any request — the editor has
  // already flagged "The report has N problems" with jump-to-field links.
  onBeforeGenerate,
  // Phase 7 — the account read. Handed over by the SHEET format only, and run
  // on Generate before the gate and before anything is saved: it fills the
  // blank fields (the incident type, the date and the place among them) out of
  // the officer's own words, so a report written on a blank page can be created
  // at all. Takes the account text, returns the receipt the officer is shown —
  // { ok, filled, unstated, residual, stillNeeded, detailsFailed } or
  // { ok: false, message } — and never throws, because a failed read is not a
  // failed generate. `stillNeeded` is the RULE ENGINE's answer (the type fields
  // this report still has to carry), not the model's; `detailsFailed` says the
  // second read did not answer, so an empty type block is never mistaken for a
  // model that found nothing.
  onReadAccount,
  // The way OUT of a refusal that is about the REPORT and not about the
  // request. The sheet format keeps the report's own fields behind its reveal
  // control, so a message that names them ("it still needs an incident type, a
  // date and a place") has to carry the control that opens them — otherwise the
  // officer is told to go and fill in fields they cannot see, which is how a
  // refused press turns into "nothing happened". Undefined in the formats where
  // those fields are already on screen.
  onRevealFields,
  // D3 (Phase 6 Stage 1) — the reason Generate and Tighten are unavailable for
  // a narrative that is not in English, or null when they are. The EDITOR owns
  // the wording (src/lib/reportLanguages.js), so the panel, the finalize bar
  // and the printed sheet state the same fact in the same words rather than
  // three paraphrases drifting apart.
  languageBlocked = null,
  // Phase 6 Stage 2 — the report's declared narrative language, so the
  // terminology lookup opens on the language the officer is writing in when
  // it is one the table covers. Never changes the narrative; a default only.
  narrativeLanguage = 'en',
  // TASK 9 — the bondpaper, typed into IN THIS CARD. The editor hands over
  // everything the sheet needs to draw the letter for the report on screen
  // ({ report, ts, stationHeader }), and a generated draft then
  // TYPES ITSELF INTO THE LETTER inside this panel: the static chrome (header,
  // date, title, certification boilerplate, every bold label) is on screen from
  // the first frame and only the AI's own values are revealed, one character
  // cursor walked across them top to bottom. The letter is here rather than in
  // the narrative panel because THIS is where the officer pressed Generate —
  // the words arrive where they are looked for, and the Accept / Regenerate /
  // Close gate opens underneath once they have landed. The panel plays no
  // reveal of its own and shows no plain boxes while the sheet is up, and
  // nothing is written into the report until Accept. Absent → the panel keeps
  // its original inline reveal, unchanged.
  sheet = null,
}) {
  const [mode, setMode] = useState('idle'); // idle|ready|loading|done|error|manual
  const [draft, setDraft] = useState(null); // { narrative, suggestions, possibleGaps, addedContentWarnings, gloss, sourceGloss, ambiguities, pinnedTerms }
  // Phase 6 Stage 5 (Track C) — the guided flow's current step, or null when
  // no guided flow is running. Every move goes through moveGuided().
  const [guided, setGuided] = useState(GUIDED_IDLE);
  // Phase 6 Stage 3 — the source text captured at generate time so Apply can
  // state and store it.
  //
  // THE ACCOUNT IS THE REPORT. The rough-notes box is gone: what the AI works
  // from is the account the officer has already written into the report — the
  // narrative above all, and the fields around it. The box was a SECOND place
  // to write the same incident, and it was the one control that had to be
  // filled in BEFORE any AI work existed — which read as the assistant asking
  // for homework instead of writing from the form the officer just completed.
  //
  // What went with it is the declared notes LANGUAGE, and that is the older
  // removal (Phase 6 Stage 3): the box carried a selector whose value the
  // officer asserted and nothing could check, so a stale or wrong one silently
  // turned a translation into a grammar fix of native text. The narrative's
  // language is DETECTED from the text, which is why an account written in
  // Bisaya or Tagalog goes in through the narrative — "Translate my
  // narrative" — and nowhere else.
  const [lastSource, setLastSource] = useState(null); // { kind, text, language }
  // Phase 7 — what the last account read changed, for the one-line receipt.
  const [fillNote, setFillNote] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [message, setMessage] = useState(null);
  // What "Try again" repeats: `{ kind: 'generate' | 'tighten', feedback? }`,
  // set at the top of each entry point so a failed generate retries a generate
  // and a failed tighten retries a tighten — the two are not interchangeable
  // (one writes the officer's report, the other edits their own text), and a
  // retry control that guessed would be worse than none. An INTENT rather than
  // a captured closure: the repeat must read the narrative as it is NOW, not as
  // it was when the first press failed. A GUIDED press sets nothing — its step
  // is refused once the flow has ended, so the honest retry there is the guided
  // button itself.
  const [lastPress, setLastPress] = useState(null);
  const [residual, setResidual] = useState([]);
  // Whether the draft body is SHOWING in the assistant's card. It is inline
  // chrome, not a window: hiding it keeps the draft (which lives in this tab,
  // keyed by report id) and "A draft is ready" is the way back in.
  const [panelOpen, setPanelOpen] = useState(false);
  // TASK 9 — the draft being typed into the bondpaper in this card. Its values
  // are read from the LIVE draft rather than kept beside it (see `sheetPending`
  // below), so a correction the officer makes in the boxes under the page is what
  // the page above shows a moment later: one source, and the two can never
  // disagree about what is being reviewed. Nothing here is sent to the API.
  //
  // A DRAFT UNDER REVIEW IS A PAGE. The letter is drawn whenever this card holds
  // a draft — freshly generated, restored in this tab after a reload, or being
  // corrected in its boxes — rather than for as long as one particular request
  // is remembered, which is how the officer's own draft could leave the AI
  // assistance field while they were still reading it. `sheet` is the host's own
  // payload (the report, the letterhead, the recording officer): without it
  // there is no page to draw at all.
  const sheeted = !!draft && !!sheet;
  // Whether the officer has asked for the draft's own editable boxes ALONGSIDE
  // the letter. "Edit the draft" used to put the page away and show the boxes
  // instead; the page is the draft's, so the boxes are added UNDER it. Reset
  // when a new draft arrives: the next page is read before it is corrected.
  const [boxesOpen, setBoxesOpen] = useState(false);
  // False while the sheet is still typing. The gate stays closed until it is
  // true, so Accept can only be pressed on text the officer has watched land.
  const [sheetTyped, setSheetTyped] = useState(true);
  // The card the typing happens in. Scrolled to when a new draft starts arriving
  // (this card's own Regenerate included), so the officer is never looking at the
  // wrong end of the page while the letter types.
  const sheetCardRef = useRef(null);
  // The grey viewport the letter sits in. Task 10 gives that frame a fixed,
  // fit-to-screen height so only the DOCUMENT scrolls, which means the values
  // below its fold can no longer type themselves into view by themselves.
  const sheetViewportRef = useRef(null);
  // WHETHER THE PAGE IS UP ON A SCREEN OF ITS OWN (the Preview control above
  // the card's paper). The same leaf, portaled to document.body, with the app
  // behind the scrim and nothing on the screen but the report: no card, no
  // review controls, no Print. It shows the DRAFT the card is showing — the
  // page the officer asked to enlarge — and it writes nothing, so closing it
  // (✕, Escape, or a click on the desk around the paper) leaves the report and
  // the draft exactly as they were.
  const [sheetFull, setSheetFull] = useState(false);
  // HOW BIG THE FULL-SCREEN PAGE IS DRAWN. The screen is the one of the two
  // frames with size controls (owner request, 2026-10-05 — the card's steppers
  // are gone and its page is drawn at a fixed 50%, see the stylesheet), so this
  // is the only zoom state there is. It STARTS at FIT — the whole leaf, so the
  // screen opens as an overview of the page — and returns to FIT every time it
  // is opened, because it is a fresh look at the document rather than a
  // continuation of whatever the officer last did to it.
  const [screenZoom, setScreenZoom] = useState(FIT);
  // The desk that screen holds the paper on, and the zoom in force there: the
  // whole leaf fitted to the screen at the largest scale it can take, never
  // past its own size.
  const sheetFullRef = useRef(null);
  const fullZoom = useRef(0.62);

  // TASK 10 — keep the typing in view. ReportSheetBody reports how much of the
  // sequence has landed and the frame is moved to match, so the page is written
  // in front of the officer from the top down instead of filling in a viewport
  // that is half a screen short of where the words are. Done with the ref and
  // nothing else: a 16ms tick therefore costs no re-render. The typed slots are
  // all in the letter's middle (the chrome above and the signature block below
  // never type), so the travel is scaled rather than run edge to edge — the last
  // value is reached with the end of the draft still on screen.
  const followTyping = (fraction) => {
    const el = sheetViewportRef.current;
    if (!el) return;
    const travel = el.scrollHeight - el.clientHeight;
    if (travel <= 0) return; // the whole page already fits
    el.scrollTop = Math.min(1, Math.max(0, fraction)) * travel * 0.75;
  };
  const draftRef = useRef(null);
  draftRef.current = draft;
  const lastPayloadRef = useRef(null); // for regenerate

  // Reveal state (NarrativeReveal-based): revealOn is true ONLY for a draft
  // produced by THIS session's generate — a draft restored from
  // sessionStorage is old news and renders statically, no replay.
  // genCounter is the resetKey: per-GENERATION (not per-report), so every
  // Regenerate cleanly remounts the reveal with no stale animation.
  const [revealOn, setRevealOn] = useState(false);
  const [genCounter, setGenCounter] = useState(0);
  // WHICH PART IS TYPING RIGHT NOW (see REVEAL_STAGES). One piece of state for
  // the whole sequence rather than a flag per block: each reveal's completion
  // moves it on, so "what is animating" and "what still has to be waited for"
  // can never disagree. 'done' means the draft has fully arrived.
  const [revealStage, setRevealStage] = useState('done');
  // The editable draft (see the draft textarea below) grows to its own content
  // rather than scrolling inside itself: the panel BODY is the one scroll, which
  // is the promise .ai-draft makes, and a draft the officer is reading must not
  // be a window with a scrollbar of its own. Re-measured whenever the text
  // changes — including while they type in it.
  const draftEditRef = useRef(null);
  useEffect(() => {
    const el = draftEditRef.current;
    if (!el) return;
    // `auto` first: without it the box can only ever grow, never shrink.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft?.narrative, revealStage]);
  // "Thinking" status phases (addendum): 'waiting' = Phase A rotation
  // during the real network wait; 'verifying' = Phase B (the REAL server-
  // side safety gate result, held ~600ms for legibility).
  const [thinkPhase, setThinkPhase] = useState('waiting');
  const status = useRotatingStatus(THINKING_PHRASES, { active: mode === 'loading' && thinkPhase === 'waiting' });

  // Health check on mount: if AI is disabled/unconfigured, hide Generate.
  useEffect(() => {
    let alive = true;
    api('/ai/health')
      .then((d) => {
        if (!alive) return;
        // Functionally guarded: the probe resolves AFTER the restore effect,
        // so an unconditional set would overwrite 'done' and silently hide a
        // draft restored from sessionStorage (and could cut a generation
        // short mid-'loading'). Only settle an as-yet-undecided panel.
        setMode((m) => (m === 'done' || m === 'loading' ? m : d.enabled ? 'ready' : 'manual'));
      })
      .catch(() => alive && setMode((m) => (m === 'done' || m === 'loading' ? m : 'manual')));
    return () => {
      alive = false;
    };
  }, []);

  // Restore a draft generated earlier in this tab for THIS report (e.g.
  // after the page reloaded while the officer was on another tab).
  useEffect(() => {
    const stored = loadStoredDraft(reportId);
    if (stored) {
      setDraft(stored);
      setResidual(stored.residualRisk ?? []);
      // The page comes back with it, because the page IS the draft (see
      // `sheeted`) — a reload is not the thing that takes the officer's letter
      // out of the assistance field. It arrives whole rather than typing itself
      // out a second time: `sheetTyped` stays true and `revealPending` keeps the
      // sheet from replaying the sequence (see the render below).
      setMode('done');
      setPanelOpen(true);
    }
  }, [reportId]);

  // Single source of truth for whether the draft body is actually VISIBLE.
  // Content exists while loading, on error, or when there is a draft to show:
  // an inline box with nothing inside it is the one thing this must not draw,
  // so the renderer's own guard below reads this and nothing else.
  const panelHasContent = mode === 'loading' || mode === 'error' || (mode === 'done' && !!draft);

  // WHICH pass is running, for the loading state's own wording. `lastPress`
  // remembers the officer's press; the guided flow does not set it, so a
  // running guided step reads as a tighten. Falls back to generate, which is
  // the panel's default press.
  const runningKind =
    lastPress?.kind === 'tighten' || !guidedIsTerminal(guided) ? 'tighten' : 'generate';

  // Keep the session store in sync with the current draft; clear it when
  // the draft is discarded (null).
  useEffect(() => {
    try {
      if (draft && reportId != null) {
        window.sessionStorage.setItem(draftStoreKey(reportId), JSON.stringify(draft));
      } else {
        window.sessionStorage.removeItem(draftStoreKey(reportId));
      }
    } catch {
      // Storage full/blocked — persistence is best-effort only.
    }
  }, [draft, reportId]);

  // TASK 9 — every draft types into THIS card, because this is where Generate
  // is pressed. When a new proposal starts (this card's own Regenerate included)
  // the card is brought into view if it is off screen, and the page is left
  // exactly where it is when the officer is already looking at it — which is the
  // whole point of typing the letter here instead of in the narrative panel the
  // officer would have to scroll up to.
  // HOW BIG THE LETTER IS IN THE CARD — ONE FIXED SIZE, NO CONTROLS.
  //
  // The page used to be measured to fit the whole leaf inside whatever room the
  // card had, with steppers beside it. It is drawn at a FLAT 50% instead (owner
  // request, 2026-10-05): one size in every format and every window, so the
  // page reads the same wherever the assistant sits, and the control the card
  // does keep — Preview — is the one that answers "too small to read".
  //
  // Nothing here measures it any more: the size is `zoom: 0.5` on the card's
  // paper in styles.css, and the frame simply SCROLLS both ways, because a page
  // at a fixed size can be wider or taller than the column it is drawn in. A
  // ResizeObserver that re-fitted the page to the card would fight that rule.
  // `followTyping` below still keeps the typing in view, and it is still the
  // only thing that moves this frame on its own.

  // HOW BIG THE PAGE IS ON THE FULL SCREEN — THE WHOLE LEAF, MEASURED.
  //
  // The page is drawn at 100% of its own size and scaled by ONE measured
  // factor: the SMALLER of "the screen is this wide" and "the screen is this
  // tall", against 8.5 × 11in of paper, capped at 1 so a preview enlarges
  // nothing. `object-fit` cannot do that for a live element and CSS cannot
  // divide one length by another, so the factor is measured here and handed to
  // the stylesheet as one custom property — see `.sheet-fullscreen-desk
  // .print-sheet` in styles.css. A letter that runs past its leaf shrinks the
  // factor rather than being clipped: whatever paper the report needs, the
  // whole sheet is on the screen, and only a letter past even the floor has a
  // tail to scroll to.
  //
  // The natural height is read back through the zoom in force (`zoom` scales
  // the rect the DOM reports), and the measure re-runs when the screen is
  // resized AND when the PAGE grows — the reveal adds a line at a time.
  useEffect(() => {
    const el = sheetFullRef.current;
    if (!el || !sheetFull || typeof ResizeObserver !== 'function') return;
    // The officer's own size stands the fit down (the effect below owns the
    // property while a stop is in force): this is the same page, drawn at the
    // size they asked for instead of the size the screen can hold.
    if (screenZoom !== FIT) return;
    const sizeLeaf = () => {
      const cs = window.getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const availW = el.clientWidth - padX;
      const availH = el.clientHeight - padY;
      if (!(availW > 0) || !(availH > 0)) return;
      const page = el.firstElementChild;
      const naturalH = page
        ? Math.max(SHEET_PX.height, Math.round(page.getBoundingClientRect().height / fullZoom.current))
        : SHEET_PX.height;
      const byWidth = availW / SHEET_PX.width;
      const byHeight = availH / naturalH;
      const next = Math.max(0.3, Math.min(1, byWidth, byHeight)).toFixed(4);
      fullZoom.current = Number(next);
      if (el.style.getPropertyValue('--sheet-full-zoom') !== next) {
        el.style.setProperty('--sheet-full-zoom', next);
      }
    };
    sizeLeaf();
    const ro = new ResizeObserver(sizeLeaf);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [sheetFull, screenZoom]);

  // The same single property, written on the full-screen frame (see the card's
  // note above): one size, one rule, and `fullZoom` kept as the size on screen.
  useEffect(() => {
    const el = sheetFullRef.current;
    if (!el || !sheetFull || screenZoom === FIT) return;
    fullZoom.current = screenZoom;
    el.style.setProperty('--sheet-full-zoom', String(screenZoom));
  }, [screenZoom, sheetFull]);

  useEffect(() => {
    const el = sheetCardRef.current;
    if (!sheeted || !el || typeof el.scrollIntoView !== 'function') return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // Already in front of them — the press came from this card. Do nothing.
    if (r.top >= 0 && r.top < vh * 0.6) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // A new draft is what brings the card into view; an edit is not.
  }, [sheeted, genCounter]);

  // Escape hides the draft body — the same thing the ✕ does, and the same key
  // that dismissed the docked panel before the draft moved inline. Kept because
  // the body is a large part of the card: the key that puts it away should not
  // depend on reaching for the corner of it.
  //
  // THE FULLSCREEN PAGE TAKES ESCAPE FIRST. It is a screen ON TOP of this card,
  // so the key has to peel that one layer and stop: one press closes the
  // preview, the next (from the card) does what it always did. A single press
  // closing both — the screen and the panel the officer was reading it from —
  // would lose their place for a keystroke they meant as "back".
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (sheetFull) {
        setSheetFull(false);
        return;
      }
      if (panelOpen) setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, sheetFull]);

  // Phase 6 Stage 3 — a non-English narrative on the form is a translatable
  // source (D3/D4), so Generate is NOT refused by language here any more.
  const nativeNarrative = narrativeLanguage !== 'en' && String(narrative || '').trim() !== '';
  // ONE source, and the form already holds it: a narrative in another language
  // is TRANSLATED (D3 — exactly one source per Apply), everything else is
  // drafted from. There is no second candidate for the officer to choose
  // between because there is no second box to write one in (see the state note
  // above): the report IS the account.
  const effectiveSource = nativeNarrative ? 'narrative' : 'notes';
  // Phase 6 Stage 5 (Track A, D4) — the language actually being translated for
  // this request. When its registry entry has translation_enabled=false, no
  // model call is made for it: the officer is told plainly and can still write
  // and file. The server enforces this too; the disable is so the officer is
  // not offered a control whose only answer would be no.
  // Only the narrative can be in another language, so it is the only source
  // this guard can fire for.
  const translationSourceLanguage = effectiveSource === 'narrative' ? narrativeLanguage : 'en';
  const translationOff = String(translationSourceLanguage) !== 'en'
    && !translationEnabled(translationSourceLanguage);

  // WHETHER TIGHTEN IS OFFERED AT ALL, which is not the same question as whether
  // a press would be accepted. It used to be drawn in every state and greyed out
  // in two of them — a control that announces itself and then refuses. An officer
  // reads "Tighten my draft", works out that it is waiting on something, and gets
  // nothing for the reading; the row also carried a dead button's width in states
  // where the only thing to do was Generate.
  //
  // So it is offered exactly when a press WOULD do something, and that is the
  // same rule the `disabled` attribute had: there is a narrative to run the
  // economy rules over, and that narrative is English. `languageBlocked` is set
  // for every non-English report (see aiBlockedReason in lib/reportLanguages.js —
  // it fires on any language that is not English), because the rules rewrite
  // prose and running them over Bisaya would rewrite it in the wrong language.
  //
  // What is NOT lost by hiding it: the ⓘ in this block's head explains BOTH
  // actions (see AI_TOOLBAR_HINT), so Tighten is still documented where it is not
  // on screen, and the guided row below covers the native-narrative path where
  // translating is the officer's first step. What IS lost, by request: the
  // discoverability of a button that cannot be pressed yet.
  const tightenUsable = !languageBlocked && String(narrative || '').trim() !== '';

  // Phase 6 Stage 5 (Track C) — every guided transition goes through the pure
  // machine, and an event the machine REFUSES is dropped rather than applied by
  // hand. The ref mirrors the state so a handler can act on the machine's
  // answer immediately (and so two moves in one tick stay consistent) instead
  // of guessing what React's next render will hold.
  const guidedRef = useRef(GUIDED_IDLE);
  guidedRef.current = guided;
  const moveGuided = (event) => {
    const next = guidedFlowReduce(guidedRef.current, event);
    if (!next.ok) return next;
    guidedRef.current = next.state;
    setGuided(next.state);
    return next;
  };

  // The id a request is addressed to. Called at the top of every entry point
  // (generate, tighten, and both through the guided flow) rather than read from
  // the prop, because the FIRST request on an unsaved report is what creates
  // the report: the prop is still null in this render, and the id only arrives
  // with the editor's next one.
  const resolveReportId = async () => {
    if (reportId != null) return reportId;
    const id = await ensureReportId?.();
    return id ?? null;
  };

  const generate = async (feedbackText = '', asGuidedStep = false, regenerate = false) => {
    if (!asGuidedStep) setLastPress({ kind: 'generate', feedback: feedbackText });
    // THE ACCOUNT — the officer's own words, read ONCE and used for both the
    // read below and the generation request further down. There is exactly one
    // place they live: the report's own narrative field. In the sheet format
    // that is the page itself (the officer types the whole incident onto it, so
    // the page IS the account); in the other formats it is the narrative the
    // officer wrote before asking the assistant for anything. Reading it in one
    // place is what keeps the read and the draft from working on different
    // text.
    const accountText = String(narrative || '');
    // Nothing written anywhere is the one precondition the AI call itself has —
    // NOT the field verification the sheet deliberately skips (see
    // ReportEditor's onBeforeGenerate). A request with no text in it would come
    // back as an invented narrative, and an officer cannot tell that from a real
    // one.
    if (accountText.trim() === '') {
      // THE EDITOR OWNS WHAT A BLOCKED PRESS LOOKS LIKE ON THE FORM, and this is
      // a blocked press like any other: the field that has nothing in it goes
      // red, the banner names it, and its link lands on it (see ReportEditor's
      // gateAiGenerate, which flags an empty narrative for exactly this press).
      // A sentence in the AI card is the wrong place for it — the officer is
      // looking at the form, and the thing to do is a field, not a paragraph.
      //
      // So ask the gate FIRST, and only speak here where there is no gate to ask:
      // the SHEET format, whose fields sit behind the reveal control and are not
      // on screen to mark (see the onBeforeGenerate prop in ReportEditor).
      if (onBeforeGenerate && !onBeforeGenerate()) {
        if (asGuidedStep) moveGuided('cancel');
        return;
      }
      setMessage('Write what happened first, in “Detailed Description of Events” — there is nothing yet for the AI to work from.');
      setMode('error');
      setPanelOpen(true);
      return;
    }

    // Phase 7 — the account read runs BEFORE the gate, and that order is the
    // whole point of it: the gate refuses an incomplete report, and on the
    // sheet's blank page the fields it is about to complain about (type, date,
    // place) are exactly the ones the read is about to fill from the officer's
    // own words. Gating first would refuse the very press that makes the report
    // completable. A read that fails changes nothing and does not stop the
    // press.
    if (onReadAccount) {
      // SAY SO FIRST. The read is a provider call of its own — a 45s timeout
      // per attempt, inside the service's own retry — and it lands BEFORE the
      // loading state below, so until it answered this press showed the officer
      // NOTHING AT ALL: the button took the click and the screen did not move.
      // That is the one failure mode this panel must not have, so the panel
      // opens with the read named for what it is (it is a read, not a draft).
      setMessage('Reading your account…');
      setThinkPhase('reading');
      setMode('loading');
      setPanelOpen(true);
      setFillNote(null);
      try {
        let receipt = await onReadAccount(accountText);
        for (let attempt = 2; receipt?.retryable && attempt <= READ_ATTEMPTS; attempt++) {
          // The receipt's `retryable` is the SERVER's own answer (it said
          // "busy", not "no"): a rejected request or a wrong key is reported on
          // the first answer, because waiting cannot fix either.
          setMessage(`The AI service is busy — trying again (${attempt} of ${READ_ATTEMPTS})…`);
          await new Promise((r) => setTimeout(r, READ_RETRY_WAIT_MS));
          receipt = await onReadAccount(accountText);
        }
        if (receipt) setFillNote(receipt);
      } catch (err) {
        // The editor promised not to throw; a reader that does anyway must not
        // take the Generate press with it.
        setFillNote({ ok: false, message: err?.message || '' });
      }
      // The read is answered (either way): whatever it found is on the receipt
      // above or in the panel's own error state, so the "reading" line must not
      // outlive it, and the press carries on in the ordinary draft phase.
      setMessage(null);
      setThinkPhase('waiting');
    }

    // Gate: a blocked generate flags the problems and never opens the loading
    // panel — exactly like a blocked finalize. The SHEET format hands over no
    // gate at all: there the account on the page IS the source, the read has
    // just filled the fields the gate would have named, and an officer writing a
    // one-page account should not be stopped short of the AI by the form's own
    // blanks. Submit still runs every rule it ever did.
    if (onBeforeGenerate && !onBeforeGenerate()) {
      if (asGuidedStep) moveGuided('cancel');
      return;
    }
    // The report the answer is filed against. A brand-new report is saved here
    // (the gate above has already proved it can be — Gate 1's three fields are
    // the first thing the Gate 2 rule set checks). The save is a second wait
    // before anything is drawn, so the same rule applies: name it.
    setMessage('Preparing the report so the AI can work on it…');
    const rid = await resolveReportId();
    if (rid == null) {
      // The save behind the id was refused, or the report still has no incident
      // type to be created with (writeDraft returns null for one). Say so HERE:
      // a Generate press that appears to do nothing is the worst version of
      // this, and on the sheet it is the case the account read did not manage
      // to name a type for — the officer picks one from the dropdown and the
      // press works.
      setMessage(
        'This report is not saved yet — it still needs an incident type, a date and a place before the AI can work on it.',
      );
      setMode('error');
      setPanelOpen(true);
      if (asGuidedStep) moveGuided('cancel');
      return;
    }
    setMode('loading');
    setThinkPhase('waiting'); // Phase A: rotating thinking phrases
    setMessage(null);
    setResidual([]);
    setPanelOpen(true); // open the draft body immediately (it shows the spinner)
    // The officer's CURRENT Notable Findings and Action Taken / Status text is
    // sent with the request, not left to the server's stored row: autosave
    // only ticks every 30s, so a note typed right before clicking Generate
    // would reach the AI as the OLD value — and the formalised draft would
    // then overwrite the note the officer just wrote. The server prefers
    // these live values when they are present.
    const sourceMeta = effectiveSource === 'narrative'
      ? { kind: 'narrative', text: String(narrative || ''), language: narrativeLanguage }
      // The English path. The server reads this source as English by
      // construction (see NarrativeController::generate) and the report's own
      // text rides the request's free-text slot, so no source pair is recorded
      // for it: there is no original text in another language to keep.
      : { kind: 'notes', text: accountText, language: 'en' };
    setLastSource(sourceMeta);
    const body = {
      // The ACCOUNT — the report's own text (see accountText above), which is
      // the server's free-text slot by this name. On the Translate-narrative
      // path the server replaces it with the narrative it is translating (see
      // NarrativeController::generate), so sending it is always correct.
      notes: accountText,
      source: effectiveSource,
      // On the Translate-narrative path the narrative IS the text to translate.
      narrative: effectiveSource === 'narrative' ? String(narrative || '') : undefined,
      feedback: feedbackText || undefined,
      // Explicit Regenerate: the server skips its short-TTL draft cache, so
      // the press can never be answered with the identical cached draft.
      regenerate: regenerate || undefined,
      action_taken: String(actionTaken || ''),
      notable_findings: String(notableFindings || ''),
    };
    lastPayloadRef.current = body;

    // The server's queued-retry model answers a transient provider error
    // with 503 + retry_in. Retrying here automatically (up to 3 tries,
    // honoring retry_in) spares the officer a bounce to manual mode; only a
    // persistent failure reaches the manual/error states.
    const MAX_TRIES = 3;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        const out = await api(`/reports/${rid}/narrative/generate`, { method: 'POST', body });
        // The response arrived AND the server's safety gate (bug-fix
        // addendum §2) already passed on this text. Phase B: hold the
        // "verifying" message for a legible beat (the check is real, just
        // fast), then hand off to the typing reveal (§3).
        setThinkPhase('verifying');
        await holdVerifyPhase();
        // The two formalised blocks are edited IN the draft (see draftDetail),
        // so the text the officer types is kept beside the narrative rather than
        // re-derived from the arrays on every keystroke — a round trip through
        // an array would silently drop the empty line they are mid-way through.
        const findingsText = (Array.isArray(out.notableFindings) ? out.notableFindings : [])
          .filter((l) => String(l).trim() !== '')
          .join('\n');
        const statusText = String(out.actionTaken || '');
        setDraft({
          ...out,
          findingsText,
          statusText,
        });
        // Track C — the translation landed: the flow is now in the REVIEW step,
        // where nothing is applied until the officer presses the guided apply
        // button. Marked before the draft paints so no frame shows the plain
        // (non-guided) accept button on a guided translation.
        if (asGuidedStep) moveGuided('translation-ok');
        setResidual(out.residualRisk ?? []);
        // GENERATION WRITES NOTHING INTO THE REPORT. The formalised findings and
        // the disposition used to be pushed into the form's own fields the
        // moment this response landed, which meant the three parts of one draft
        // arrived by two different rules — and left the Accept button below them
        // meaning less than it said, because the fields it promised to fill were
        // already filled when the officer first saw them. A draft is a PROPOSAL:
        // all three parts wait in this panel and reach the report together, on
        // Accept (see acceptDraft). Closing the panel therefore leaves the
        // report exactly as the officer wrote it.
        // TASK 9 — with a sheet host the draft is typed INTO THE BONDPAPER, in
        // this card: the panel plays no reveal of its own and shows none of its
        // plain boxes, because the letter itself is what the officer reads. The
        // verification gate sits under it, closed until the sheet has typed the
        // last value. Without a host the original inline reveal runs exactly as
        // before.
        if (sheet) {
          // All three parts go to the bondpaper in this card as ONE proposal:
          // the panel plays no reveal of its own and shows no plain boxes (see
          // `sheeted`), and the gate opens when the sheet reports the typing
          // done. Nothing is committed here — Accept is still the only writer.
          setRevealStage('done');
          setRevealOn(false);
          setSheetTyped(false);
          setBoxesOpen(false); // the new page is read before it is corrected
        } else {
          setRevealStage('facts'); // suggestions/gaps wait for the draft to arrive
          setRevealOn(true); // play the NarrativeReveal for THIS generation
        }
        setMode('done');
        setThinkPhase('waiting'); // reset for the next generation
        setGenCounter((g) => g + 1); // new resetKey → clean remount
        // DONE — leave the retry loop. Without this the loop ran all three
        // attempts on SUCCESS too: three provider calls per click (three times
        // the latency and token cost) and the draft applied three times.
        return;
      } catch (err) {
      setThinkPhase('waiting'); // failure path: no thinking text (addendum §2)
      setRevealOn(false); // never reveal a failed response
      setRevealStage('done');
        const retryable = err.status === 503 && typeof err.retryIn === 'number';
        if (retryable && attempt < MAX_TRIES) {
          setMessage(`The AI service is busy — retrying automatically (attempt ${attempt + 1} of ${MAX_TRIES})…`);
          await new Promise((r) => setTimeout(r, Math.min((err.retryIn ?? 10) * 1000, 15000)));
          setMessage(null);
          continue;
        }
        // Track C — a failed translation ends the guided flow (the officer is
        // back where they started and can still file). It never advances to
        // the tighten step: there is no applied English text to tighten.
        if (asGuidedStep) moveGuided('translation-failed');
        if (err.status === 503 || err.manual_mode) {
          setMode('manual');
          setMessage(err.message);
        } else {
          setMode('error');
          setMessage(err.message || 'The AI request failed.');
        }
        return;
      }
    }
  };

  // Phase 5 — "Tighten this draft": the economy rules over the narrative the
  // OFFICER wrote, not over a generated one. Two things differ from generate:
  // there is no completeness gate (a half-written report is exactly when
  // tightening the prose helps), and NOTHING is applied when it lands — this
  // call edits the officer's own words, so the merged findings and trimmed
  // status come back as proposals with their own buttons.
  // `overrideText` is the guided flow's second step: it tightens the English
  // text the officer just applied, which may not be in the `narrative` prop yet
  // in this render. `opts.guided` skips the languageBlocked refusal for exactly
  // that case — the text handed to the economy engine is the English
  // translation, so the Stage 1 rule (never run the engine on native text) is
  // kept, and the SERVER still enforces it against the saved record.
  const tighten = async (overrideText = null, opts = {}) => {
    const guidedStep = opts.guided === true;
    if (!guidedStep) setLastPress({ kind: 'tighten' });
    if (!guidedStep && languageBlocked) {
      setMessage(languageBlocked);
      setMode('error');
      setPanelOpen(true);
      return;
    }
    const text = String((overrideText ?? narrative) || '').trim();
    if (!text) {
      setMessage('Write the narrative first — there is nothing to tighten yet.');
      setMode('error');
      setPanelOpen(true);
      return;
    }
    // Tighten is not gated (a half-written report is exactly when it helps), so
    // this is where an unsaved, incomplete report is caught: the save behind
    // resolveReportId is refused, and the reason is stated HERE rather than
    // leaving a click that did nothing.
    const rid = await resolveReportId();
    if (rid == null) {
      setMessage('This report is not saved yet — it still needs an incident type, a date and a place before the AI can work on it.');
      setMode('error');
      setPanelOpen(true);
      return;
    }
    setMode('loading');
    setThinkPhase('waiting');
    setMessage(null);
    setResidual([]);
    setPanelOpen(true);
    try {
      const out = await api(`/reports/${rid}/narrative/tighten`, {
        method: 'POST',
        body: {
          narrative: text,
          // The live form values, same reason as generate: autosave can be 30s
          // behind, and the merges must be computed from exactly the text the
          // officer is looking at.
          notable_findings: String(notableFindings || ''),
          action_taken: String(actionTaken || ''),
        },
      });
      setThinkPhase('verifying');
      await holdVerifyPhase();
      setDraft({ ...out, tighten: true });
      moveGuided('tighten-ok');
      setResidual(out.residualRisk ?? []);
      setMode('done');
      setThinkPhase('waiting');
      if (out.tightened === true && sheet) {
        // TASK 9 — the tightened narrative types into the letter too, and ONLY
        // the narrative: this pass rewrites the officer's own prose, so the fact
        // values stay the report's own (scope 'tighten' — see ReportSheetBody).
        setRevealStage('done');
        setRevealOn(false);
        setSheetTyped(false);
        setBoxesOpen(false); // the new page is read before it is corrected
      } else {
        // Replay the typing reveal only when the prose actually changed — an
        // untouched copy animating itself would claim work it did not do. No
        // stage is set for an unchanged copy: nothing is animating, so the
        // sequence is already over. A tighten result has no findings or status
        // blocks either, so its one reveal ends the sequence on its own.
        setRevealOn(out.tightened === true);
        setRevealStage(out.tightened === true ? 'facts' : 'done');
      }
      setGenCounter((g) => g + 1);
    } catch (err) {
      setThinkPhase('waiting');
      setRevealOn(false);
      setRevealStage('done');
      // Track C — a failed tighten step ends the flow with the translation
      // already applied and saved: nothing is half-done, and the officer can
      // still file. (moveGuided is a no-op for a plain, non-guided tighten.)
      moveGuided('tighten-failed');
      if (err.status === 503 || err.manual_mode) {
        setMode('manual');
        setMessage(err.message);
      } else {
        setMode('error');
        setMessage(err.message || 'The draft could not be tightened.');
      }
    }
  };

  // ---- Track C — the guided "Translate & tighten" flow --------------------
  // startGuided() starts step 1 (the translation). The officer then reads the
  // English draft and both glosses in the review state; applyTranslation() is
  // the officer's apply, and it applies AND saves the text. Only after that
  // does tighten() run — over the applied English — and its result is a
  // proposal with its own accept button, exactly like today's Tighten.
  const startGuided = () => {
    if (translationOff || !guidedIsTerminal(guided)) return;
    if (!moveGuided('start').ok) return;
    generate('', true);
  };

  const applyTranslation = async () => {
    const meta = lastSource && lastSource.language !== 'en' ? lastSource : null;
    const text = String(draft?.narrative || '').trim();
    if (!text) return;
    // Advance only if the machine allows it; the apply is guarded by the same
    // check, so a forbidden call (e.g. from a stale handler) changes nothing.
    if (!moveGuided('apply').ok) return;
    // The WHOLE reviewed draft goes over, not the narrative alone: the two
    // blocks under the translation are part of the same reviewed response, and
    // this press is the guided flow's accept. Half a draft applied would leave
    // the record holding one part in English and two in the officer's own
    // language. Read before `setDraft(null)` — the parts come from this render.
    const parts = {
      narrative: draft.narrative,
      findingsText: draftFindingsText,
      statusText: draftStatusText,
    };
    setDraft(null);
    try {
      // The editor applies it to the form AND saves it, so the record the
      // server holds is English before the economy engine is asked to run.
      if (onApplyGuided) await onApplyGuided(parts, meta);
      else onAccept(parts, meta);
    } catch (err) {
      // The translation IS in the form (that is what the officer clicked) but
      // the save did not land, so the tighten step cannot run against an
      // English record. The flow ends; the officer can edit, save and file.
      moveGuided('cancel');
      setMode('error');
      setMessage(err.message || 'The translation was applied in the form but could not be saved, so tightening was not run. Your report is otherwise unchanged.');
      return;
    }
    await tighten(draft.narrative, { guided: true });
  };

  const acceptTightened = () => {
    if (!moveGuided('accept').ok) return;
    acceptDraft(null);
    setDraft(null);
    setMode('ready');
    closePanel();
  };

  const keepTranslation = () => {
    moveGuided('cancel');
    setDraft(null);
    setMode('ready');
    setMessage(null);
  };

  const cancelGuided = () => {
    moveGuided('cancel');
    setDraft(null);
    setMode('ready');
    setMessage(null);
  };

  // Editability is the only gate left. `reportId` used to be one too — the panel
  // was hidden until the report had been saved — which made the writing
  // assistant vanish on exactly the screen where an officer starts writing.
  // The id is resolved per request instead (resolveReportId).
  if (!canEdit) return null;

  // What a TIGHTEN result proposes for the officer's own two fields. A button
  // is offered only when the analyser's version actually differs from what is
  // in the form — a button that writes back the identical string is a no-op
  // pretending to be an action.
  const tightenDraft = draft?.tighten === true;
  const findingsProposed =
    tightenDraft
    && Array.isArray(draft.notableFindings)
    && draft.notableFindings.length > 0
    && normaliseLineSet(draft.notableFindings) !== normaliseLineSet(String(notableFindings || '').split('\n'));
  const statusProposed =
    tightenDraft
    && String(draft.actionTaken || '').trim() !== ''
    && String(draft.actionTaken || '').trim() !== String(actionTaken || '').trim();

  // THE REST OF WHAT THE DRAFT WROTE. Generate formalises THREE things — the
  // facts of the case (the narrative, shown in the labelled box above), the
  // Notable Findings, and the Action Taken / Status, which are what the record
  // saves, snapshots and prints. The panel used to show only the narrative, so
  // the other two were nowhere in the draft the officer was reviewing: it read
  // as narrative-only, and the formalised wording turned up later, in the sheet.
  // They are shown under the draft here, under the sheet's own names, so the
  // whole draft is reviewed before it is accepted.
  //
  // EDITABLE, like the narrative above them — the officer asked to be able to
  // fix the draft where they read it — and, like the narrative, the edit is
  // DRAFT-LOCAL: it lands in the box's own `findingsText` / `statusText` (see
  // generate above) and reaches the report only when Accept carries all three
  // parts over together. Keeping the text beside the draft is also what lets the
  // box hold what the officer is typing: re-deriving it from the server's array
  // on every keystroke would silently eat a blank line they are midway through.
  //
  // A TIGHTEN result is excluded: its two fields are PROPOSALS with their own
  // buttons below, and a tighten draft carries no formalised values of its own.
  const draftedFindings = !tightenDraft && Array.isArray(draft?.notableFindings)
    ? draft.notableFindings.filter((l) => String(l).trim() !== '')
    : [];
  // One line per line — the sheet prints the status the same way, so a second
  // sentence does not run into the first here any more than it does there.
  const draftedStatusLines = !tightenDraft
    ? String(draft?.actionTaken || '').split('\n').map((l) => l.trim()).filter(Boolean)
    : [];
  // What the boxes hold: the text the officer is editing when there is one, and
  // otherwise the draft as the server sent it (a draft restored from an older
  // tab's session store carries the arrays only).
  const draftFindingsText = draft && typeof draft.findingsText === 'string'
    ? draft.findingsText
    : draftedFindings.join('\n');
  const draftStatusText = draft && typeof draft.statusText === 'string'
    ? draft.statusText
    : draftedStatusLines.join('\n');
  // THE PROPOSAL THE PAGE DRAWS, read from the live draft (see `sheeted`). The
  // shape is ReportSheetBody's own: `scope: 'generate'` overlays all three parts
  // of a draft, `scope: 'tighten'` overlays the narrative alone and leaves the
  // report's two formalised fields standing — a tighten pass rewrites the
  // officer's prose, not their record. Reading it from the draft rather than
  // storing the request's own values beside it is what keeps the page and the
  // boxes under it in step: an edit made in a box is on the page by the next
  // render, and a restored draft draws its page from the same three fields the
  // boxes hold.
  const sheetPending = draft
    ? {
        narrative: draft.narrative,
        findingsText: tightenDraft ? undefined : draftFindingsText,
        statusText: tightenDraft ? undefined : draftStatusText,
        // The model's own Suspect sentence for each respondent row it wrote a
        // description for (the response's `suspectLines`). The sheet's facts
        // block draws it in place of the raw recorded values the report still
        // holds — the draft the officer is reviewing, not the record. A tighten
        // result carries none, and nothing here is ever written into the form:
        // Accept applies the narrative and the two formalised blocks only.
        suspectLines: tightenDraft ? undefined : draft.suspectLines,
        scope: tightenDraft ? 'tighten' : 'generate',
      }
    : null;
  // THE DRAFT IS WRITTEN IN FRONT OF THE OFFICER, ONE PART AT A TIME. All three
  // parts type themselves in (NarrativeReveal) in the sheet's own order — the
  // facts, then the findings, then the action taken — each handing over to the
  // next as it finishes. A part the draft has nothing for is skipped rather than
  // played empty, and a draft with neither of the two formalised blocks ends the
  // sequence when the narrative does.
  const hasFindings = !tightenDraft && draftedFindings.length > 0;
  const hasStatus = !tightenDraft && draftedStatusLines.length > 0;
  // Which part is typing, and which have already been typed in. Both read the
  // ONE stage, so a block can never be typing and finished at the same time.
  const typing = (stage) => revealOn && revealStage === stage;
  // A part is on screen from the moment its turn starts and stays afterwards.
  // With no reveal running (a draft restored from this tab's store) every part
  // is simply in — there is no sequence to be part of.
  const arrived = (stage) => !revealOn || REVEAL_STAGES.indexOf(revealStage) >= REVEAL_STAGES.indexOf(stage);
  // The part that follows one that has just finished, skipping whatever this
  // draft has nothing for — so an absent block never costs a turn.
  const stageAfter = (stage) => {
    for (const next of REVEAL_STAGES.slice(REVEAL_STAGES.indexOf(stage) + 1)) {
      if (next === 'done') return 'done';
      if (next === 'findings' && !hasFindings) continue;
      if (next === 'status' && !hasStatus) continue;
      return next;
    }
    return 'done';
  };
  // WHILE THE DRAFT IS STILL ARRIVING, THE DRAFT IS ALL THAT IS ON SCREEN. The
  // reveal replays verified text at a readable pace, and everything else this
  // panel shows about a draft — the notes, the warnings, the “no suggestions”
  // hint and the buttons — describes text the officer has not finished being
  // shown yet. A warning about the names in the narrative, for instance, is
  // worth nothing before the sentence holding them has been typed. So they all
  // wait, and `revealing` is the single condition they wait on (it is the same
  // test the suggestion lists below have always used).
  //
  // It runs until the LAST part lands, so the buttons arrive once the whole
  // draft has been read out — and Skip typing, inside whichever part is
  // playing, is the way to cut that short.
  //
  // A draft restored from this tab's store plays no reveal, so nothing waits:
  // revealOn false means `revealing` is false and the whole panel draws at once.
  // TASK 9 — a draft being TYPED INTO THE BONDPAPER in this card waits too: the
  // panel's plain boxes are suppressed (see `sheeted` below), the letter takes
  // their place, and the gate stays closed until the sheet reports that the last
  // value has landed.
  const revealing = (revealOn && revealStage !== 'done') || (sheeted && !sheetTyped);
  // The boxes are what the officer ADDS under the page, never what takes it away
  // (see `boxesOpen`). With no sheet host the boxes are the whole view, exactly
  // as they were.
  const boxesShown = !sheeted || boxesOpen;
  // Each block fades up as its own turn arrives; the sequence itself is the
  // stage machine above, so there are no animation delays to keep in step.
  const arriveClass = (base) => (revealOn ? `${base} ai-draft-arrive` : base);
  // Reaching for "Skip typing" means "show me the draft", so it ends the WHOLE
  // sequence rather than the part it is sitting in: three presses of the same
  // button would be three ways to ask for one thing. The panels below render
  // their editable boxes the moment the stage is past them, so the rest of the
  // draft is simply there.
  const skipToEnd = () => setRevealStage('done');
  // The block — hairline, hint and boxes — belongs to the FORMALISED parts, so
  // it opens with the first of them and not a moment earlier. Without this the
  // frame and its sentence would sit under the facts while the narrative was
  // still typing, which is the one thing this sequence exists to avoid.
  const detailShown = arrived('findings') || arrived('status');
  const draftDetail = !detailShown || (!hasFindings && !hasStatus) ? null : (
    <div className={arriveClass('ai-draft-detail')}>
      <p className="field-hint">
        Applied to the report with the facts above when you accept — the two
        fields then carry “Formalised by the AI — Undo”, so your own wording
        can be put back.
      </p>
      {hasFindings && arrived('findings') && (
        <div className={arriveClass('ai-draft-block')}>
          <h4>Notable findings</h4>
          {/* Its own turn, then its own editable box — exactly what happens to
              the narrative above, in the smaller type these two blocks use. */}
          {typing('findings') ? (
            <NarrativeReveal
              text={draftFindingsText}
              resetKey={`findings-${genCounter}`}
              outerDurationCapMs={SUB_REVEAL_CAP_MS}
              onComplete={() => setRevealStage(stageAfter('findings'))}
              onSkip={skipToEnd}
            />
          ) : (
            <GrowTextarea
              value={draftFindingsText}
              rows={2}
              ariaLabel="Notable findings — one per line, applied to the report when you accept"
              onChange={(text) => setDraft((d) => (d ? { ...d, findingsText: text } : d))}
            />
          )}
        </div>
      )}
      {hasStatus && arrived('status') && (
        <div className={arriveClass('ai-draft-block')}>
          <h4>Action taken / status</h4>
          {typing('status') ? (
            <NarrativeReveal
              text={draftStatusText}
              resetKey={`status-${genCounter}`}
              outerDurationCapMs={SUB_REVEAL_CAP_MS}
              onComplete={() => setRevealStage('done')}
              onSkip={skipToEnd}
            />
          ) : (
            <GrowTextarea
              value={draftStatusText}
              rows={2}
              ariaLabel="Action taken / status, applied to the report when you accept"
              onChange={(text) => setDraft((d) => (d ? { ...d, statusText: text } : d))}
            />
          )}
        </div>
      )}
    </div>
  );

  // TASK 9 — the way back from the letter to the draft's own editable boxes,
  // and the reason the letter can replace them at all. By the time this is on
  // screen the typing has finished and the draft is still only a PROPOSAL, so
  // correcting it before Accept has to stay possible — Accept is the one action
  // that writes. Nothing is discarded or re-derived: the same draft is shown in
  // the boxes it was typed from (the narrative, the formalised findings and the
  // disposition), and Regenerate brings the letter back to type the result again.
  const openDraftBoxes = () => {
    setBoxesOpen(true);
    setSheetTyped(true);
  };

  const closePanel = () => {
    setRevealOn(false); // unmounts NarrativeReveal — cancels its timer
    setRevealStage('done'); // reopened, the draft draws whole (see `revealing`)
    // TASK 9 (revised) — the letter is no longer dropped here. Closing the card
    // hides it; the DRAFT is still sitting in this panel, unwritten, and "A draft
    // is ready" is the way back to it — so the way back has to lead to the page
    // the officer was reading. Nothing reaches the report on either route.
    setSheetTyped(true);
    setPanelOpen(false);
  };

  // ACCEPT — the one action that moves a draft into the report, and it moves the
  // WHOLE draft: the facts of the case, and the two formalised blocks the
  // officer has just read (and possibly corrected in place). One draft, one
  // rule, so no part of it can reach the report by a quieter route than the
  // others — which is what the auto-apply used to give the findings and the
  // disposition, at the cost of this button meaning less than it said.
  //
  // A TIGHTEN result is the exception, and deliberately so: it rewrites the
  // officer's OWN narrative, and the two field proposals it brings have their
  // own buttons above. Accepting the wording must not smuggle them in, so only
  // the narrative is handed over — the editor applies whatever parts it is
  // given, and this object simply has no findingsText / statusText key.
  const acceptDraft = (meta) => onAccept(
    draft?.tighten
      ? { narrative: draft.narrative }
      : {
        narrative: draft.narrative,
        findingsText: draftFindingsText,
        statusText: draftStatusText,
      },
    meta,
  );

  // Phase 7 — the receipt for the account read, in one line. It states what was
  // filled and — because the endpoint's own contract is that they are reported
  // and never hidden — any name the read could not protect, and the fields the
  // officer still has to supply themselves. Silent filling of a form is not a
  // thing this system does: the fill is invisible, the RECEIPT is not.
  const fillLine = fillNote ? (
    <p className={fillNote.ok ? 'ai-fill-note' : 'ai-fill-note ai-fill-note--failed'} role="status">
      {fillNote.ok ? (
        (fillNote.filled ?? []).length > 0
          ? <><strong>Filled from your account:</strong> {fillNote.filled.join(', ')}.</>
          : <>Read your account — every field it names was already filled.</>
      ) : (
        <>Your account could not be read, so nothing was filled.{fillNote.message ? ` ${fillNote.message}` : ''}</>
      )}
      {fillNote.ok && (fillNote.unstated ?? []).length > 0 && (
        <> <span className="ai-fill-unstated">Your account does not say: {fillNote.unstated.join('; ')}.</span></>
      )}
      {fillNote.ok && (fillNote.residual ?? []).length > 0 && (
        <> <span className="ai-fill-risk">Names the read could not protect: {fillNote.residual.join(', ')}.</span></>
      )}
      {/* The SECOND read (the incident type's own block) can fail on its own
          while the first one succeeded. Saying so is what keeps an empty
          Vehicle/Item block from looking like a reading that found nothing. */}
      {fillNote.ok && fillNote.detailsFailed && (
        <> <span className="ai-fill-risk">The fields for this incident type could not be read this time — press Generate again.</span></>
      )}
      {/* The type's own fields this report still has to carry before Submit —
          asked of the RULE ENGINE, not of the model, so an empty required
          field is named here rather than discovered at Submit. */}
      {fillNote.ok && (fillNote.stillNeeded ?? []).length > 0 && (
        <> <span className="ai-fill-needed">Still needed for this report: {fillNote.stillNeeded.join(' ')}</span></>
      )}
    </p>
  ) : null;

  // The escape hatch a REPORT-side refusal needs (see onRevealFields): the
  // sheet keeps the report's own fields behind its reveal control, so the
  // message that names them carries the control that opens them — the same
  // words as the sheet's own toggle, because it is that control.
  const revealFieldsButton = onRevealFields ? (
    <button type="button" className="ai-reveal-fields" onClick={onRevealFields}>
      Show the report fields
    </button>
  ) : null;

  // Everything a refusal offers besides Dismiss: the way to the fields it is
  // about (the sheet keeps them behind its reveal control) and the way to
  // repeat the press that failed. One node, used by both error renderings, so
  // the two cannot drift into offering different ways out of the same refusal.
  const errorActions = (
    <>
      {revealFieldsButton}
      {lastPress && (
        <button
          type="button"
          className="ai-retry"
          onClick={() => (lastPress.kind === 'tighten' ? tighten() : generate(lastPress.feedback, false, true))}
        >
          Try again
        </button>
      )}
      <button type="button" onClick={() => setMode('ready')}>Dismiss</button>
    </>
  );

  // The recorded disposition the model must close the narrative with. Long
  // text is trimmed for the hint; the full text rides on the tooltip.
  const referenceText = String(actionTaken || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const findingsReference = String(notableFindings || '').replace(/\s+/g, ' ').trim().slice(0, 160);

  // THE TITLE BAR IS GONE WITH THE BOX (owner request, 2026-10-04). There is
  // no separate "AI draft" to name: the draft is drawn in the AI ASSISTANCE
  // card, which already carries that name on its own head, and the page is the
  // thing the officer reads. The bar's ✕ went with it — the review row under
  // the page carries Close, an error carries Dismiss, and Escape hides the body
  // from anywhere. THE WAIT CARRIES NOTHING: its Hide button was removed by
  // owner request (2026-10-06), so Escape is the one way out while a draft is
  // being written.

  return (
    <div className="ai-panel">
      {/* The approved-terminology lookup that used to open this panel — in every
          mode, because a dictionary for the officer must not depend on the
          model being reachable — is no longer here. The officer's dictionary is
          the editor's own panel beside the narrative (NarrativeTermsPanel),
          which is the fuller of the two: categorised, searchable, and mounted
          where the words are being written. Two copies of the same terms in one
          sidebar was one more than the sidebar needed. */}
      {mode === 'manual' && (
        <div className="alert info ai-manual-banner" role="status">
          AI assistance unavailable — manual narrative mode. {message ? `${message}` : 'Continue writing below.'}
        </div>
      )}

      {mode === 'ready' && (
        // The highlighted block the officer works in: what this is, then the two
        // things they can ask for. There is no field to fill in (see below) —
        // the report IS the input — so the block is an action bar with a name,
        // and the accent edge and tint are what make it read as the assistant's
        // own place rather than as one more row of chrome under the form (see
        // .ai-assist).
        <section className="ai-assist" aria-label="AI writing assistance">
          <AssistHead />
          {/* Phase 6 Stage 3 — the reason Tighten is off is stated where the
              control is, not only on its tooltip. Generate is NOT blocked for
              a native source: translating it is exactly what this stage adds. */}
          {languageBlocked && (
            <div className="alert info ai-language-blocked" role="status">
              {languageBlocked} You can still generate an English draft from it — use
              “Translate my narrative” below.
            </div>
          )}
          {/* D3 — exactly ONE source per Apply, and there is nothing to pick:
              the report's narrative is the source. This block used to be a
              radio pair ("My narrative" / "My notes below") because two places
              could hold an account; with the notes box gone the choice is
              unmakeable, and a one-option radiogroup is a control that asks a
              question with one answer. A native narrative says what will happen
              on the button itself ("Translate my narrative"). */}
          {nativeNarrative && (
            <p className="ai-assist-note">
              Your {languageLabel(narrativeLanguage)} narrative is the source — it will be
              translated into formal English. Tighten appears once the draft is in English,
              because the economy rules only run over English text.
            </p>
          )}
          {/* D4 — a language the system cannot translate yet says so here, in
              the approved words, and the control below is disabled. The text is
              still saved and filed exactly as written. */}
          {translationOff && (
            <div className="alert info ai-language-blocked" role="status">
              {translationDisabledNotice()}
            </div>
          )}
          {/* THE ROUGH-NOTES BOX IS GONE (by request), and what it leaves behind
              is the rule this block now states once: there is nothing to fill
              in here. The officer completes the report — the account lives in
              "Detailed Description of Events" — and presses Generate; the
              draft comes back in a box that CAN be edited (see the draft
              textarea in the panel below), which is where any rough wording
              belongs. A field that had to be filled before the assistant would
              do anything read as homework, not as help. */}
          {/* ONE row for the two things an officer can ask for: Generate
              (which writes from the report) and Tighten (which works on the
              narrative THEY wrote). It is a row rather than two buttons under two
              paragraphs because the long explanation of both is on the ⓘ marker
              in this block's head.

              Tighten is in the row only when a press would do something — no
              narrative, or a narrative that is not English, and the row is
              Generate alone (see `tightenUsable`). It used to sit here greyed
              out in those states, which is a button that announces itself and
              then refuses. */}
          {/* The assistant's face, directly above the two things it can be asked
              to do, centred in the card. Decoration with a job: it is the only
              part of this panel that says the assistant is awake and listening,
              and it is the one thing on the card that moves — which is what
              makes the wait after Generate feel answered even before the words
              arrive. The aria-hidden is inside the component, so a screen reader
              hears the panel's own copy and not this.

              THE GLOW BEHIND IT. The two sit in one stage because the aura has
              to be centred on the BALL, not on the card: the stage is the
              orb's own column (see AiOrbBackdrop.css), the backdrop is the
              absolutely positioned square in the middle of it, and the orb
              paints over the top. Both are handed the same 200, so the glow is
              the orb's own scale rather than a number that happens to fit
              today. */}
          <div className="ai-voice-stage">
            <AiOrbBackdrop size={200} />
            <AiVoiceOrb size={200} />
          </div>

          <div className="ai-toolbar">
            {/* THE PRIMARY ACTION WEARS THE SPECULAR RIM (SpecularButton.jsx, a
                vendored React Bits component). It keeps the app's own classes
                (`ai-run primary`) rather than the component's chrome: this is the
                form's primary button, and its fill, its rim, its blue lift, its
                accent halo on hover/focus and its metrics are the app's, not a
                marketing page's. The component contributes the shader canvas
                along the edge — and the radius its drawn curve has to follow,
                which is why `radius` is RUN_RADIUS (the pill's own curve) and
                not the component's default 18px: an SDF drawn on a different
                curve than the CSS border sits visibly outside it.

                `lineColor` and `baseColor` are LITERALS, and that is a
                constraint rather than a preference: ogl parses these two itself
                (Color.set) and cannot read a CSS `var()`, so the palette cannot
                reach them the way it reaches the CSS. The PLATE IS PALE now
                (see the pill in styles.css), so the two literals do different
                work than they did on navy: line is the LIGHT the plate catches
                — white, brighter than a light-blue surface — and base is the
                edge stroke under it, the same deep navy the words use, which on
                this fill reads as the outline that keeps a pale object's edge
                crisp. `textColor` IS a `var()` on purpose — it never leaves the
                stylesheet, which is also how the plate's ink follows the theme.

                `thickness` and `intensity` are bolder than the component's 1/1,
                and they were measured rather than guessed — on the navy fill
                this button used to wear, where the default line peaked at
                luminance 134 against a fill of 90 and was almost invisible.
                They are left as measured: on a pale plate the same line reads as
                gloss, which is what a light surface catching light looks like. */}
            <SpecularButton
              className="ai-run primary"
              size="md"
              radius={RUN_RADIUS}
              tintOpacity={0}
              textColor="var(--on-accent)"
              lineColor="#ffffff"
              baseColor="#0B2A5C"
              shineSize={10}
              shineFade={40}
              thickness={2}
              intensity={1.6}
              /* STILL UNDER THE POINTER (owner request, 2026-10-06): the rim
                 does not answer the mouse — `followMouse={false}` stops the
                 shine steering, and `proximity={0}` keeps it from brightening
                 as the pointer approaches, so the drawn edge rests. Focus and
                 press still respond (the app's own states, not the shader's). */
              followMouse={false}
              proximity={0}
              onClick={() => generate()}
              disabled={translationOff}
            >
              {/* THE PILL'S ONE PART: the words alone (owner request,
                  2026-10-06 — the mark and the chevron are gone, and with the
                  mark the hairline that parted them goes too). The label is
                  still the button's own text, so the accessible name is
                  unchanged. */}
              <span className="ai-run-text">
                {nativeNarrative && effectiveSource === 'narrative' ? 'Translate my narrative' : 'Generate AI draft'}
              </span>
            </SpecularButton>
            {/* Offered only when it can run — see `tightenUsable` above. There is
                no `disabled` attribute on purpose: a button that is never
                rendered unavailable has nothing to disable, and one that IS here
                is always pressable. */}
            {tightenUsable && (
              <button
                type="button"
                className="ai-tighten"
                onClick={() => tighten()}
                title="Runs the economy rules over your own narrative: repeated propositions merged, padding and closing formulas removed. Nothing is written into the report until you click."
              >
                Tighten my draft
              </button>
            )}
          </div>
          {fillLine}
          {/* Phase 6 Stage 5 (Track C) — the guided flow's ONE entry point. It
              is offered only where it applies (a native narrative being
              translated) and it says plainly that this is two steps with a
              review between them (D2). Tighten is not chained onto the
              translation: the officer applies the English first. */}
          {nativeNarrative && effectiveSource === 'narrative' && (
            <div className="ai-guided-row">
              <button
                type="button"
                className="ai-guided-start"
                onClick={startGuided}
                disabled={translationOff || !guidedIsTerminal(guided)}
                title="Step 1 translates your narrative. You read it and apply it. Only then is Step 2 — tightening that English text — offered, and its result is a proposal too."
              >
                Translate &amp; tighten (2 steps — you review between them)
              </button>
              <InfoHint text={AI_GUIDED_HINT} />
            </div>
          )}
          {/* What the draft will be written against, on ONE line: each quote
              is truncated to the measure (the full text is on its tooltip via
              `title`), so two field-length quotes cost two short lines instead
              of two paragraphs — and neither can push the toolbar off screen. */}
          {(referenceText || findingsReference) && (
            <div className="ai-context">
              {referenceText && (
                <p className="ai-reference" title={referenceText}>
                  Closes with your recorded Action Taken / Status:{' '}
                  <em>“{referenceText}”</em>
                </p>
              )}
              {findingsReference && (
                <p className="ai-reference" title={findingsReference}>
                  Also formalises your Notable Findings for the sheet:{' '}
                  <em>“{findingsReference}”</em>
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {mode === 'error' && !panelOpen && (
        <div className="alert error" role="alert">
          {message}{' '}
          {errorActions}
        </div>
      )}

      {/* A DRAFT IS WAITING AND ITS BODY IS HIDDEN. Without this the card would
          be an empty box with a title on it — the state the officer lands in
          when they hide the draft to read the report underneath it (✕, or
          Escape): the draft is not gone (it lives in this tab, keyed by report
          id), so the block has to say so and offer the way back in. Same head
          as the ready state, one line, one control. */}
      {mode === 'done' && draft && !panelOpen && (
        <section className="ai-assist" aria-label="AI writing assistance">
          <AssistHead />
          <p className="ai-assist-note">
            A draft is ready — review it before accepting. Nothing is written into the
            report until you do.
          </p>
          <div className="ai-toolbar">
            <button
              type="button"
              className="ai-run primary"
              onClick={() => setPanelOpen(true)}
            >
              Open the AI draft
            </button>
          </div>
        </section>
      )}

      {/* ---- The draft, INLINE in the assistant's card --------------------
          The draft opens WHERE IT WAS ASKED FOR — under the Generate row, in
          the AI assistance card — instead of docking a second column onto the
          right edge, which squeezed the report the officer was reading it
          against.

          Never render a body with nothing inside it (the empty-box bug seen
          after reloads): it only opens when there is actual content — a draft,
          a loading state, or an error to display. */}
      {panelOpen && panelHasContent && (
        <section
          className={`ai-inline${sheeted ? ' ai-inline--sheet' : ''}`}
          ref={sheetCardRef}
          aria-label="AI narrative draft"
        >

          {/* THE PREVIEW CONTROL, ON THE PAGE IT ENLARGES (owner request,
              2026-10-05). The letter in this card is a real sheet of paper
              shrunk to fit a column; the officer who wants to read it as a
              page asks for it here, so the control and what it opens are one
              thing on screen. It is a BUTTON and not a bar with a title on it:
              the title bar was deliberately removed from this card (see
              above), and this brings back one control, not the box it used to
              sit in. Nothing is written, applied or decided by pressing it —
              it is the same page, larger.

              IT FLOATS OVER THE PAPER'S TOP-RIGHT CORNER rather than holding a
              row above the frame (owner request, 2026-10-05: "so it won't take
              so much space"). It is a sibling of the frame, not a child of it,
              for a reason the stylesheet explains: the frame is a SCROLLER, and
              a control inside a scroller rides away with a long letter. It
              covers the sheet's own top margin there — blank paper. */}
          {sheeted && (
            <div className="ai-sheet-bar">
              {/* NO SIZE CONTROLS HERE (owner request, 2026-10-05): the card's
                  page is a fixed 50%, and Preview is the control that answers
                  a page that is too small to read. The ladder lives on the
                  full-screen preview, where reading a page from across the
                  room is the thing being asked for. */}
              <button
                type="button"
                className="ai-sheet-full"
                onClick={() => {
                  // The screen opens at FIT every time: it is a fresh look at
                  // the page, and the card's own size is the card's.
                  setScreenZoom(FIT);
                  setSheetFull(true);
                }}
                title="Opens this bondpaper full screen — the report alone, with the rest of the app off the screen. Nothing is written into the report."
              >
                <SheetGlyph paths={PREVIEW_GLYPH} />
                Preview
              </button>
            </div>
          )}

          {/* TASK 9/10 — the page IN THE CARD: no viewer box, no title bar, no
              surface of its own (owner request, 2026-10-04 — the card is the
              one box). This div is the card's own area, and the page on it is
              drawn at the fixed 50% the stylesheet states; the frame scrolls
              to whatever a page that size needs, and `followTyping` keeps the
              typing in view while it runs. */}
          {sheeted && (
            <div
              // MEASURED, NOT DRESSED: it draws nothing of its own, so the
              // paper's edge stays the only box the officer sees.
              className="ai-sheet-preview"
              ref={sheetViewportRef}
            >
              <div className="print-sheet">
                <ReportSheetBody
                  report={sheet.report}
                  ts={sheet.ts}
                  stationHeader={sheet.stationHeader}
                  pending={sheetPending}
                  // A draft restored in this tab arrives WHOLE: the officer has
                  // already watched it land once, and a replay would have the
                  // panel acting out work it is only remembering.
                  revealPending={!sheetTyped}
                  // A new generation replays the typing from the top.
                  revealKey={genCounter}
                  onRevealComplete={() => setSheetTyped(true)}
                  // Task 10 — the frame follows the words (see above).
                  onProgress={followTyping}
                />
              </div>
            </div>
          )}

          {/* The body keeps the indentation it had inside the docked panel, so
              the diff of moving it inline is the wrapper and nothing else. */}
          <div className="ai-inline-body">
                {/* Phase 7 — what the read filled, above everything else: it is
                    about the REPORT, not about the draft below it. */}
                {fillLine}
                {/* Track C — the guided flow's step, always visible while the
                    officer holds a decision. The cancel control is offered in
                    the two states where a click still changes something; during
                    the working states the loading text carries the step. */}
                {(guided === 'review' || guided === 'tighten-review') && (
                  <div className="ai-guided-banner" role="status">
                    <strong>Translate &amp; tighten</strong>
                    <p className="field-hint">{guidedStepLabel(guided)}</p>
                    <button
                      type="button"
                      className="ai-guided-cancel"
                      onClick={guided === 'tighten-review' ? keepTranslation : cancelGuided}
                    >
                      {guided === 'tighten-review' ? 'Keep my translation — don\u2019t tighten' : 'Stop the guided flow'}
                    </button>
                  </div>
                )}
                {mode === 'loading' && (
                  <div className="ai-loading" role="status" aria-live="polite">
                    {/* §5: the live region announces "Generating draft"
                        ONCE (this static heading); the rotating phrase is
                        aria-hidden so per-phrase changes are never read
                        aloud. The `slow` fallback below has its OWN live
                        region because it is actionable information. */}
                    <span className="sr-only">
                      {thinkPhase === 'reading'
                        ? 'Reading your account, please wait'
                        : runningKind === 'tighten'
                          ? 'Tightening your draft, please wait'
                          : 'Generating your narrative, please wait'}
                    </span>
                    <p className="ai-loading-head">
                      {thinkPhase === 'reading'
                        ? 'Reading your account'
                        : runningKind === 'tighten'
                          ? 'Tightening your draft'
                          : 'Generating your narrative'}
                    </p>
                    {/* Skeleton prose: the shape of the draft that is about to
                        replace it, so the panel does not jump when the text
                        lands in the same box. */}
                    <div className="ai-skeleton" aria-hidden="true">
                      <span className="ai-skeleton-line" />
                      <span className="ai-skeleton-line" />
                      <span className="ai-skeleton-line ai-skeleton-line--short" />
                    </div>
                    {thinkPhase === 'reading' ? (
                      // The account read: no rotating draft phrases, because
                      // nothing is being drafted yet — the model is reading
                      // what the officer already wrote, and saying so is the
                      // whole point of this phase.
                      <p className="ai-loading-text" key="read">
                        Reading your account…
                      </p>
                    ) : thinkPhase === 'verifying' ? (
                      <p className="ai-loading-text ai-status-swap" key="verify">
                        {VERIFY_PHRASE}
                      </p>
                    ) : status.slow ? (
                      <>
                        <p className="ai-loading-text" key="slow" role="status">
                          This is taking longer than usual…
                        </p>
                        <p className="ai-loading-sub">Still working — you can keep editing the form meanwhile.</p>
                      </>
                    ) : (
                      <p className="ai-loading-text ai-status-swap" key={status.index} aria-hidden="true">
                        {status.phrase}
                      </p>
                    )}
                    {/* The think ticker: three dots under the phrase, pulsing in
                        sequence. The phrase itself only changes every 3.2s
                        (useRotatingStatus), so between swaps these are what
                        say the assistant is still going — and they say it
                        WITHOUT claiming progress, which is why it is dots and
                        not a percentage.

                        Decoration, and it stays that way: aria-hidden, because
                        the live region above announces the wait ONCE and
                        per-phrase changes must never re-announce (§5). */}
                    <div className="ai-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    {(thinkPhase === 'waiting' || thinkPhase === 'reading') && !status.slow && (
                      <p className="ai-loading-sub">This can take up to 45 seconds</p>
                    )}
                    {message && <p className="ai-loading-sub">{message}</p>}
                    {/* Track C — which guided step is running, so the two-
                        step shape is legible during the wait too. */}
                    {!guidedIsTerminal(guided) && (
                      <p className="ai-loading-sub">{guidedStepLabel(guided)}</p>
                    )}
                    <div className="ai-loading-bar" aria-hidden="true">
                      <div className="ai-loading-bar-fill" />
                    </div>
                    {/* NO WAY-OUT CONTROL DURING THE WAIT (owner request,
                        2026-10-06). A "Hide" button stood here — the last piece
                        of the title bar's furniture, its ✕ wearing a plain
                        word — and the wait now carries no control at all, so
                        the block is the heading, the skeleton, the phrase, the
                        dots and the bar.

                        WHAT CLOSES THE BODY INSTEAD IS ESCAPE, from anywhere in
                        the card (see `onKey`): the request is not cancelled by
                        hiding it, the panel is drawn IN the report it belongs
                        to rather than over it, and nothing about the form is
                        blocked while the model works. */}
                  </div>
                )}

                {mode === 'error' && (
                  <div className="alert error" role="alert">
                    {message}{' '}
                    {errorActions}
                  </div>
                )}

                {mode === 'done' && draft && (
                  <>
                    {/* TASK 10 — the promise this note makes is about the DRAFT
                        as a whole rather than about any sentence in it, so it is
                        on screen from the first frame: it is the panel's chrome,
                        and the letter animating in underneath it is the only
                        thing that arrives late. (Every other note on this panel
                        still waits for the text it describes — see
                        `revealing`.) */}
                    <p className="ai-side-note">
                      Not saved — review before accepting. It is never written
                      into the report automatically.
                    </p>
                    {/* TASK 9/10 — and where the words are arriving: while the
                        sheet is typing the draft, the panel says so and its own
                        boxes stay out of the way until the letter has finished. */}
                    {sheeted && !sheetTyped && (
                    <p className="ai-side-note" role="status">
                      Writing the draft into the bondpaper above — the AI&apos;s
                      words arrive directly in the letter&apos;s final formatting.
                      The review controls appear once it has finished.
                    </p>
                    )}

                    {/* Tighten edits the officer's OWN text, so there is no
                        auto-apply here (generate applies its own findings
                        because writing the report is its job). The server's
                        own sentence says what happened — including when the
                        wording was deliberately left alone — and the two
                        proposals for the officer's fields get their own
                        buttons. Undo is the existing aiUndo snapshot. */}
                    {!revealing && tightenDraft && (
                      <div className="ai-tighten-result">
                        <p className="field-hint">{draft.note}</p>
                        {(findingsProposed || statusProposed) && (
                          <div className="ai-actions">
                            {findingsProposed && (
                              <button
                                type="button"
                                onClick={() => onApplyFindings?.(draft.notableFindings)}
                                title="Replaces your Notable Findings with the merged lines shown below. Undo is available after applying."
                              >
                                Apply merged findings ({draft.notableFindings.length})
                              </button>
                            )}
                            {statusProposed && (
                              <button
                                type="button"
                                onClick={() => onApplyActionTaken?.(draft.actionTaken)}
                                title="Replaces your Action Taken / Status with the trimmed line — padding removed, no fact changed."
                              >
                                Apply trimmed status
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {residual.length > 0 && (
                      <div className="alert error" role="alert">
                        These names appear in your narrative but are not listed as
                        parties above and were possibly sent unmasked:{' '}
                        {residual.join(', ')}. Add them as parties and regenerate
                        if privacy is a concern.
                      </div>
                    )}

                    {/* Reveal (integration brief §2/§3): NarrativeReveal
                        replays the verified narrative; its own aria-live
                        region carries the full text to AT immediately.
                        revealOn gates the replay — restored/accepted drafts
                        show statically. Safety-gate ordering is structural:
                        the server never sends a failed draft, so the
                        reveal can only mount on verified text.

                        It is the FIRST of three turns now (see
                        REVEAL_STAGES): when it finishes, the sequence moves
                        on to the findings and then the action taken, each of
                        those replaying its own text the same way. Every part
                        therefore carries its own live region — one
                        announcement per part, in the order it is read, which
                        is the honest structure for a draft that is read in
                        three pieces. */}
                    {/* THE DRAFT, AND THE ONE PLACE IT IS EDITABLE — by request,
                        after generation rather than before it. It plays the
                        reveal while it arrives (verified text only: the server
                        never sends a failed draft), and once that has played
                        out the text becomes a textarea: the model's wording and
                        the officer's are one field, so a phrase they want
                        changed is changed HERE, on the text they are about to
                        accept, instead of being accepted first and then chased
                        in the narrative. Accept writes whatever the box holds —
                        `draft.narrative` IS the live value, never a copy kept
                        beside it (which is why the edit writes it back into the
                        draft and every apply path reads it unchanged). */}
                    {/* TASK 9 — THE AI'S WORDS TYPE THEMSELVES INTO THE BONDPAPER,
                        which is drawn at the TOP of this card: the very
                        component the print portal
                        draws, on the page it will print on, so the officer reads
                        the letter rather than a plain copy of it. Its static
                        chrome — the seals, the org block, the office code and
                        date, the POLICE REPORT title, the salutation, the
                        certification boilerplate, the quoted incident type and
                        every bold field LABEL — is on screen from the first
                        frame, and only the AI's own values are revealed, one
                        character cursor walked across them top to bottom. These
                        plain boxes are the SAME draft in its own fields, and
                        they are what "Edit the draft" adds UNDER the letter
                        (see `boxesOpen`): the page is not put away to correct
                        it, so the officer keeps sight of what an edit does to
                        the document. With no sheet host they are the whole view.
                        Nothing on the page is in the report yet, and the gate
                        below stays shut until the last value lands. */}
                    {boxesShown && (<>
                    <h4 className="ai-draft-label">Facts of the case</h4>
                    <div className="ai-draft">
                      {typing('facts') ? (
                        <NarrativeReveal
                          text={draft.narrative}
                          resetKey={genCounter}
                          onComplete={() => setRevealStage(stageAfter('facts'))}
                          onSkip={skipToEnd}
                        />
                      ) : (
                        <textarea
                          ref={draftEditRef}
                          className="ai-draft-edit"
                          value={draft.narrative}
                          onChange={(e) => setDraft((d) => (d ? { ...d, narrative: e.target.value } : d))}
                          rows={10}
                          aria-label="AI draft — edit before accepting"
                        />
                      )}
                    </div>

                    {/* What else this draft wrote, directly under the narrative
                        it belongs with (see draftDetail above). NOT gated on
                        `revealing` — unlike every other note on this panel,
                        these two blocks are part of the sequence, not a
                        comment on it: each one appears when its own turn
                        starts (the `arrived` test inside draftDetail) and
                        types itself in, so the wait here would hide the very
                        thing the sequence is playing. */}
                    {draftDetail}
                    </>)}

                    {/* AI UNDERSTANDING — the gloss pair (Phase 6 Stage 3), now
                        headed and framed as a VERIFICATION AID: a reading to
                        check before the AI draft is accepted, never an official
                        finding and never independently verified information.
                        The reading it holds is a SELF-REPORT of what the model
                        understood from the officer's OWN input, under the
                        user-input-only principle (THE GLOSS PAIR in
                        narrative_system_prompt.txt): what the record does not
                        state is left out, never guessed, and nothing here is
                        written into the report. It only appears when the source
                        was non-English, which is the only case the server
                        returns a reading for. */}
                    {!revealing && (draft.gloss || draft.sourceGloss) && (
                      <div className="ai-gloss">
                        <h4>AI Understanding — For Verification Only</h4>
                        <p className="field-hint ai-gloss-note">
                          This summary is based only on the information entered in the report.
                          Review it for accuracy before accepting the AI-generated draft.
                        </p>
                        {draft.sourceGloss && <p className="ai-gloss-native">{draft.sourceGloss}</p>}
                        {draft.gloss && <p>{draft.gloss}</p>}
                        <p className="field-hint">
                          A verification aid, not an official police finding: it restates only
                          what your report states, adds nothing that was not entered, and is not
                          written into the report.
                        </p>
                      </div>
                    )}
                    {!revealing && (draft.ambiguities?.length ?? 0) > 0 && (
                      <div className="alert info">
                        <h4>Unclear or least-committal ({draft.ambiguities.length})</h4>
                        <ul>
                          {draft.ambiguities.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                    )}
                    {/* Computed by the APP (deterministic matching), not the
                        model — the approved terms that shaped this draft. */}
                    {!revealing && (draft.pinnedTerms?.length ?? 0) > 0 && (
                      <div className="ai-pinned">
                        <h4>Approved terms applied</h4>
                        <ul>
                          {draft.pinnedTerms.map((t, i) => (
                            <li key={i}>{t.term} → <strong>{t.english}</strong> ({t.language})</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Tighten only, and deterministic (server side): the
                        numbers, times, dates and placeholders the rewrite
                        dropped. A "make it shorter" pass can lose a fact
                        without ever looking wrong, so the check is named next
                        to the button that would write the rewrite into the
                        record. It advises rather than blocks — this panel is a
                        review surface and the officer is the reviewer. */}
                    {/* D2 — say plainly what Apply will store, in the words the
                        plan approved, before the button is pressed. */}
                    {!revealing && lastSource && lastSource.language !== 'en' && !tightenDraft && (
                      <p className="alert info ai-apply-note" role="status">
                        Applying this replaces your narrative with the English text. Your original{' '}
                        {languageLabel(lastSource.language)}{' '}
                        text will be kept as this report's source, and the report will be marked as written in English.
                      </p>
                    )}
                    {!revealing && tightenDraft && (draft.factLoss?.length ?? 0) > 0 && (
                      <div className="alert error" role="alert">
                        The rewrite no longer states:{' '}
                        <strong>{draft.factLoss.join(', ')}</strong>. Tightening
                        removes wording, never facts — run it again, or fix the
                        text yourself before accepting.
                      </div>
                    )}

                    {/* The controls wait as well: nothing here can sensibly be
                        pressed on text that has not finished arriving. */}
                    {!revealing && (
                    <div className="ai-actions">
                      {guided === 'review' ? (
                        /* Track C, step 1 — the REVIEW state. The only forward
                           control is the one that applies the text the officer
                           has just read; nothing here reaches the tighten step
                           without it, so the review cannot be skipped. */
                        <>
                          <button
                            type="button"
                            className="primary"
                            onClick={applyTranslation}
                            title="Applies this English text to the report (keeping your original as its source) and saves it. The tighten step is offered only after this."
                          >
                            Use this translation — continue to tighten
                          </button>
                          <button type="button" onClick={() => setShowFeedback((v) => !v)}>Regenerate…</button>
                          <button type="button" onClick={cancelGuided}>Cancel</button>
                        </>
                      ) : guided === 'tighten-review' ? (
                        /* Track C, step 2 — a proposal, exactly like today's
                           Tighten: it is never applied without this click. */
                        <>
                          <button
                            type="button"
                            className="primary"
                            onClick={acceptTightened}
                            disabled={!draft.tightened}
                            title={!draft.tightened ? 'Your wording was not changed, so there is nothing to accept.' : undefined}
                          >
                            Accept tightened text
                          </button>
                          <button type="button" onClick={() => tighten(draft.narrative, { guided: true })}>Tighten again</button>
                          <button type="button" onClick={keepTranslation}>Keep my translation — don&apos;t tighten</button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="primary"
                            onClick={() => {
                              // Phase 6 Stage 3 (D2) — a translated draft carries the
                              // source with it, so Apply can store the officer's
                              // verbatim words and mark the report English.
                              const meta = lastSource && lastSource.language !== 'en' ? lastSource : null;
                              acceptDraft(meta);
                              setDraft(null);
                              setMode('ready');
                              closePanel();
                            }}
                            disabled={tightenDraft && !draft.tightened}
                            title={tightenDraft && !draft.tightened ? 'Your wording was not changed, so there is nothing to accept.' : undefined}
                          >
                            {/* The label says what THIS draft will write, which is
                                not the same thing on both results. A generated
                                draft carries all three parts and Accept gives
                                the report all three; a tighten draft rewrites
                                the narrative only — its two field proposals
                                have their own buttons above — so promising the
                                report there would be the same over-claim this
                                button used to make in the other direction. */}
                            {tightenDraft ? 'Accept into narrative' : 'Accept into report'}
                          </button>
                          {/* TASK 9 — the letter is what the officer REVIEWS; this
                              is what they correct it FROM. The words typed into
                              the bondpaper above are the same draft, so the boxes
                              behind this button hold it verbatim — nothing is
                              re-derived from the page, and no keystroke here is
                              written into the report until Accept. Offered in
                              both non-guided results: a generated draft and a
                              tightened one are equally the officer's to change. */}
                          {sheeted && !boxesOpen && (
                            <button
                              type="button"
                              onClick={openDraftBoxes}
                              title="Shows this draft as its three editable boxes under the page — the same text, so it can be corrected before accepting."
                            >
                              Edit the draft
                            </button>
                          )}
                          {/* Each result offers to repeat ITSELF: a generated draft
                              regenerates from the report, a tightened draft is
                              tightened again. Offering "Regenerate" on a tighten
                              result would swap the officer's own prose for an
                              AI-written one under a button they did not mean to
                              press. */}
                          {tightenDraft ? (
                            <button type="button" onClick={() => tighten()}>Tighten again</button>
                          ) : (
                            <button type="button" onClick={() => setShowFeedback((v) => !v)}>Regenerate…</button>
                          )}
                          <button type="button" onClick={closePanel}>Close</button>
                        </>
                      )}
                    </div>
                    )}

                    {/* Not offered in the tighten-review state: there is no
                        translation to regenerate there, and the machine refuses
                        the event, so the button could only do nothing. */}
                    {!revealing && showFeedback && guided !== 'tighten-review' && (
                      <div className="ai-feedback">
                        <input
                          type="text"
                          placeholder="Feedback, e.g. “make it more concise”"
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setShowFeedback(false);
                            // Track C — regenerating inside the guided review is
                            // still step 1, so it lands back in the review state.
                            if (guidedIsReviewing(guided)) moveGuided('regenerate');
                            generate(feedback, guidedIsReviewing(guided) || guided === 'translating', true);
                          }}
                        >
                          Regenerate
                        </button>
                      </div>
                    )}

                    {/* §4/§5: lists appear once the reveal is done (naturally
                        OR via skip — both paths fire the same onComplete) with
                        a simple fade, no char reveal. The wait is `revealing`
                        above, the same condition every other review note on
                        this panel waits on. */}
                    {!revealing && (draft.suggestions.length > 0 || draft.possibleGaps.length > 0 || (draft.addedContentWarnings?.length ?? 0) > 0 || (draft.redundancy?.length ?? 0) > 0 || (draft.narrativeRepetition?.length ?? 0) > 0) && (
                      <div className="ai-advice ai-advice-fade">
                        {draft.suggestions.length > 0 && (
                          <>
                            <h4>Writing suggestions</h4>
                            <ul>
                              {draft.suggestions.map((s, i) => (
                                <li key={i}>
                                  <span className={`badge ${s.type === 'terminology' ? 'submitted' : 'draft'}`}>{s.type}</span>{' '}
                                  “{s.text}” → <strong>{s.suggestion}</strong>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {draft.possibleGaps.length > 0 && (
                          <>
                            <h4>Possible gaps (advisory)</h4>
                            <ul>
                              {draft.possibleGaps.map((g, i) => (
                                <li key={i} className={g.severity === 'warning' ? 'gap-warning' : 'gap-info'}>
                                  {g.description}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {/* Details the draft deliberately left out because
                            the officer's record does not state them. Shown
                            here only — never written into the report. */}
                        {(draft.addedContentWarnings?.length ?? 0) > 0 && (
                          <>
                            <h4>Not added — no source in your record (advisory)</h4>
                            <ul>
                              {draft.addedContentWarnings.map((w, i) => (
                                <li key={i} className="gap-info">
                                  {w}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {/* Phase 5 — the economy pass. The findings field is
                            replaced wholesale by this response, so a line
                            merged away or dropped has to be VISIBLE here: it
                            was in the officer's own record, and a silent
                            removal would be an edit they never agreed to.
                            The kept text is shown beside it, so "merged"
                            names what it merged INTO, not just that
                            something went. Undo is the existing findings
                            undo (aiUndo), which this panel does not own. */}
                        {(draft.redundancy?.length ?? 0) > 0 && (
                          <>
                            <h4>Merged or dropped as repeated (advisory)</h4>
                            <ul>
                              {draft.redundancy.map((r, i) => (
                                <li key={i} className="gap-info">
                                  <strong>{REDUNDANCY_LABEL[r.kind] ?? 'Adjusted as repeated'}:</strong>{' '}
                                  “{r.line}”
                                  {r.kept ? <> → “{r.kept}”</> : null}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {/* Only reachable when the one repair pass did not run
                            or did not clear the repetition — the pass is
                            bounded, and the officer decides what to do next. */}
                        {(draft.narrativeRepetition?.length ?? 0) > 0 && (
                          <>
                            <h4>The narrative still says this twice (advisory)</h4>
                            <ul>
                              {draft.narrativeRepetition.map((f, i) => (
                                <li key={i} className="gap-info">
                                  “{f.sentence}” repeats “{f.repeated}”
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {draft.narrativeRepaired && (
                          <p className="field-hint">
                            Rewritten once to remove repeated wording. Review the wording as
                            usual — every fact still traces back to your record.
                          </p>
                        )}
                      </div>
                    )}
                    {!revealing && draft.suggestions.length === 0 && draft.possibleGaps.length === 0 && (draft.addedContentWarnings?.length ?? 0) === 0 && (draft.redundancy?.length ?? 0) === 0 && (draft.narrativeRepetition?.length ?? 0) === 0 && !draft.narrativeRepaired && (
                      <p className="field-hint">No suggestions or gaps detected for this draft.</p>
                    )}

                  </>
                )}
          </div>
        </section>
      )}

      {/* ---- THE REPORT, ON THE SCREEN ALONE -----------------------------
          The Preview control above the card's paper opens THIS. It is the same
          sheet the card draws — the very same component (ReportSheetBody), the
          same letterhead, the same draft — so the page read here and the page
          accepted in the card cannot drift. What changes is what is AROUND it:
          nothing. The scrim is the print portal's own `--overlay-deep`, the
          app is simply behind it, and the only control on the screen is the
          way out.

          Portaled to document.body: a fixed overlay nested in the card would
          still be the card's descendant on the screen — clipped by whatever
          ancestor happens to carry an overflow, and scrolling with it. It has
          to leave the tree to be a screen.

          `revealPending={false}` DELIBERATELY. The inline page is where the
          draft TYPES itself in, and that is the card's own performance; the
          officer who asks for the page full screen is asking to READ the sheet,
          not to watch the sequence a second time in a second tree. The proposal
          itself is the same object both draw (see `sheetPending`), so what this
          screen shows is the letter the card is typing into — whole, because
          nothing here is waiting to be watched. It never calls
          onRevealComplete either: the card's own gate opens on the card's own
          typing, and a second caller would be a second thing claiming to know
          when the draft had arrived.

          It writes nothing. Closing it (✕, Escape, or a click on the desk
          around the paper) leaves the report and the draft exactly as they
          were — Accept is still the only action that moves a draft into the
          report, and it is not on this screen. */}
      {/* The click BELOW is the desk around the paper — the third way out,
          beside ✕ and Escape: the whole screen is dismissable except the
          document itself. `aria-modal` also makes it a modal to the shell's
          own shortcut listeners (see src/lib/shortcuts.js), so the letters
          that navigate the workspace cannot fire behind this page. */}
      {sheetFull && sheet && createPortal(
        <div
          className="sheet-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Bondpaper preview — the report full screen"
          onClick={() => setSheetFull(false)}
        >
          {/* The measured frame — see the `--sheet-full-zoom` effect above. It
              draws nothing of its own; the paper's edge is the only box on
              this screen. */}
          <div className="sheet-fullscreen-desk" ref={sheetFullRef}>
            {/* The paper takes the DRAFT's chrome and values from the host's
                own payload (`sheet`), the same things the card hands over
                — report, letterhead and type-specific values — so a preview can
                never be a preview of something else. A click on the paper is
                not a dismissal: the document is the one thing here that is not
                a way out. */}
            <div className="print-sheet" onClick={(e) => e.stopPropagation()}>
              <ReportSheetBody
                report={sheet.report}
                ts={sheet.ts}
                stationHeader={sheet.stationHeader}
                pending={sheetPending}
                revealPending={false}
              />
            </div>
          </div>
          {/* The corner: the SAME size controls the card draws (one definition)
              and the way out. Reading a page from across the room is the case
              the ladder is for, and this is the screen it is read on, so the
              steppers ride here beside the only other control. */}
          <div
            className="sheet-fullscreen-controls"
            // A click IN HERE is not a click on the desk: without this the
            // dismiss-on-the-surroundings rule would read a press of the size
            // steppers (or of the readout between them) as "leave the screen"
            // — a zoom control that closes the thing it is zooming.
            onClick={(e) => e.stopPropagation()}
          >
            <ZoomControls
              className="sheet-fullscreen-zoom"
              value={screenZoom}
              onStep={(direction) => setScreenZoom(stepZoom(fullZoom.current, direction))}
              onFit={() => setScreenZoom(FIT)}
            />
            <button
              type="button"
              className="sheet-fullscreen-close"
              onClick={() => setSheetFull(false)}
              title="Closes the preview and returns to the report. Escape does the same."
            >
              <SheetGlyph paths={CLOSE_GLYPH} />
              Close preview
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
