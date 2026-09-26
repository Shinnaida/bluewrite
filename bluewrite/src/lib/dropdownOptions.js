// BlueWrite — what a typeable dropdown offers for the text already in its box.
//
// Kept apart from Dropdown.jsx because this half needs no browser: what the LIST
// should contain is a decision about the text, not about the DOM, and it is the
// decision the bug reports land on. It can therefore be held still by the node
// suite, which the component itself cannot (see tests/rules/dropdownOptions.test.mjs).
//
// TWO STATES, ONE BOX. A typeable control is an input AND a list, and the text in
// it means one of two things:
//
//   • a SEARCH TERM — part of an answer being spelled out. The list narrows to the
//     options containing it, so "acc" finds "Traffic Accident".
//   • a CHOSEN ANSWER — a whole option, put there by picking a row or by typing it
//     out in full. There is nothing to narrow: the officer is looking AT the
//     answer, not searching for it, so the list offers everything again with the
//     answer marked. Otherwise the filter matched only the option already in the
//     box, dropped it as a suggestion, and left the card empty — an answered field
//     that could not be opened and could not be changed, which is the reported
//     bug: "after selecting an option, the dropdown can't be reopened".
//
// Matching is case- and whitespace-insensitive on purpose. An incident type comes
// back from the server with whatever the station typed, so a box has to be able to
// recognise its own answer regardless of case or padding.

/**
 * Is the box SHOWING an answer, or holding a search term?
 *
 * True only when the text is one of the options in full. Nothing else counts: a
 * term that merely starts like an option ("dom") is a search in progress, and
 * treating it as an answer would swallow the officer's own typing.
 *
 * @param {string[]} options
 * @param {string} [value]
 * @returns {boolean}
 */
export function isChosenOption(options, value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return false;
  return options.some((option) => option.toLowerCase() === text);
}

/**
 * The rows a typeable box offers for the text in it.
 *
 * An empty box offers everything, a chosen answer offers everything (the marked
 * row says which one it is), and anything else narrows to the options containing
 * it. A term that matches nothing returns nothing — the caller decides what an
 * empty list looks like.
 *
 * @param {string[]} options
 * @param {string} [value]
 * @returns {string[]}
 */
export function filterOptions(options, value) {
  const typed = String(value ?? '').trim().toLowerCase();
  if (!typed) return options;
  if (isChosenOption(options, value)) return options;
  return options.filter((option) => option.toLowerCase().includes(typed));
}

// ---------------------------------------------------------------------------
// A field may be STORED under one word and SHOWN under another.
//
// A suspect's identity is stored as `Identified` / `Unidentified` because the
// AI's row vocabulary, the printed sheet and the Rape mirror all already read
// those words; the officer, though, is answering "Known" or "Unknown". Rather
// than rename the value (a migration for a synonym) or teach Dropdown a second
// option shape, the schema carries a `optionLabels` map and the caller passes
// the LABELS to the dropdown, translating back on the way in. Two small pure
// functions, because getting the pair out of step would silently store a label
// as if it were an answer.
// ---------------------------------------------------------------------------

/**
 * The words a stored value is shown as.
 *
 * @param {string} value the stored value
 * @param {object<string,string>} [labels] value → label
 * @returns {string}
 */
export function optionLabel(value, labels) {
  return labels?.[value] ?? value;
}

/**
 * The stored value a shown label stands for — the exact inverse of
 * `optionLabel` over the field's own option list.
 *
 * A label no option claims is returned unchanged: a value that arrived from an
 * older record (or a hand-typed API call) is kept rather than mapped onto
 * whichever option happened to look similar.
 *
 * @param {string} label what the officer picked
 * @param {string[]} options the field's stored values
 * @param {object<string,string>} [labels] value → label
 * @returns {string}
 */
export function optionValue(label, options = [], labels) {
  for (const option of options) {
    if (optionLabel(option, labels) === label) return option;
  }
  return label;
}

/** The option list as the dropdown must render it: stored values in, labels out. */
export function optionLabels(options = [], labels) {
  return options.map((option) => optionLabel(option, labels));
}
