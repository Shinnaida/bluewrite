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
//   'sheet'    — the default: every panel on one sheet of paper, a single
//                column with margins and a page's worth of chrome removed,
//                fields drawn as blanks to write on rather than boxes to fill
//                in. The printed report's own grammar, as a thing you type
//                into, and the only format that draws the whole report at once.
//                Its rules are its own and are never copied from another format.
//   'steps'    — the same slides plus a Review step at the end, which reads the
//                whole report back in one piece before the commit cluster.
//
// The value is not written to <html> the way density is: nothing outside the
// editor answers to it, so the editor is handed it as a prop (Shell → the
// screen) and that is the one place it matters. Index.html's inline script
// cannot pre-apply it for the same reason — there is no flash to prevent,
// because the editor is not on screen until after a sign-in.

/** localStorage key. One per preference, `bw-` prefixed. */
export const FORM_FORMAT_KEY = 'bw-form-format';

/**
 * The single offered value. Document and Steps are both hidden:
 * neither is offered, and a stored 'document' or 'steps' falls back to sheet.
 * Sheet keeps its own rules and never copies another format's.
 */
export const FORM_FORMATS = ['sheet'];

/** The label on each position of the control — short, they sit side by side. */
export const FORM_FORMAT_LABELS = {
  sheet: 'Sheet',
};

/** One line each, printed as the row's hint so the hint IS the value. */
export const FORM_FORMAT_HINTS = {
  sheet: 'One sheet of paper, like a word processor',
};

/** A stored value, or null when it is not one of the three. */
export function normaliseFormFormat(value) {
  return FORM_FORMATS.includes(value) ? value : null;
}

/**
 * The stored preference, or the sheet default when unavailable or unknown.
 * A legacy stored 'document' is mapped to sheet: Document is hidden and
 * no longer a format, and Sheet never copies its rules.
 *
 * The unknown case is why normaliseFormFormat exists: this is a plain
 * localStorage read, so it can hold anything a previous build or a hand-edit
 * left there, and a value no format answers to would render the editor with no
 * format at all.
 *
 * An officer who has SET a format keeps it — the default is only what a device
 * that has never been asked answers with, and Profile ▸ Preferences is where it
 * is changed.
 */
export function readFormFormat() {
  try {
    const raw = window.localStorage.getItem(FORM_FORMAT_KEY);
    if (raw === 'document' || raw === 'steps') return 'sheet'; // hidden legacy values
    return normaliseFormFormat(raw) ?? 'sheet';
  } catch {
    return 'sheet'; // storage unavailable (private mode) — keep the default
  }
}
