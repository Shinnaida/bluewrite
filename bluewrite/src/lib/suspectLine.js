// BlueWrite — the one line the printed sheet says about a suspect.
//
// A report can name nobody and still have to describe somebody: "one
// unidentified male, about thirty, dark jacket" is the whole point of a
// physical description, and it is a fact the sheet has to state. Left to the
// generic person line it printed as the victim's did — `name, age, sex` — which
// for an unidentified suspect is `, 30, Male`: a blank where the name belongs,
// or nothing at all, or — worse — the word "N/A" standing in for a person.
//
// So a suspect gets this instead:
//
//   known     → "Juan Dela Cruz, 34, Male, 5'7\", dark jacket"
//   unknown   → "One unidentified male, about 34, 5'7\", dark jacket"
//   unknown, description thin → "One unidentified person"
//
// Three rules hold it together, and each is asserted in
// tests/rules/suspectLine.test.mjs rather than eyeballed:
//
//   1. the STATUS wins over a stray name. An "unidentified" row that still
//      holds a name (a legacy record, a hand-typed API call, a value the form
//      had not yet cleared) prints the description, NOT the name — the status
//      is what the officer decided, and the sheet must not contradict it;
//   2. a name is never replaced by a placeholder. The sentence is built from a
//      person and their attributes, so "N/A" and "Unknown" can only appear if
//      an officer typed them into a description deliberately;
//   3. NOTHING is invented. Every clause comes from a recorded field, and a row
//      that records nothing prints nothing at all — a blank row is not a person
//      the sheet should announce.
//
// Pure and out of the component for the same reason the register's folder
// helpers are: this is a sentence, and a sentence is worth asserting.

import { meaningfulRows } from './reportRules.js';

/** How the sheet spells an unknown identity, and what it prefixes with. */
const UNIDENTIFIED = 'Unidentified';

// The order the description reads in: how old, how tall, what they looked like,
// what they wore, then whatever the officer added. ONE list, in the one place,
// because the sheet's sentence and the rule engine's idea of "described" have to
// agree about which fields count — every SUSPECT_DESCRIPTOR_KEYS entry is here
// and is asserted (tests/rules/suspectLine.test.mjs). `relationship_to_incident`
// is the deliberate exception: the engine does NOT accept it as a substitute for
// a description, but the sheet still states it.
const CLAUSE_ORDER = [
  'age',
  'sex',
  'height',
  'build',
  'hair',
  'clothing',
  'distinguishing_features',
  'suspect_description',
  // Not a physical descriptor (the engine will not accept it in place of a
  // name/description), but a recorded fact about the suspect the sheet has to
  // state rather than silently drop.
  'relationship_to_incident',
];

const text = (value) => String(value ?? '').trim();

/** Is this person recorded as unidentified (whatever else the row holds)? */
export function isUnidentified(row) {
  return text(row?.suspect_status) === UNIDENTIFIED;
}

/** "male" / "female" / "person" — the noun the sentence needs, never a guess. */
function personNoun(row) {
  const sex = text(row?.sex);
  if (sex === 'Male') return 'male';
  if (sex === 'Female') return 'female';
  return 'person';
}

/**
 * The attribute clause alone — "about 34, 5'7\", dark jacket" — without a name
 * and without the "one unidentified …" opening. Empty when nothing is recorded.
 *
 * `aboutAge` is on for an unknown person (an age read off a stranger is an
 * estimate and the sheet says so) and off for a known one, whose record keeps
 * the bare figure the form asked for. `includeSex` is off for an unknown person
 * because the sex is already the NOUN of that sentence ("one unidentified
 * male"); saying it twice would read as a stutter.
 */
function describe(row, { aboutAge = true, includeSex = true } = {}) {
  const parts = [];
  for (const key of CLAUSE_ORDER) {
    if (key === 'sex' && !includeSex) continue;
    const value = text(row?.[key]);
    if (value === '') continue;
    parts.push(key === 'age' && aboutAge ? `about ${value}` : value);
  }
  return parts.join(', ');
}

/**
 * The line that prints under a Suspect (or Respondent) label.
 *
 * @param {object} row a `respondent` group row
 * @returns {string} the sentence, or '' for a row that records nothing
 */
export function suspectLine(row) {
  // A wholly blank row is not a person. The group can hold one — the officer
  // added a suspect and then thought better of it — and the sheet must not
  // announce somebody who was never described.
  if (meaningfulRows([row]).length === 0) return '';

  const name = text(row?.name);
  const unknown = isUnidentified(row);

  // A name the status has overruled is not printed (rule 1).
  if (name !== '' && !unknown) {
    const details = describe(row, { aboutAge: false });
    return details === '' ? name : `${name}, ${details}`;
  }

  const noun = personNoun(row);
  // `sex` became the noun, so it must not be repeated in the clause.
  const details = describe(row, { includeSex: false });
  return details === ''
    ? `One unidentified ${noun}`
    : `One unidentified ${noun}, ${details}`;
}

/**
 * The clause a report reads for a person it can neither name nor see — the
 * descriptive half of `suspectLine`, for callers that phrase the label their
 * own way (the narrative summary, a future export).
 */
export function describeUnidentified(row) {
  return describe(row, { includeSex: false });
}
