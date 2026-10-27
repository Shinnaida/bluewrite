// BLUEWRITE — CodeBoxes
//
// The six boxes the sign-in code is typed into, as SIX REAL INPUTS. That is the
// whole reason this replaced the animated one-shot row it used to be: six inputs
// can each carry their own accessible name, their own focus ring and their own
// error state, which is what an officer on a screen reader and an officer with a
// red box in front of them both need, and none of it can be faked by drawing six
// boxes behind a single hidden field.
//
// WHAT LIVES WHERE. The ARITHMETIC of the row — which box a digit goes to, which
// one Backspace empties, where a paste lands, where the caret ends up — is in
// lib/codeBoxes.js, as functions with tests, because every one of those is a rule
// that can be wrong in a way a screenshot will not show. What is left here is
// what a test cannot see: refs, focus, the DOM, and the event wiring that turns a
// keystroke into one of those calls.
//
// IT DOES NOT OWN THE CODE. `values` and `onChange` are the caller's, so the
// screen holds one copy of the code and the Enter key, the button and the row all
// read the same thing. The row reports a complete code through `onComplete` —
// once, on the transition into complete — which is what the screen uses to submit
// without being asked, exactly as the screen did before.
//
// NO maxLength, ON PURPOSE. A paste and a phone's one-time-code autofill both
// arrive as text LONGER than one box, and they arrive through different doors
// (a paste event versus the browser writing the value itself). Capping the field
// at one character would truncate both before this component could see them, so
// the length is enforced here instead, by distributing whatever arrives.

import { useEffect, useRef } from 'react';
import {
  applyBackspace,
  applyPaste,
  applyTyped,
  codeOf,
  isComplete,
  nextIndex,
  prevIndex,
} from '../../lib/codeBoxes.js';
import './CodeBoxes.css';

export default function CodeBoxes({
  length,
  values,
  onChange,
  onComplete,
  disabled = false,
  invalidIndexes = [],
  autoFocus = false,
  boxRefs,
  labelledBy,
  describedBy,
}) {
  // The caller owns the ref array (see boxRefs below) so IT can put the caret
  // back after a refusal or a resend; this component only fills it in and moves
  // focus within the row.
  const innerRefs = useRef([]);
  const refs = boxRefs ?? innerRefs;

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  /** Hand the caller a new row, and say when it has just become complete. */
  function commit(next, focus) {
    const wasComplete = isComplete(values);
    const nowComplete = isComplete(next);
    onChange(next);
    refs.current[focus]?.focus();
    if (!wasComplete && nowComplete) onComplete?.(codeOf(next));
  }

  function handleInput(index, event) {
    if (disabled) return;
    const r = applyTyped(values, index, event.target.value, length);
    if (r.values === values) {
      // Nothing changed — a character that is not a digit got past the keydown
      // guard (a pasted letter, say). The DOM has already taken it, and React
      // does not rewrite an input whose value prop has not changed, so the box
      // has to be put back by hand or the stray character stays on screen.
      event.target.value = values[index] ?? '';
      return;
    }
    commit(r.values, r.focus);
  }

  function handleKeyDown(index, event) {
    if (disabled) return;
    const { key } = event;

    if (key === 'Backspace') {
      event.preventDefault();
      const r = applyBackspace(values, index);
      if (r.values === values) return;
      commit(r.values, r.focus);
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      refs.current[prevIndex(index)]?.focus();
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      refs.current[nextIndex(index, length)]?.focus();
      return;
    }
    // Anything else printable is refused at the door, so a letter can never
    // overwrite the digit in a box. Navigation, Tab, and every modifier combo
    // are left to the browser.
    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !/^\d$/.test(key)) {
      event.preventDefault();
    }
  }

  function handlePaste(index, event) {
    if (disabled) return;
    event.preventDefault();
    const r = applyPaste(values, index, event.clipboardData.getData('text'), length);
    if (r.values === values) return;
    commit(r.values, r.focus);
  }

  return (
    <div
      className="code-boxes"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="code-boxes__box"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // `one-time-code` is what lets a phone offer the code from the mail
          // above the keyboard; it goes on the FIRST box, which is the one that
          // takes focus and the one autofill fills.
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          // A box that is clicked into takes its digit with it, so typing over a
          // mistaken digit replaces it instead of doing nothing at the cap.
          onFocus={(e) => e.target.select()}
          value={values[i] ?? ''}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalidIndexes.includes(i) || undefined}
          data-invalid={invalidIndexes.includes(i) ? '' : undefined}
          disabled={disabled}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
        />
      ))}
    </div>
  );
}
