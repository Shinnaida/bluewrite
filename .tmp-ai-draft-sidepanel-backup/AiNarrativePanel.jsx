// BlueWrite — Phase 3 AI narrative panel (UC-006/007/008).
// Generate opens a slide-in SIDE PANEL (like a document reviewer): the AI
// draft appears beside the report instead of inline, so the officer can
// compare it against the form while the report stays fully visible.
//
// Panel behaviour mirrors the LEFT sidebar: drag the edge handle to resize,
// drag below the minimum (or click the chevron) to collapse it into a slim
// right rail, hover the rail to float it open, Ctrl+J toggles it. Actions:
// Accept (copies draft into the editable narrative), Regenerate (with
// feedback note), Close. The AI NEVER writes the report directly; generation
// is always an explicit officer action. On 503 the panel shows the
// persistent manual-mode banner and hides Generate entirely.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import NarrativeReveal from './NarrativeReveal.jsx';
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

// AI panel resize bounds — collapse below the minimum into the rail,
// mirroring the sidebar's SIDEBAR_MIN/COLLAPSE_BELOW pattern.
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

const PANEL_MIN = 320;
const PANEL_MAX = 560;
const COLLAPSE_BELOW = 280;
const RAIL_W = 44;

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

// Pushpin icon for the pin/unpin control (filled = pinned). Inline SVG so it
// inherits the button color and needs no asset pipeline.
function PinIcon({ filled }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M7 3h10l-1.5 7 3 3.5c.5.6.1 1.5-.7 1.5H6.2c-.8 0-1.2-.9-.7-1.5l3-3.5L7 3z" />
    </svg>
  );
}

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
  onAccept,
  // Phase 6 Stage 5 (Track C) — Apply for the guided flow's step 1: the editor
  // applies the translation to the form AND saves it, because the second step
  // is refused by the server while the STORED report still declares a
  // non-English narrative (that guard is deliberately not weakened). Falls back
  // to onAccept when the editor does not provide it.
  onApplyGuided,
  // Called automatically with the drafted NOTABLE FINDINGS lines as soon as
  // a draft lands — no second button: generating the report IS the action.
  // The editor writes them into the form field (the record the sheet prints
  // from); it never blanks a field the draft left empty.
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
  const [panelOpen, setPanelOpen] = useState(false); // slide-in side panel
  const draftRef = useRef(null);
  draftRef.current = draft;
  // Collapsed-right-rail state + hover-to-expand + user width (all mirroring
  // the left sidebar's behaviour).
  const [rail, setRail] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const hoverTimer = useRef(null);
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = parseInt(window.localStorage.getItem('bw-ai-panel-w') ?? '', 10);
    return Number.isFinite(v) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, v)) : null;
  });
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(panelWidth);
  widthRef.current = panelWidth;
  const lastPayloadRef = useRef(null); // for regenerate

  // Reveal state (NarrativeReveal-based): revealOn is true ONLY for a draft
  // produced by THIS session's generate — a draft restored from
  // sessionStorage is old news and renders statically, no replay.
  // genCounter is the resetKey: per-GENERATION (not per-report), so every
  // Regenerate cleanly remounts the reveal with no stale animation.
  const [revealOn, setRevealOn] = useState(false);
  const [genCounter, setGenCounter] = useState(0);
  const [revealDone, setRevealDone] = useState(false);
  const handleRevealComplete = useCallback(() => setRevealDone(true), []);
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
  }, [draft?.narrative, revealDone]);
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
      setMode('done');
      setPanelOpen(true);
    }
  }, [reportId]);

  // Single source of truth for whether the panel is actually VISIBLE: the
  // body class that reserves layout space (body.ai-panel-open → .main
  // margin-right) MUST use the same condition the renderer uses, or the
  // form stays squeezed next to an empty gap (the bug seen when the two
  // drifted apart). Panel content exists while loading, on error, or when
  // there is a draft to show.
  const panelHasContent = mode === 'loading' || mode === 'error' || (mode === 'done' && !!draft);

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

  // Docked-panel layout (Claude-sidebar style): while the panel is open in
  // full mode, publish its width so Shell's .main reserves that space via
  // margin-right and the report form compresses instead of being overlaid.
  // The rail is thin, so it stays an overlay (no compression) as before.
  useEffect(() => {
    const open = panelOpen && !rail && panelHasContent;
    document.body.classList.toggle('ai-panel-open', open);
    if (open) {
      document.body.style.setProperty('--ai-panel-w', `${panelWidth ?? 420}px`);
    }
    return () => {
      document.body.classList.remove('ai-panel-open');
    };
  }, [panelOpen, rail, panelWidth, panelHasContent]);

  // Escape closes the panel entirely; Ctrl+J toggles it (keyboard parity
  // with the sidebar's Ctrl+B): closed → open, open → close, rail → expand.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        if (!panelOpen) {
          setPanelOpen(true);
          setRail(false);
        } else if (rail) {
          setRail(false);
          setHoverOpen(false);
        } else {
          setPanelOpen(false);
        }
      } else if (e.key === 'Escape' && panelOpen) {
        setPanelOpen(false);
        setRail(false);
        setHoverOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, rail]);

  // Edge drag on the panel's LEFT border: resize; below COLLAPSE_BELOW the
  // panel collapses into the rail (same feel as the sidebar's handle).
  function startPanelDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = e.currentTarget.closest('.ai-side-panel').getBoundingClientRect().width;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const w = startW - (ev.clientX - startX); // dragging left widens
      if (w < COLLAPSE_BELOW) {
        setRail(true);
        return;
      }
      setRail(false);
      setHoverOpen(false);
      setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
      if (widthRef.current) {
        window.localStorage.setItem('bw-ai-panel-w', String(widthRef.current));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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

  const generate = async (feedbackText = '', asGuidedStep = false) => {
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
      setRail(false);
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
    setRail(false); // loading always shows the full panel
    setPanelOpen(true); // open the side panel immediately (shows the spinner)
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
        setDraft(out);
        // Track C — the translation landed: the flow is now in the REVIEW step,
        // where nothing is applied until the officer presses the guided apply
        // button. Marked before the draft paints so no frame shows the plain
        // (non-guided) accept button on a guided translation.
        if (asGuidedStep) moveGuided('translation-ok');
        setResidual(out.residualRisk ?? []);
        // Auto-apply the formalised findings to the report's own field: one
        // action (this generation) produces the whole draft, and the field —
        // never the panel — is what saves, snapshots and prints.
        const draftedFindings = Array.isArray(out.notableFindings) ? out.notableFindings : [];
        if (draftedFindings.length > 0) {
          onApplyFindings?.(draftedFindings);
        }
        const draftedDisposition = String(out.actionTaken || '').trim();
        if (draftedDisposition !== '') {
          onApplyActionTaken?.(draftedDisposition);
        }
        setRevealDone(false); // suggestions/gaps wait for the new reveal
        setMode('done');
        setThinkPhase('waiting'); // reset for the next generation
        setRevealOn(true); // play the NarrativeReveal for THIS generation
        setGenCounter((g) => g + 1); // new resetKey → clean remount
        // DONE — leave the retry loop. Without this the loop ran all three
        // attempts on SUCCESS too: three provider calls per click (three times
        // the latency and token cost) and the draft applied three times.
        return;
      } catch (err) {
        setThinkPhase('waiting'); // failure path: no thinking text (addendum §2)
        setRevealOn(false); // never reveal a failed response
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
    setRail(false);
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
      setRevealDone(false);
      setMode('done');
      setThinkPhase('waiting');
      // Replay the typing reveal only when the prose actually changed — an
      // untouched copy animating itself would claim work it did not do.
      setRevealOn(out.tightened === true);
      setGenCounter((g) => g + 1);
    } catch (err) {
      setThinkPhase('waiting');
      setRevealOn(false);
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
    setDraft(null);
    try {
      // The editor applies it to the form AND saves it, so the record the
      // server holds is English before the economy engine is asked to run.
      if (onApplyGuided) await onApplyGuided(draft.narrative, meta);
      else onAccept(draft.narrative, meta);
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
    onAccept(draft.narrative, null);
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

  const closePanel = () => {
    setRevealOn(false); // unmounts NarrativeReveal — cancels its timer
    setRevealDone(false);
    setPanelOpen(false);
    setRail(false);
    setHoverOpen(false);
  };

  const expanded = !rail || hoverOpen || mode === 'loading' || resizing;

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
          onClick={() => (lastPress.kind === 'tighten' ? tighten() : generate(lastPress.feedback))}
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
              translated into formal English. Tighten stays off until then, because the
              economy rules only run over English text.
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
              (which writes from the report) and Tighten (which works on
              the narrative THEY wrote). Sits beside Generate because it is the
              other thing an officer can ask for; disabled while that text is
              empty, because a live button that can only refuse is a dead
              click. The long explanation of both is on the ⓘ marker in this
              block's head, so this row is a toolbar rather than two buttons
              under two paragraphs. */}
          <div className="ai-toolbar">
            <button
              type="button"
              className="ai-run primary"
              onClick={() => generate()}
              disabled={translationOff}
            >
              {nativeNarrative && effectiveSource === 'narrative' ? 'Translate my narrative' : 'Generate AI draft'}
            </button>
            <button
              type="button"
              className="ai-tighten"
              onClick={() => tighten()}
              disabled={!!languageBlocked || !String(narrative || '').trim()}
              title="Runs the economy rules over your own narrative: repeated propositions merged, padding and closing formulas removed. Nothing is written into the report until you click."
            >
              Tighten my draft
            </button>
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

      {/* A DRAFT IS WAITING AND THE PANEL IS CLOSED. Without this the block
          would be an empty box with a title on it — the state the officer lands
          in when they close the panel to compare the draft against the form
          (Esc, or the ✕): the draft is not gone (it lives in this tab, keyed by
          report id), so the block has to say so and offer the way back in. Same
          head as the ready state, one line, one control.

          Ctrl+J and a click on the collapsed rail do the same thing; the button
          is here because a rail is not on screen when the panel was never
          collapsed into one. */}
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

      {/* ---- Slide-in side panel --------------------------------------
          Never render a docked panel with nothing inside (the empty-column
          bug seen after reloads): it only shows when there is actual
          content — a draft, a loading state, or an error to display. The
          SAME condition drives body.ai-panel-open, so the form never
          reserves space for an invisible panel. */}
      {panelOpen && panelHasContent && (
        <aside
            className={[
              'ai-side-panel',
              expanded ? 'open' : 'rail',
              !rail && hoverOpen ? 'hover-open' : '',
              resizing ? 'is-resizing' : '',
            ].join(' ')}
            style={{ width: `min(${expanded ? (panelWidth ?? 420) : RAIL_W}px, 92vw)` }}
            onMouseEnter={() => {
              if (rail && !resizing) {
                hoverTimer.current = window.setTimeout(() => setHoverOpen(true), 180);
              }
            }}
            onMouseLeave={() => {
              window.clearTimeout(hoverTimer.current);
              setHoverOpen(false);
            }}
            role="dialog"
            aria-label="AI narrative draft"
            title={rail && !hoverOpen ? 'Hover to expand — Ctrl+J toggles the panel' : undefined}
          >
            {/* Left-edge drag handle: resize / collapse into the rail. */}
            {!rail && (
              <div
                className="ai-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize AI panel. Drag, or use arrow keys. Drag fully left or press Ctrl+J to collapse."
                aria-valuenow={panelWidth ?? 420}
                aria-valuemin={PANEL_MIN}
                aria-valuemax={PANEL_MAX}
                tabIndex={0}
                onMouseDown={startPanelDrag}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 32 : 16;
                  let next = null;
                  if (e.key === 'ArrowLeft') next = (panelWidth ?? 420) + step;
                  if (e.key === 'ArrowRight') next = (panelWidth ?? 420) - step;
                  if (e.key === 'Home') next = PANEL_MIN;
                  if (e.key === 'End') next = PANEL_MAX;
                  if (next === null) return;
                  e.preventDefault();
                  if (next < COLLAPSE_BELOW) {
                    setRail(true);
                    return;
                  }
                  setRail(false);
                  const clamped = Math.min(PANEL_MAX, Math.max(PANEL_MIN, next));
                  setPanelWidth(clamped);
                  window.localStorage.setItem('bw-ai-panel-w', String(clamped));
                }}
                title="Drag to resize — drag fully left to collapse (Ctrl+J toggles)"
              />
            )}

            <header className="ai-side-head">
              {/* Pinned (docked): the panel pushes the form aside and stays.
                  Unpinning collapses to the rail; hover floats it open. */}
              {!rail && (
                <button
                  type="button"
                  className="ai-side-pin pinned"
                  onClick={() => { setRail(true); setHoverOpen(false); }}
                  aria-label="Unpin panel — collapse to rail"
                  title="Unpin — collapses to a rail; hover it to peek (Ctrl+J toggles)"
                >
                  <PinIcon filled />
                </button>
              )}
              {rail && expanded && (
                <button
                  type="button"
                  className="ai-side-pin"
                  onClick={() => { setRail(false); setHoverOpen(false); }}
                  aria-label="Pin panel open"
                  title="Pin open — docks the panel and compresses the form"
                >
                  <PinIcon />
                </button>
              )}
              <h3>AI draft</h3>
              {!rail && (
                <button
                  type="button"
                  className="ai-side-close"
                  onClick={closePanel}
                  aria-label="Close AI panel"
                  title="Close (Esc)"
                >
                  ✕
                </button>
              )}
            </header>

            {rail && !expanded ? (
              <button
                type="button"
                className="ai-rail-expand"
                onClick={() => { setRail(false); setHoverOpen(false); }}
                aria-label="Expand AI panel"
                title="Expand (Ctrl+J toggles)"
              >
                <span className="ai-rail-label">AI DRAFT</span>
                <span className="ai-rail-chevron">‹</span>
              </button>
            ) : (
              <div className="ai-side-body">
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
                      {thinkPhase === 'reading' ? 'Reading your account, please wait' : 'Generating draft, please wait'}
                    </span>
                    <span className="ai-spinner" aria-hidden="true" />
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
                    <p className="ai-side-note">
                      Not saved — review before accepting. It is never written
                      into the report automatically.
                    </p>

                    {/* Tighten edits the officer's OWN text, so there is no
                        auto-apply here (generate applies its own findings
                        because writing the report is its job). The server's
                        own sentence says what happened — including when the
                        wording was deliberately left alone — and the two
                        proposals for the officer's fields get their own
                        buttons. Undo is the existing aiUndo snapshot. */}
                    {tightenDraft && (
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
                        region carries the full text to AT immediately and
                        is the SINGLE completion announcement. revealOn
                        gates the replay — restored/accepted drafts show
                        statically. Safety-gate ordering is structural:
                        the server never sends a failed draft, so the
                        reveal can only mount on verified text. */}
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
                    <div className="ai-draft">
                      {revealOn && !revealDone ? (
                        <NarrativeReveal
                          text={draft.narrative}
                          resetKey={genCounter}
                          onComplete={handleRevealComplete}
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

                    {/* Phase 6 Stage 3 — the "understood as" gloss pair. A
                        SELF-REPORT for the officer to check the READING before
                        applying, never presented as verification. Shown only
                        when the source was non-English. */}
                    {(draft.gloss || draft.sourceGloss) && (
                      <div className="ai-gloss">
                        <h4>What the system understood — check this</h4>
                        {draft.sourceGloss && <p className="ai-gloss-native">{draft.sourceGloss}</p>}
                        {draft.gloss && <p>{draft.gloss}</p>}
                        <p className="field-hint">A reading to help you check the meaning — not a proof, and not written into the report.</p>
                      </div>
                    )}
                    {(draft.ambiguities?.length ?? 0) > 0 && (
                      <div className="alert info">
                        <h4>Unclear or least-committal ({draft.ambiguities.length})</h4>
                        <ul>
                          {draft.ambiguities.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                    )}
                    {/* Computed by the APP (deterministic matching), not the
                        model — the approved terms that shaped this draft. */}
                    {(draft.pinnedTerms?.length ?? 0) > 0 && (
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
                    {lastSource && lastSource.language !== 'en' && !tightenDraft && (
                      <p className="alert info ai-apply-note" role="status">
                        Applying this replaces your narrative with the English text. Your original{' '}
                        {languageLabel(lastSource.language)}{' '}
                        text will be kept as this report's source, and the report will be marked as written in English.
                      </p>
                    )}
                    {tightenDraft && (draft.factLoss?.length ?? 0) > 0 && (
                      <div className="alert error" role="alert">
                        The rewrite no longer states:{' '}
                        <strong>{draft.factLoss.join(', ')}</strong>. Tightening
                        removes wording, never facts — run it again, or fix the
                        text yourself before accepting.
                      </div>
                    )}

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
                              onAccept(draft.narrative, meta);
                              setDraft(null);
                              setMode('ready');
                              closePanel();
                            }}
                            disabled={tightenDraft && !draft.tightened}
                            title={tightenDraft && !draft.tightened ? 'Your wording was not changed, so there is nothing to accept.' : undefined}
                          >
                            Accept into narrative
                          </button>
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

                    {/* Not offered in the tighten-review state: there is no
                        translation to regenerate there, and the machine refuses
                        the event, so the button could only do nothing. */}
                    {showFeedback && guided !== 'tighten-review' && (
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
                            generate(feedback, guidedIsReviewing(guided) || guided === 'translating');
                          }}
                        >
                          Regenerate
                        </button>
                      </div>
                    )}

                    {/* §4/§5: lists appear as soon as the reveal completes
                        (naturally OR via skip — both paths fire the same
                        onComplete) with a simple fade, no char reveal. */}
                    {(revealDone || !revealOn) && (draft.suggestions.length > 0 || draft.possibleGaps.length > 0 || (draft.addedContentWarnings?.length ?? 0) > 0 || (draft.redundancy?.length ?? 0) > 0 || (draft.narrativeRepetition?.length ?? 0) > 0) && (
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
                    {draft.suggestions.length === 0 && draft.possibleGaps.length === 0 && (draft.addedContentWarnings?.length ?? 0) === 0 && (draft.redundancy?.length ?? 0) === 0 && (draft.narrativeRepetition?.length ?? 0) === 0 && !draft.narrativeRepaired && (
                      <p className="field-hint">No suggestions or gaps detected for this draft.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>
      )}
    </div>
  );
}
