// BlueWrite — narrative text rules shared by the accept path and the sheet.
//
// Task 6. The printed sheet's certification line already states the blotter
// entry number and its date:
//
//   "This is to certify that, according to the police blotter entry #
//    BW-0321, dated September 25, 2026, appeared among other things the
//    following data to wit;"
//
// FACTS OF THE CASE sits directly below that line, so a narrative that opens
// by restating the blotter reference duplicates what the reader has just
// read. The server strips a leading restatement in code
// (`NarrativeService::stripLeadingBlotterRestatement`) — this is the SAME
// rule on the client, so a legacy row stored before that change, or a draft
// that reached the form by another path, still never repeats it on the sheet.
//
// Keep the two implementations in lockstep; both are covered by tests
// (tests/rules/narrativeText.test.mjs and tests/MaskingRoundTripTest.php).
//
// Presentation/render rule only: it never changes wording, only removes a
// duplicated leading reference.

// "Blotter Entry No. BW-0321. On or about …"  /  "blotter entry # BW-0321,
// dated 25 September 2026. …" — the leading sentence through its own full
// stop. `[^.]*` never crosses a later period; the "No." abbreviation is
// matched explicitly.
const LEADING_BLOTTER = /^\s*Blotter\s+(?:Entry\s+)?(?:(?:No|Number)\.?\s*|#\s*)?(?:BW[-\s]?)?\d+[^.]*\.\s*/i;

/**
 * Remove a blotter-entry restatement from the START of a narrative, if one is
 * there. Only a leading restatement is touched; a reference inside a later
 * sentence is left for the prompt to prevent and the officer to review.
 *
 *   "Blotter Entry No. BW-0321. On or about 09:00 hours, the subject fled."
 *     → "On or about 09:00 hours, the subject fled."
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stripLeadingBlotterRestatement(value) {
  const text = String(value ?? '');
  if (text.trim() === '' || !/^\s*blotter/i.test(text)) return text;
  return text.replace(LEADING_BLOTTER, '').trim();
}
