import { useState, useEffect, useCallback, useRef } from 'react';
import TextType from './TextType';
import './NarrativeReveal.css';

/**
 * One-shot reveal of an ALREADY-GENERATED narrative, using TextType purely
 * as a visual replay effect (see bluewrite-typing-reveal-addendum.md and
 * bluewrite-narrative-reveal-integration-prompt.md).
 *
 * Adaptations from the base TextType usage (which is built for looping
 * taglines, not a one-shot legal-document reveal):
 *
 *  - loop={false} + a single-item text array means TextType's delete/loop
 *    cycle never triggers — it just stops once fully typed.
 *
 *  - COMPLETION SIGNAL (integration brief §5): TextType's
 *    onSentenceComplete only fires on the DELETE path, which a one-shot
 *    loop={false} run never reaches — so we cannot rely on it to know when
 *    the reveal finished. We instead project the completion time from the
 *    same speed math TextType uses (chars × effective per-char delay,
 *    averaged over the variable-speed jitter) and fire onComplete then.
 *    The projection is also what makes click-to-skip trivial: skip just
 *    fires it early.
 *
 *  - SPEED/CAP DECISION (integration brief §3 — explicit choice):
 *    OPTION 1 is kept — natural pace for typical narratives, automatic
 *    compression only for unusually long ones. Rationale: most station
 *    narratives are ~400–900 chars; at 45ms/char that is 18–40s, which is
 *    FAR too slow to sit through, so "natural pace" here is already the
 *    compressed tier for anything realistic. The cap keeps the ceiling at
 *    ~3.5s regardless. Numbers are provisional until a look/feel pass with
 *    station personnel (integration brief §8):
 *      baseTypingSpeed   = 45ms/char  (only a sub-~78-char narrative —
 *                                       practically none — plays at this)
 *      outerDurationCapMs = 3500ms    (a 1,600-char multi-party accident
 *                                       report compresses to ~2.2ms/char,
 *                                       fast but still visibly "typing";
 *                                       floor of 8ms/char avoids strobing)
 *    If officers find even 3.5s too long in the demo, drop the cap to
 *    2000–2500 — it is a single-number change.
 *
 *  - JITTER vs CAP: variableSpeed jitter must NOT be able to override the
 *    cap compression — the jitter window is clamped to ≤ the effective
 *    per-char delay when the cap tier is active.
 *
 *  - Skip is keyboard-reachable AND not hidden from assistive tech (the
 *    original draft used role="button" + tabIndex + aria-hidden on the
 *    same element — a contradiction: hidden elements cannot be operated).
 *    Here the region is a plain clickable div (mouse) plus a real button
 *    for keyboard/AT users; full text is always in an aria-live region
 *    for screen readers, independent of the animation.
 */
export default function NarrativeReveal({
  text,
  resetKey,
  onComplete,
  // Optional, and only for callers that run SEVERAL reveals in sequence (the AI
  // panel types the facts, the findings and the action taken one after the
  // other). Skipping means "show me the draft": onComplete still fires — this
  // part is finished either way — and onSkip then fires AFTER it, so a caller
  // can take the whole sequence to its end instead of making the officer press
  // skip once per part. A caller that does not pass it is unaffected: the two
  // callbacks are simply the same event with two scopes.
  onSkip,
  outerDurationCapMs = 3500, // see SPEED/CAP DECISION above
  baseTypingSpeed = 45,      // ms per char at the natural tier
  variableSpeed,             // default set below, clamped by the cap tier
}) {
  const [skipped, setSkipped] = useState(false);
  const [typedOut, setTypedOut] = useState(false);
  const doneRef = useRef(false);

  const jitter = variableSpeed ?? { min: 30, max: 58 };

  const effectiveSpeed = (() => {
    const projected = text.length * baseTypingSpeed;
    if (projected <= outerDurationCapMs) return baseTypingSpeed;
    return Math.max(8, Math.floor(outerDurationCapMs / text.length));
  })();

  // Clamp the jitter window so it cannot exceed the effective speed —
  // otherwise a random slow tick would extend the reveal past the cap.
  const [jMin, jMax] = effectiveSpeed < baseTypingSpeed
    ? [
        Math.min(jitter.min, effectiveSpeed),
        Math.min(jitter.max, effectiveSpeed),
      ]
    : [jitter.min, jitter.max];

  const averageTick = (jMin + jMax) / 2;
  const projectedMs = Math.round(text.length * averageTick);

  // A new generation (new resetKey) always starts un-skipped, un-typed.
  useEffect(() => {
    setSkipped(false);
    setTypedOut(false);
    doneRef.current = false;
  }, [resetKey]);

  const fireComplete = useCallback(() => {
    if (doneRef.current) return; // onComplete fires exactly once per reveal
    doneRef.current = true;
    setTypedOut(true);
    onComplete?.();
  }, [onComplete]);

  const handleSkip = useCallback(() => {
    if (typedOut) return;
    setSkipped(true);
    fireComplete();
    // After fireComplete(), deliberately: both callbacks usually set state, and
    // the caller's "sequence is over" must be the last word of the two.
    onSkip?.();
  }, [typedOut, fireComplete, onSkip]);

  useEffect(() => {
    if (skipped) return undefined;
    const t = setTimeout(fireComplete, projectedMs + 250); // +slack for tab jank
    return () => clearTimeout(t);
  }, [skipped, projectedMs, fireComplete, resetKey]);

  const revealBody = skipped || typedOut ? (
    <div className="narrative-reveal__text">{text}</div>
  ) : (
    <TextType
      key={resetKey}
      text={[text]}
      loop={false}
      showCursor
      hideCursorWhileTyping={false}
      cursorCharacter="|"
      typingSpeed={effectiveSpeed}
      variableSpeed={jMax > jMin ? { min: jMin, max: jMax } : undefined}
      initialDelay={0}
      className="narrative-reveal__typing"
    />
  );

  return (
    <div className="narrative-reveal-wrapper">
      {/* Full text for assistive tech immediately — never paced. This is
          ALSO the single completion announcement for the whole generation
          flow (integration brief §4): the thinking-status indicator does
          NOT announce completion separately. */}
      <div className="sr-only" aria-live="polite">
        {text}
      </div>

      {/* Sighted-only animation surface (mouse skip); aria-hidden because
          its content mirrors the live region above. */}
      <div
        className="narrative-reveal"
        aria-hidden="true"
        onClick={handleSkip}
        title="Click to show the full draft immediately"
      >
        {revealBody}
      </div>

      {/* Keyboard/AT skip affordance, shown only while typing. */}
      {!typedOut && (
        <button
          type="button"
          className="narrative-reveal__skip"
          onClick={handleSkip}
        >
          Skip typing
        </button>
      )}
    </div>
  );
}
