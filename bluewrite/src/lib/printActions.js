// BlueWrite — printed ACTION TAKEN / STATUS block composition.
//
// The block records what was DONE, so it may state only what the officer
// recorded (the same rule the AI prompt enforces on the drafted disposition)
// plus the station's own form conventions — and those conventions may not
// assert anything the record does not. Two fixed lines used to be appended to
// EVERY sheet regardless of the record:
//
//   · "…this report is referred to the station investigator-on-case." — a
//     second disposition whenever the officer had already recorded a referral
//     or endorsement ("endorsed to follow up investigation"), which is what
//     the sheet was usually showing.
//   · "The entry is on file with this station and is subject to further
//     verification." — a disclaimer printed on the record it disclaims, and
//     on a finalized sheet an outright falsehood.
//
// Both are gone; the routing line survives as a form convention but only when
// the recorded disposition does not already state an onward action of its own.
//
// The on-file note is now a STAND-IN and nothing more: it prints only when the
// block would otherwise be empty (nothing recorded, no recorded state). A
// disposition that already states what was done needs no line telling the
// reader the entry exists — that was the same class of filler as the
// disclaimer above, printed next to a real disposition.
// Pure/static so the rules are unit-tested: tests/rules/printActions.test.mjs.

/** Form convention: the station's routing line. Printed ONLY when the recorded
 *  disposition states no onward action — otherwise it is a double disposition. */
export const REFERRAL_LINE =
  'For further investigation and appropriate action, this report is referred to the station investigator-on-case.';

/** Stand-in for a block with nothing else to print. Deliberately carries no
 *  disclaimer: the entry is on file, and saying more than that would be the
 *  system asserting a status the officer never recorded. It is NOT a footer for
 *  every draft — see buildActionBlock() below. */
export const ON_FILE_NOTE = 'The entry is on file with this station.';

/** A recorded disposition that already states the onward action. Kept
 *  deliberately broad on the verbs of routing (not on nouns like "investigation
 *  ongoing", which "investigat" also covers — that is itself an onward action,
 *  so the routing line stays omitted there too). */
const ONWARD_ACTION =
  /\b(refer\w*|endors\w*|follow[-\s]?up|turn\w*[-\s]?over|turnover|fil(e|ed|ing)|for\s+investigation|investigat\w*|forwarded|transmitted|prosecut\w*|court|docket\w*)/i;

const normLabel = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Medico-legal examination: Conducted." → "medicolegalexamination"; '' when
 *  the line is not a short "Label: value" pair. */
function labelOf(line) {
  const m = /^([^:]{2,40}):/.exec(String(line || ''));
  return m ? normLabel(m[1]) : '';
}

/**
 * The printed ACTION TAKEN / STATUS lines, in reading order:
 *   1. the officer's recorded disposition (one line per typed line),
 *   2. the recorded structured states (suspect status, recovery, protection
 *      order, search actions, fire response, medico-legal examination),
 *   3. the finalization note when the entry has been finalized, otherwise the
 *      plain on-file note — and the latter ONLY when 1 and 2 printed nothing,
 *   4. the routing line, and only when the disposition did not already state it.
 *
 * `perTypeLabels` are the labels the sheet's per-type fact block prints, so a
 * state already stated there (e.g. "Medico-Legal Examination: Conducted" on a
 * Rape / Sexual Assault sheet) is not repeated in this block.
 */
export function buildActionBlock({
  recordedLines = [],
  structured = [],
  perTypeLabels = [],
  finalizedLine = '',
}) {
  const alreadyStated = new Set(perTypeLabels.map(normLabel).filter(Boolean));
  const recorded = recordedLines.map((l) => String(l || '').trim()).filter(Boolean);
  const lines = [...recorded];
  for (const line of structured) {
    if (alreadyStated.has(labelOf(line))) continue;
    lines.push(line);
  }
  // Stand-in, not a footer: with a disposition or a recorded state already
  // printed, "the entry is on file" adds no fact about the case.
  const finalized = String(finalizedLine || '').trim();
  if (finalized !== '') {
    lines.push(finalized);
  } else if (lines.length === 0) {
    lines.push(ON_FILE_NOTE);
  }

  // The routing line restates the disposition, so it prints only when the
  // officer's own text did not already say what happens next.
  if (!ONWARD_ACTION.test(recorded.join(' '))) {
    lines.push(REFERRAL_LINE);
  }
  return lines;
}
