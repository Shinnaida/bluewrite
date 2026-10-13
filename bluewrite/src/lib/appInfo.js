// BLUEWRITE — what the system knows about itself.
//
// One home for the facts ABOUT the app that more than one screen states: the
// version every support call starts with, the department the gate and the print
// sheet both name, and the writing-assistance advisory that has to read
// identically wherever it appears — the sign-in gate, the report footer, and
// About this system.
//
// Each of these used to be typed out at every one of those places, which is how
// a version number ends up wrong in one file and right in another, and how an
// advisory acquires a second wording nobody meant to write.

/** The system's own names, as they appear in the bar and on the gate. */
export const DEPARTMENT = 'Public Safety Department';
export const SYSTEM_TITLE = 'Official Incident Reporting System';

/**
 * The office the system serves — the station the seals belong to, and the name
 * Home's signature line signs with. Not the department above: the department is
 * the agency the gate and the sheet name, this is the station the officer is
 * posted to, and the two are different facts about different things.
 */
export const STATION = 'City of Naga Police Station';

/**
 * The writing-assistance advisory (spec §5). Not a disclaimer bolted on: it
 * states where responsibility sits, which is the whole point of an AI drafting
 * aid in a police record — the model proposes, the officer signs.
 */
export const AI_ADVISORY =
  'AI-generated suggestions are provided as writing assistance only. The reporting officer remains responsible for reviewing and verifying all report content.';
