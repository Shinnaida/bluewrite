// BLUEWRITE — the form-format preference behind Profile ▸ Preferences.
//
// Stored per BROWSER, not per account, for the same reason as the theme and the
// density (see Shell.jsx): station PCs are workstations one officer uses at a
// time, and a preference nobody can get back is worse than one they never set.
// One `bw-` prefixed key per preference.
//
// What it changes is how Write Report is DRAWN — never what the report holds.
// All three formats render the same draft through the same fields and the same
// rule engine; switching mid-report re-lays-out the officer's work in place and
// is deliberately not part of the editor's React key.
//
//   'document' — the default. Every panel on one continuous scroll.
//   'sheet'    — the same panels on one sheet of paper: a single column with
//                margins and a page's worth of chrome removed, fields drawn as
//                blanks to write on rather than boxes to fill in. The printed
//                report's own grammar, as a thing you type into.
//   'steps'    — one panel at a time, navigated by the progress stepper.
//
// The value is not written to <html> the way density is: nothing outside the
// editor answers to it, so the editor is handed it as a prop (Shell → the
// screen) and that is the one place it matters. Index.html's inline script
// cannot pre-apply it for the same reason — there is no flash to prevent,
// because the editor is not on screen until after a sign-in.

/** localStorage key. One per preference, `bw-` prefixed. */
export const FORM_FORMAT_KEY = 'bw-form-format';

/**
 * The three values in the order the control shows them.
 *
 * Document and Sheet close together because they are the same thing seen two
 * ways — one continuous read of the whole report — and differ only in dressing.
 * Steps is the structurally different one (it is the only format that hides
 * anything), so it ends the row.
 */
export const FORM_FORMATS = ['document', 'sheet', 'steps'];

/** The label on each position of the control — short, they sit side by side. */
export const FORM_FORMAT_LABELS = {
  document: 'Document',
  sheet: 'Sheet',
  steps: 'Steps',
};

/** One line each, printed as the row's hint so the hint IS the value. */
export const FORM_FORMAT_HINTS = {
  document: 'Continuous document, one long scroll',
  sheet: 'One sheet of paper, like a word processor',
  steps: 'One panel per step in Write Report',
};

/** A stored value, or null when it is not one of the three. */
export function normaliseFormFormat(value) {
  return FORM_FORMATS.includes(value) ? value : null;
}

/**
 * The stored preference, or the document default when unavailable or unknown.
 *
 * The unknown case is why normaliseFormFormat exists: this is a plain
 * localStorage read, so it can hold anything a previous build or a hand-edit
 * left there, and a value no format answers to would render the editor with no
 * format at all.
 */
export function readFormFormat() {
  try {
    return normaliseFormFormat(window.localStorage.getItem(FORM_FORMAT_KEY)) ?? 'document';
  } catch {
    return 'document'; // storage unavailable (private mode) — keep the default
  }
}
