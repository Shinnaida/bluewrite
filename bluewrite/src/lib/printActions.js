// BlueWrite — printed ACTION TAKEN / STATUS block composition.
//
// The block records what was DONE, so it may state only what the officer
// recorded (the same rule the AI prompt enforces on the drafted disposition)
// plus the station's own form conventions — and those conventions may not
// assert anything the record does not. Three fixed lines used to be appended
// to EVERY sheet regardless of the record:
//
//   · "…this report is referred to the station investigator-on-case." — a
//     second disposition whenever the officer had already recorded a referral
//     or endorsement ("endorsed to follow up investigation"), and a canned
//     referral beside a settled case ("both parties amicably settled").
//   · "The entry is on file with this station and is subject to further
//     verification." — a disclaimer printed on the record it disclaims, and
//     on a finalized sheet an outright falsehood.
//
// All three are gone (owner requests, 2026-10-31): a canned line is a default
// the officer never wrote. The block fills from the officer's own disposition
// (or the AI account read that filed the draft), never from a constant.
// Pure/static so the rules are unit-tested: tests/rules/printActions.test.mjs.

/** Retired form convention (owner request, 2026-10-31): the routing line
 *  used to print under every disposition that did not already state an
 *  onward action. A canned referral is a default the officer never wrote —
 *  a referral the officer states is their own disposition line and prints
 *  verbatim. Kept exported so older imports keep resolving; no longer
 *  emitted — see buildActionBlock() below. */
export const REFERRAL_LINE =
  'For further investigation and appropriate action, this report is referred to the station investigator-on-case.';

/** Retired stand-in (owner request, 2026-10-31): a block with nothing
 *  recorded now prints nothing instead of "The entry is on file with this
 *  station." — a canned line is itself a default the officer never wrote.
 *  Kept exported so older imports keep resolving; no longer emitted. */
export const ON_FILE_NOTE = 'The entry is on file with this station.';

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
 *   3. the finalization note when the entry has been finalized.
 * An empty block stays empty: no canned stand-in, no routing line.
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
  // Nothing recorded, nothing printed: the officer's own disposition — or
  // the AI read of the blotter account that filed it — is what fills this
  // block, via the form's own fields. No canned lines, ever.
  const finalized = String(finalizedLine || '').trim();
  if (finalized !== '') {
    lines.push(finalized);
  }
  return lines;
}
