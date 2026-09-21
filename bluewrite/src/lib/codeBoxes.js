// BlueWrite — the rules of the six-box verification code.
//
// WHAT BELONGS HERE: the arithmetic of moving between boxes. Each of these is a
// rule that can be WRONG in a way a screenshot will not show — a backspace that
// skips a box, a paste that lands one digit short, an arrow key that walks off
// the end of the row — so they are functions with tests rather than event
// handlers with comments. The component (components/CodeBoxes.jsx) is left with
// what a test cannot see: refs, focus, and the DOM.
//
// WHAT DOES NOT BELONG HERE: how many digits a code has. That is the server's
// number, mirrored in lib/mfa.js as MFA_DIGITS and pinned to PHP by
// tests/rules/mfa.test.mjs; it arrives in every call below as `length`.
//
// EVERY function returns new state rather than mutating what it was handed, so
// the caller can compare and a test can hold on to the before.

/**
 * One box's worth of input: the last digit that was typed into it.
 *
 * `slice(-1)` rather than `slice(0, 1)`: a box that already holds a digit and
 * receives another (a click back into it, or a phone's autofill landing on top)
 * should take the digit that was just typed, which is the one at the end.
 */
export function toDigit(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.slice(-1);
}

/** Every digit in a string, in order. Used by paste and by autofill. */
export function digitsOf(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/** A fresh row: `length` empty boxes. */
export function emptyValues(length) {
  return Array.from({ length }, () => '');
}

/**
 * A code string spread across `length` boxes.
 *
 * Short codes leave the rest of the row empty, and a code longer than the row is
 * truncated — the same "only the first `length` digits are real" rule the server
 * applies, so the boxes can never show more than a code can hold.
 */
export function valuesFromCode(raw, length) {
  const digits = digitsOf(raw).slice(0, length);
  return Array.from({ length }, (_, i) => digits[i] ?? '');
}

/** The code the boxes spell. */
export function codeOf(values) {
  return values.join('');
}

/** Whether every box holds a digit. */
export function isComplete(values) {
  return values.length > 0 && values.every((v) => v !== '');
}

/** The boxes still waiting for a digit — what an incomplete submit marks red. */
export function emptyIndexes(values) {
  return values.reduce((acc, v, i) => (v === '' ? [...acc, i] : acc), []);
}

/** Every box — what a refused code marks red. */
export function allIndexes(values) {
  return values.map((_, i) => i);
}

/**
 * Where the caret goes after a digit lands: the next box, or the last one.
 *
 * It does NOT wrap. On the final box the caret stays where it is, because the
 * next thing that happens is the code being sent — moving the caret back to box
 * one would invite a second attempt at a code that is already complete.
 */
export function nextIndex(index, length) {
  return Math.min(index + 1, length - 1);
}

/** Where Backspace goes: one box back, never off the row. */
export function prevIndex(index) {
  return Math.max(index - 1, 0);
}

/**
 * Type into a box. → { values, focus }
 *
 * A single digit fills the box it was typed into and moves on.
 *
 * MORE THAN ONE DIGIT is two different events wearing the same disguise, and it
 * deals with them in this order: a keystroke appended to a digit already in the
 * box (an overtype — the box takes the new digit), and otherwise a paste or a
 * phone's one-time-code autofill, which is distributed across the row because it
 * is answering the whole question rather than the box it landed in. The order
 * matters: get it backwards and overtyping a filled box rewrites two boxes.
 */
export function applyTyped(values, index, raw, length) {
  const digits = digitsOf(raw);
  if (digits === '') return { values, focus: index };
  if (digits.length > 1) {
    // OVERTYPE FIRST, because a keystroke and an autofill can both arrive as
    // more than one character and they mean opposite things. Typing into a box
    // that already holds a digit APPENDS the keystroke to it, so what arrived is
    // that digit plus one more — "4" then "7" with the caret at the end, or "7"
    // then "4" with the caret in front of it. The odd digit out is the one just
    // typed, and the box takes it. (A box is selected when it takes focus, so
    // this is the path for one that was clicked into a second time.)
    const current = values[index] ?? '';
    const appended = current !== '' && digits.length === current.length + 1;
    if (appended && (digits.startsWith(current) || digits.endsWith(current))) {
      const next = [...values];
      next[index] = digits.startsWith(current) ? digits.slice(-1) : digits.slice(0, 1);
      return { values: next, focus: nextIndex(index, length) };
    }
    // Everything else with more than one digit did not come from the keyboard —
    // a paste, or a phone's one-time-code autofill. Both are answering the whole
    // question rather than the box they landed in, so both are distributed.
    return applyPaste(values, index, digits, length);
  }
  const next = [...values];
  next[index] = digits;
  return { values: next, focus: nextIndex(index, length) };
}

/**
 * Backspace in a box. → { values, focus }
 *
 * The two-step rule every code field has: a box with a digit in it is emptied
 * and the caret stays there, so one press per digit walks a filled row back from
 * the end. An EMPTY box has nothing to empty, so the press steps back and clears
 * the box before it — which is what makes a wrong digit in the middle of the row
 * one press away from being replaced rather than two.
 */
export function applyBackspace(values, index) {
  const next = [...values];
  if (next[index] !== '') {
    next[index] = '';
    return { values: next, focus: index };
  }
  const back = prevIndex(index);
  if (back === index) return { values, focus: index }; // already at box one
  next[back] = '';
  return { values: next, focus: back };
}

/**
 * A pasted (or autofilled) code, distributed across the boxes. → { values, focus }
 *
 * It fills from the box it was pasted into — unless what arrived is a whole code
 * or more, in which case it fills from box one. That single rule covers both
 * things an officer actually does: dropping a full six digits anywhere on the
 * row, and pasting two digits into the box they are looking at.
 *
 * Existing digits AFTER the pasted run are left alone: a paste corrects the
 * boxes it covers and does not silently wipe the ones beyond it.
 */
export function applyPaste(values, index, raw, length) {
  const digits = digitsOf(raw);
  if (digits === '') return { values, focus: index };
  const start = digits.length >= length ? 0 : index;
  const next = [...values];
  let at = start;
  for (let i = 0; i < digits.length && at < length; i += 1, at += 1) {
    next[at] = digits[i];
  }
  // The caret lands on the box after the last digit that was placed, clamped to
  // the row — so pasting a full code leaves it on the last box rather than
  // somewhere off the end.
  return { values: next, focus: Math.min(at, length - 1) };
}
