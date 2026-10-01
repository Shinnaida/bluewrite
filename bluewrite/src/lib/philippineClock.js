// BlueWrite — the station's wall clock, read on PHILIPPINE STANDARD TIME.
//
// WHY A FORMATTER AND NOT `toLocaleTimeString()`. The station is one place, and
// the time an officer writes a report is part of the record (it is what the case
// bar's save line and the audit trail show). A workstation with its clock set to
// another zone — a laptop brought in from a trip, a PC whose region was never
// set — would otherwise show a working time that disagrees with every other
// screen and with the blotter. `Asia/Manila` is stated once, here, and every
// reader of the station clock goes through it.
//
// ONE HOME FOR THE ZONE'S NAME TOO. 'Philippine Standard Time' is spelled out
// under the time rather than left to the browser's zone name (`Intl` would say
// "Philippine Time" or "GMT+8" depending on the engine's ICU build, and on some
// builds the same machine answers differently in the browser than in Node). A
// fixed label reads the same on every PC in the station.
//
// The seconds TICK (see HomeClock), so the clock is returned as two pieces — the
// time and the date — rather than one string: the screen sets them at different
// sizes, and the tick only has to change the half that moved.
//
// Invalid or missing input -> '' in both fields, so a caller can render nothing
// rather than "Invalid Date". Same contract as `stationClock` in
// lib/incidentReport.js, which formats the same clock in 24-hour form for the
// case bar (a record's stamp) — this one is the 12-hour readout an officer looks
// at, with AM/PM, because it is read at a glance rather than compared.

/** The zone every time in this product is stated in. The station's own. */
export const PHILIPPINE_TIME_ZONE = 'Asia/Manila';

/** How that zone is named on screen. Fixed, never the engine's own wording. */
export const PHILIPPINE_TIME_LABEL = 'Philippine Standard Time';

const TIME_FORMAT = new Intl.DateTimeFormat('en-PH', {
  timeZone: PHILIPPINE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-PH', {
  timeZone: PHILIPPINE_TIME_ZONE,
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * `Intl` is allowed to join the time and its AM/PM with a NARROW NO-BREAK SPACE
 * (U+202F) — newer ICU builds do exactly that. It is invisible in the CSS and it
 * makes the string differ between engines, so it is normalised to a plain space
 * here: the readout has one shape, on every machine and in every test.
 */
const plainSpaces = (s) => s.replace(/[\u202f\u00a0]/g, ' ');

/**
 * The station's clock right now, or for any Date (`now` is injectable so the
 * result is testable without waiting for a particular second).
 *
 * @returns {{ time: string, date: string, label: string }}
 *   time  — "12:35:01 PM" (2-digit hour, and read into fixed slots by HomeClock:
 *           the ticking seconds may not grow or shrink the line);
 *   date  — "Thursday, Oct 1, 2026";
 *   label — "Philippine Standard Time".
 */
export function readPhilippineClock(now = new Date()) {
  const label = PHILIPPINE_TIME_LABEL;
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return { time: '', date: '', label };
  return {
    time: plainSpaces(TIME_FORMAT.format(d)),
    date: plainSpaces(DATE_FORMAT.format(d)),
    label,
  };
}
