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
import { useRotatingStatus, holdVerifyPhase, VERIFY_PHRASE, THINKING_PHRASES } from '../lib/useRotatingStatus.js';

// AI panel resize bounds — collapse below the minimum into the rail,
// mirroring the sidebar's SIDEBAR_MIN/COLLAPSE_BELOW pattern.
const PANEL_MIN = 320;
const PANEL_MAX = 560;
const COLLAPSE_BELOW = 280;
const RAIL_W = 44;

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

export default function AiNarrativePanel({ reportId, canEdit, narrative, onAccept }) {
  const [mode, setMode] = useState('idle'); // idle|ready|loading|done|error|manual
  const [draft, setDraft] = useState(null); // { narrative, suggestions, possibleGaps }
  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [message, setMessage] = useState(null);
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
        setMode(d.enabled ? 'ready' : 'manual');
      })
      .catch(() => alive && setMode('manual'));
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

  const generate = async (feedbackText = '') => {
    setMode('loading');
    setThinkPhase('waiting'); // Phase A: rotating thinking phrases
    setMessage(null);
    setResidual([]);
    setRail(false); // loading always shows the full panel
    setPanelOpen(true); // open the side panel immediately (shows the spinner)
    const body = { notes, feedback: feedbackText || undefined };
    lastPayloadRef.current = body;

    // The server's queued-retry model answers a transient provider error
    // with 503 + retry_in. Retrying here automatically (up to 3 tries,
    // honoring retry_in) spares the officer a bounce to manual mode; only a
    // persistent failure reaches the manual/error states.
    const MAX_TRIES = 3;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        const out = await api(`/reports/${reportId}/narrative/generate`, { method: 'POST', body });
        // The response arrived AND the server's safety gate (bug-fix
        // addendum §2) already passed on this text. Phase B: hold the
        // "verifying" message for a legible beat (the check is real, just
        // fast), then hand off to the typing reveal (§3).
        setThinkPhase('verifying');
        await holdVerifyPhase();
        setDraft(out);
        setResidual(out.residualRisk ?? []);
        setRevealDone(false); // suggestions/gaps wait for the new reveal
        setMode('done');
        setThinkPhase('waiting'); // reset for the next generation
        setRevealOn(true); // play the NarrativeReveal for THIS generation
        setGenCounter((g) => g + 1); // new resetKey → clean remount
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

  if (!reportId || !canEdit) return null;

  const closePanel = () => {
    setRevealOn(false); // unmounts NarrativeReveal — cancels its timer
    setRevealDone(false);
    setPanelOpen(false);
    setRail(false);
    setHoverOpen(false);
  };

  const expanded = !rail || hoverOpen || mode === 'loading' || resizing;

  return (
    <div className="ai-panel">
      {mode === 'manual' && (
        <div className="alert info ai-manual-banner" role="status">
          AI assistance unavailable — manual narrative mode. {message ? `${message}` : 'Continue writing below.'}
        </div>
      )}

      {mode === 'ready' && (
        <div className="ai-generate-row">
          <button type="button" className="side-new" onClick={() => generate()}>
            Generate AI draft
          </button>
          <input
            type="text"
            className="ai-notes"
            placeholder="Rough notes (optional) — the AI writes from these"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      )}

      {mode === 'error' && !panelOpen && (
        <div className="alert error" role="alert">
          {message}{' '}
          <button type="button" onClick={() => setMode('ready')}>Dismiss</button>
        </div>
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
                {mode === 'loading' && (
                  <div className="ai-loading" role="status" aria-live="polite">
                    {/* §5: the live region announces "Generating draft"
                        ONCE (this static heading); the rotating phrase is
                        aria-hidden so per-phrase changes are never read
                        aloud. The `slow` fallback below has its OWN live
                        region because it is actionable information. */}
                    <span className="sr-only">Generating draft, please wait</span>
                    <span className="ai-spinner" aria-hidden="true" />
                    {thinkPhase === 'verifying' ? (
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
                    {thinkPhase === 'waiting' && !status.slow && (
                      <p className="ai-loading-sub">This can take up to 45 seconds</p>
                    )}
                    {message && <p className="ai-loading-sub">{message}</p>}
                    <div className="ai-loading-bar" aria-hidden="true">
                      <div className="ai-loading-bar-fill" />
                    </div>
                  </div>
                )}

                {mode === 'error' && (
                  <div className="alert error" role="alert">
                    {message}{' '}
                    <button type="button" onClick={() => setMode('ready')}>Dismiss</button>
                  </div>
                )}

                {mode === 'done' && draft && (
                  <>
                    <p className="ai-side-note">
                      Not saved — review before accepting. It is never written
                      into the report automatically.
                    </p>

                    {residual.length > 0 && (
                      <div className="alert error" role="alert">
                        These names appear in your notes but are not listed as
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
                    <div className="ai-draft">
                      {revealOn ? (
                        <NarrativeReveal
                          text={draft.narrative}
                          resetKey={genCounter}
                          onComplete={handleRevealComplete}
                        />
                      ) : (
                        draft.narrative
                      )}
                    </div>

                    <div className="ai-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => { onAccept(draft.narrative); setDraft(null); setMode('ready'); closePanel(); }}
                      >
                        Accept into narrative
                      </button>
                      <button type="button" onClick={() => setShowFeedback((v) => !v)}>Regenerate…</button>
                      <button type="button" onClick={closePanel}>Close</button>
                    </div>

                    {showFeedback && (
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
                            generate(feedback);
                          }}
                        >
                          Regenerate
                        </button>
                      </div>
                    )}

                    {/* §4/§5: lists appear as soon as the reveal completes
                        (naturally OR via skip — both paths fire the same
                        onComplete) with a simple fade, no char reveal. */}
                    {(revealDone || !revealOn) && (draft.suggestions.length > 0 || draft.possibleGaps.length > 0) && (
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
                      </div>
                    )}
                    {draft.suggestions.length === 0 && draft.possibleGaps.length === 0 && (
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
