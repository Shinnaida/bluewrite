// Addendum — AI "thinking" status indicator (presentation layer only).
//
// Rotates a CONFIG-DRIVEN list of honest status phrases while the real
// network wait runs (Phase A), with a cross-fade between phrases and an
// outer-bound fallback when the wait runs suspiciously long. Kept separate
// from data handling, mirroring the NarrativeReveal presentation layer.
//
// Honesty rule (addendum §1): every phrase must describe something the
// pipeline genuinely does at a high level — no invented specificity.
//
// Accessibility (addendum §5): the caller keeps a single polite live
// region that announces ONCE at start and once at completion; per-phrase
// rotation is visual-only and must not re-announce. This hook therefore
// exposes the phrase via a NON-live element (the caller marks it
// aria-hidden inside the live region and keeps separate announcements).
//
// The "taking longer than usual" fallback IS actionable, so the caller
// announces it (its own aria-live element outside the rotation).
import { useEffect, useRef, useState } from 'react';

// Phase A phrases — each maps to a real part of the pipeline: the report
// fields were reviewed/masked, the prompt assembled with house-style
// instructions and terminology, and the narrative is being produced.
export const THINKING_PHRASES = [
  'Reviewing incident details…',
  'Applying report structure and formatting…',
  'Checking terminology against house style…',
  'Drafting the narrative…',
];

// §4 outer bound: past this, stop cycling confidently. Tuning note: the
// server timeout is 45s; auto-retry can legitimately extend a successful
// attempt past that, so this starts above the single-request ceiling.
const OUTER_BOUND_MS = 60_000;

/**
 * @param {string[]} phrases config-driven phrase list
 * @param {{intervalMs?: number, active?: boolean}} opts
 * @returns {{phrase: string, index: number, slow: boolean}}
 *   `slow` is true once the outer bound is exceeded — the caller then
 *   shows the "taking longer than usual" message instead of the rotation.
 */
export function useRotatingStatus(phrases, { intervalMs = 3200, active = true } = {}) {
  const [index, setIndex] = useState(0);
  const [slow, setSlow] = useState(false);
  const startedRef = useRef(0);

  useEffect(() => {
    if (!active || phrases.length === 0) {
      setIndex(0);
      setSlow(false);
      return undefined;
    }
    startedRef.current = Date.now();
    setIndex(0);
    setSlow(false);

    const rotate = setInterval(() => {
      // §4 outer bound: stop implying steady progress.
      if (Date.now() - startedRef.current >= OUTER_BOUND_MS) {
        setSlow(true);
        clearInterval(rotate);
        return;
      }
      setIndex((i) => (i + 1) % phrases.length);
    }, intervalMs);

    return () => clearInterval(rotate);
    // phrases identity is stable (module-level config); rotation depends
    // only on being active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs]);

  return {
    phrase: phrases[index] ?? '',
    index,
    slow,
  };
}

/** Phase B message — a real step (the server-side bracket-token safety
 *  gate), held on screen for a legible minimum duration (§2). */
export const VERIFY_PHRASE = 'Verifying draft before showing it to you…';
export const VERIFY_MIN_MS = 600;

/**
 * Phase B hold: resolves after the scan has run AND its message has been
 * visible at least `minMs`. The caller awaits this before starting the
 * typing reveal (§3 handoff). The scan itself is synchronous server work
 * that completed with the response — this only paces the message.
 * @returns {Promise<void>}
 */
export function holdVerifyPhase(minMs = VERIFY_MIN_MS) {
  return new Promise((resolve) => setTimeout(resolve, minMs));
}
