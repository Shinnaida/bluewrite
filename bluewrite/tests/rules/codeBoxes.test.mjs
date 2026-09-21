// BlueWrite — the six-box code field's rules (src/lib/codeBoxes.js).
//
// Every case here is a keystroke that a screenshot will not show you: which box
// Backspace empties, whether a paste into box four lands on box four or on box
// one, whether the caret can walk off the end of the row. They are worth tests
// for the reason the module exists — the component around them only paints what
// these return, so a wrong answer here is a wrong answer on screen, and the
// officer's next move (retype a digit, or start the code again) depends on it.
//
// The row is 6 wide in every case, because that is what MFA_DIGITS is; the
// functions take the length as an argument so these can also prove they do not
// assume it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allIndexes,
  applyBackspace,
  applyPaste,
  applyTyped,
  codeOf,
  digitsOf,
  emptyIndexes,
  emptyValues,
  isComplete,
  nextIndex,
  prevIndex,
  toDigit,
  valuesFromCode,
} from '../../src/lib/codeBoxes.js';

const LEN = 6;
const empty = () => emptyValues(LEN);

// --- reading what arrived ------------------------------------------------------

test('toDigit keeps the last digit, because that is the one just typed', () => {
  assert.equal(toDigit('7'), '7');
  // A box that already held a digit and received another: the new one wins.
  assert.equal(toDigit('47'), '7');
  assert.equal(toDigit(' 7 '), '7');
  assert.equal(toDigit('a'), '');
  assert.equal(toDigit(''), '');
  assert.equal(toDigit(null), '');
  assert.equal(toDigit(undefined), '');
});

test('digitsOf strips everything that is not a digit, in order', () => {
  assert.equal(digitsOf('081 804'), '081804');
  assert.equal(digitsOf('081-804'), '081804');
  assert.equal(digitsOf('no digits'), '');
});

test('valuesFromCode spreads a code across the row and pads the rest', () => {
  assert.deepEqual(valuesFromCode('081804', LEN), ['0', '8', '1', '8', '0', '4']);
  assert.deepEqual(valuesFromCode('081', LEN), ['0', '8', '1', '', '', '']);
  assert.deepEqual(valuesFromCode('', LEN), ['', '', '', '', '', '']);
  assert.deepEqual(valuesFromCode(null, LEN), ['', '', '', '', '', '']);
});

test('a code longer than the row is truncated, never overflowing it', () => {
  assert.deepEqual(valuesFromCode('08180499', LEN), ['0', '8', '1', '8', '0', '4']);
  assert.equal(valuesFromCode('08180499', LEN).length, LEN);
});

test('valuesFromCode tolerates a grouped code, as the server does', () => {
  assert.deepEqual(valuesFromCode('081 804', LEN), ['0', '8', '1', '8', '0', '4']);
});

// --- completeness and what to mark red -----------------------------------------

test('isComplete is true only when every box holds a digit', () => {
  assert.equal(isComplete(valuesFromCode('081804', LEN)), true);
  assert.equal(isComplete(valuesFromCode('08180', LEN)), false);
  assert.equal(isComplete(empty()), false);
  // A zero-width row is not a complete code — it is nothing to send.
  assert.equal(isComplete([]), false);
});

test('emptyIndexes names the boxes still waiting, in order', () => {
  assert.deepEqual(emptyIndexes(empty()), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(emptyIndexes(valuesFromCode('0818', LEN)), [4, 5]);
  assert.deepEqual(emptyIndexes(valuesFromCode('081804', LEN)), []);
  // A gap in the MIDDLE, which is what a half-typed row actually looks like when
  // the officer has clicked around — not a run of empties at the end.
  assert.deepEqual(emptyIndexes(['', '8', '1', '', '0', '4']), [0, 3]);
});

test('allIndexes marks the whole row, for a code that was refused', () => {
  assert.deepEqual(allIndexes(empty()), [0, 1, 2, 3, 4, 5]);
});

test('codeOf joins the boxes back into the code the server is sent', () => {
  assert.equal(codeOf(valuesFromCode('081804', LEN)), '081804');
  assert.equal(codeOf(empty()), '');
});

// --- where the caret goes ------------------------------------------------------

test('nextIndex advances, and stops on the last box instead of wrapping', () => {
  assert.equal(nextIndex(0, LEN), 1);
  assert.equal(nextIndex(4, LEN), 5);
  assert.equal(nextIndex(5, LEN), 5, 'the last box is the end of the row');
});

test('prevIndex steps back, and stops on the first box', () => {
  assert.equal(prevIndex(5), 4);
  assert.equal(prevIndex(1), 0);
  assert.equal(prevIndex(0), 0);
});

test('the caret rules do not assume a six-box row', () => {
  assert.equal(nextIndex(0, 1), 0);
  assert.equal(nextIndex(3, 4), 3);
  assert.equal(nextIndex(0, 8), 1);
});

// --- typing --------------------------------------------------------------------

test('typing a digit fills its box and moves to the next', () => {
  const r = applyTyped(empty(), 0, '7', LEN);
  assert.deepEqual(r.values, ['7', '', '', '', '', '']);
  assert.equal(r.focus, 1);
});

test('typing over a box replaces that digit rather than shifting the row', () => {
  const r = applyTyped(valuesFromCode('081804', LEN), 3, '9', LEN);
  assert.equal(codeOf(r.values), '081904', 'only box four moved');
  assert.equal(r.focus, 4);
});

test('typing the last digit leaves the caret on the last box', () => {
  const r = applyTyped(valuesFromCode('08180', LEN), 5, '4', LEN);
  assert.equal(codeOf(r.values), '081804');
  assert.equal(r.focus, 5);
});

test('a non-digit changes nothing and does not move the caret', () => {
  const before = valuesFromCode('081', LEN);
  const r = applyTyped(before, 3, 'x', LEN);
  assert.deepEqual(r.values, before);
  assert.equal(r.focus, 3);
});

test('the box that was typed into is the only one replaced', () => {
  const before = valuesFromCode('081804', LEN);
  const r = applyTyped(before, 2, '5', LEN);
  assert.equal(r.values[0], '0');
  assert.equal(r.values[1], '8');
  assert.equal(r.values[2], '5');
  assert.equal(r.values[3], '8');
});

// --- backspace ------------------------------------------------------------------

test('Backspace empties a filled box and stays there', () => {
  const r = applyBackspace(valuesFromCode('081804', LEN), 5);
  assert.equal(codeOf(r.values), '08180');
  assert.equal(r.focus, 5, 'one press per digit walks the row back from the end');
});

test('Backspace on an empty box steps back and clears the one before it', () => {
  const r = applyBackspace(valuesFromCode('0818', LEN), 4);
  assert.equal(codeOf(r.values), '081', 'the digit before the gap is the casualty');
  assert.equal(r.focus, 3);
});

test('Backspace at the very start of the row does nothing at all', () => {
  const before = empty();
  const r = applyBackspace(before, 0);
  assert.deepEqual(r.values, before);
  assert.equal(r.focus, 0);
});

test('Backspace walks a full row back one digit at a time', () => {
  let values = valuesFromCode('081804', LEN);
  let focus = 5;
  for (let i = 0; i < LEN; i += 1) {
    const r = applyBackspace(values, focus);
    values = r.values;
    focus = r.focus;
  }
  assert.equal(codeOf(values), '', 'six presses empty six boxes');
  assert.equal(focus, 0);
});

// --- paste and autofill ---------------------------------------------------------

test('pasting a whole code anywhere fills the row from box one', () => {
  for (const into of [0, 2, 5]) {
    const r = applyPaste(empty(), into, '081804', LEN);
    assert.equal(codeOf(r.values), '081804', `pasted into box ${into}`);
  }
});

test('pasting a whole code leaves the caret on the last box', () => {
  const r = applyPaste(empty(), 3, '081804', LEN);
  assert.equal(r.focus, LEN - 1);
});

test('a grouped paste is read the same way as a plain one', () => {
  assert.equal(codeOf(applyPaste(empty(), 0, '081 804', LEN).values), '081804');
});

test('a short paste lands on the box it was pasted into', () => {
  const r = applyPaste(empty(), 2, '45', LEN);
  assert.deepEqual(r.values, ['', '', '4', '5', '', ''], 'boxes three and four');
  assert.equal(r.focus, 4, 'the caret follows the digits it placed');
});

test('a short paste stops at the end of the row instead of running off it', () => {
  const r = applyPaste(empty(), 5, '45', LEN);
  assert.deepEqual(r.values, ['', '', '', '', '', '4'], 'only box six had room');
  assert.equal(r.focus, LEN - 1);
});

test('a paste corrects the boxes it covers and leaves the ones beyond it alone', () => {
  const r = applyPaste(valuesFromCode('081804', LEN), 0, '99', LEN);
  assert.equal(codeOf(r.values), '991804', 'boxes one and two changed, three to six did not');
});

test('a paste of nothing changes nothing', () => {
  const before = valuesFromCode('081', LEN);
  const r = applyPaste(before, 2, '', LEN);
  assert.deepEqual(r.values, before);
  assert.equal(r.focus, 2);
});

test('a paste of letters changes nothing', () => {
  const before = empty();
  const r = applyPaste(before, 0, 'abc', LEN);
  assert.deepEqual(r.values, before);
  assert.equal(r.focus, 0);
});

test('autofill dropping a whole code on a focused box is treated as a paste', () => {
  // The browser writes the value itself rather than firing a paste event, so it
  // arrives through applyTyped with more than one digit.
  const r = applyTyped(empty(), 4, '081804', LEN);
  assert.equal(codeOf(r.values), '081804');
  assert.equal(r.focus, LEN - 1);
});

// --- overtyping a box that already holds a digit ------------------------------
//
// A keystroke and an autofill both arrive here as more than one character, and
// they mean opposite things. These are the cases that tell them apart: get the
// order wrong and overtyping one box silently rewrites two.

test('typing into a filled box with the caret after it keeps only the new digit', () => {
  // What the DOM hands over when a box holding "4" receives a "7".
  const r = applyTyped(valuesFromCode('081804', LEN), 2, '17', LEN);
  assert.equal(codeOf(r.values), '087804', 'box three, and only box three');
  assert.equal(r.focus, 3);
});

test('typing into a filled box with the caret before it keeps only the new digit', () => {
  // The same keystroke with the caret in front of the digit: "7" then "1".
  const r = applyTyped(valuesFromCode('081804', LEN), 2, '71', LEN);
  assert.equal(codeOf(r.values), '087804', 'the new digit is the one in front');
  assert.equal(r.focus, 3);
});

test('an overtype never disturbs the boxes either side of it', () => {
  const r = applyTyped(valuesFromCode('081804', LEN), 4, '09', LEN);
  assert.deepEqual(r.values, ['0', '8', '1', '8', '9', '4']);
});

test('two digits into an EMPTY box are a paste, not an overtype', () => {
  // Nothing to append to, so this is external text and spreads across the row.
  const r = applyTyped(valuesFromCode('0818', LEN), 4, '04', LEN);
  assert.deepEqual(r.values, ['0', '8', '1', '8', '0', '4']);
  assert.equal(r.focus, LEN - 1);
});

test('typing into every box in turn builds the code in order', () => {
  let values = empty();
  let focus = 0;
  for (const digit of '081804') {
    const r = applyTyped(values, focus, digit, LEN);
    values = r.values;
    focus = r.focus;
  }
  assert.equal(codeOf(values), '081804');
  assert.equal(isComplete(values), true);
});
