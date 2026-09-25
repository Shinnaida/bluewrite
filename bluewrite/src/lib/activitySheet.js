// BlueWrite — the activity sheet: one account's own year, drawn as squares.
//
// WHAT IT IS. A contribution-style calendar on the account page: one square per day, deeper
// on the days that account did more, with a switch between the two readings the record
// supports —
//
//   attendance  HOW LONG THE OFFICER WAS AT A DESK, in minutes. A DURATION rather than a
//               count: three sign-ins in a morning is not three times the attendance of
//               one, and "was he here on the 14th" is a question about time. It is measured
//               by the workspace's own thirty-second heartbeat, tallied per day
//               (`presence_days`, migration 017) — consecutive beats merged, breaks
//               excluded — and for the days before that tally existed it is ESTIMATED from
//               the trail's sign-ins, which the server marks on every day it does.
//   activity    every audit entry for the account: reports filed and finalized, passwords
//               changed, faces set, sign-ins included. A count, because acts are countable.
//
// THE SERVER OWNS THE COUNTING, and this module never counts anything. `GET
// /users/:id/activity` returns a zero-filled day series plus both summaries, computed in one
// walk over the same rows (see UsersController::activity). What happens here is the
// CALENDAR: which column a day belongs in, which of five shades it wears, where the month
// labels fall, and what a square says when a pointer rests on it. That is presentation, and
// it is the part a picture can get wrong without anybody noticing.
//
// WHAT THE CLIENT DELIBERATELY DOES NOT OWN: "today". A station PC's clock is whatever
// somebody set it to, so the server sends the day it considers current and the squares after
// it are drawn as FUTURE rather than as empty. A zero square and a not-yet square look
// identical in the markup and mean opposite things — one is a day nobody signed in, the
// other is a day that has not happened. The same is true of the boundary between measured
// and estimated time, which travels as `window.presence_from`.

/** The two readings, in the order the switch offers them. */
export const METRICS = ['attendance', 'activity'];

/**
 * What each reading is, in the words the screen uses for it.
 *
 * ONE HOME for everything each reading needs: the switch's label, the legend's name, the
 * noun its summary counts, the phrase a single square says, and — most importantly — the
 * keys the SERVER sends its numbers under. Three copies of "sign-ins" is how a switch ends
 * up promising a number the square's tooltip contradicts; a key written twice is how a
 * reading silently draws a year of zeroes.
 *
 * `dayKey` is the column of one day and `summaryKey` is the block of totals for it.
 * `kind` is the UNIT: a duration is formatted as time and scaled on minutes; a count is
 * counted. They are not interchangeable and the sheet never formats one as the other.
 *
 * The test file asserts both keys against the controller, so a rename on either side fails
 * loudly rather than drawing an empty year.
 */
export const METRIC_INFO = {
  attendance: {
    dayKey: 'minutes',
    summaryKey: 'attendance',
    kind: 'duration',
    label: 'Time',
    legend: 'Time at a desk',
    noun: 'at a desk',
    empty: 'not at a desk',
  },
  activity: {
    dayKey: 'events',
    summaryKey: 'events',
    kind: 'count',
    label: 'Activity',
    legend: 'Recorded activity',
    noun: 'recorded act',
    empty: 'nothing recorded',
  },
};

/** One day's number for a reading, whatever unit it is in. */
export function metricValue(day, metric) {
  const info = METRIC_INFO[metric] ?? METRIC_INFO.attendance;
  return Number(day?.[info.dayKey]) || 0;
}

/**
 * Minutes as a person reads them: "45m", "3h", "3h 10m".
 *
 * THE UNIT THE SHEET SPEAKS, and it is minutes rather than a decimal hour because a time
 * sheet is read in hours and minutes ("six forty") and never in fractions of an hour — 6.67h
 * is a number no reader converts in their head, which is exactly the number a duration
 * silently becomes when it is left as one.
 *
 * Minutes are padded (`3h 05m`, not `3h 5m`), so a column of durations lines up and a
 * five-minute difference is visible at a glance rather than at a squint. Minutes are the
 * smallest unit shown: a day at a desk is never under one, because the server rounds a day
 * with any presence up to it (see `presence_days`).
 */
export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/**
 * Five shades, and the reason there are five rather than two.
 *
 * A binary filled/empty calendar answers "was he here that day" and nothing else, and the
 * question an administrator actually arrives with is closer to "how much, and has it been
 * dropping". Four steps above zero is enough to see a pattern and few enough that a reader
 * is never comparing two shades they cannot tell apart.
 *
 * SCALED TO THIS ACCOUNT'S OWN BUSIEST DAY, not to a station-wide number. An officer present
 * for an hour a day and one present for eight would otherwise be drawn in the ramp's two
 * bottom steps, and the sheet would show two flat years that look identical. The trade is
 * real and the page states it: two colleagues' sheets are not comparable square for square,
 * which is why the summary above each one is printed in absolute numbers rather than left to
 * the colours.
 *
 * The divisor is `Math.ceil(value / busiest * 4)`, so the busiest day is always 4 and a day
 * of a quarter of the busiest is 1. A single day of presence in an otherwise empty year is,
 * correctly, one square at full depth.
 */
export function levelOf(value, busiest) {
  const n = Number(value) || 0;
  const peak = Number(busiest) || 0;
  if (n <= 0 || peak <= 0) return 0;
  return Math.min(4, Math.ceil((n / peak) * 4));
}

/**
 * The day series cut into columns of seven.
 *
 * The server sends a window that STARTS on a Sunday and zero-fills every day to the end of
 * the current week, so chunking in sevens is exact: `weeks` columns of 7, the last one padded
 * with the days that have not happened yet. Nothing here consults a calendar — which is the
 * point, because a client that re-derived the weekday would need the same Sunday convention
 * the server used, and getting it wrong draws a sheet that is one day out for a year without
 * ever looking obviously broken.
 *
 * @param {{date: string}[]} days
 * @returns {object[][]} columns of seven
 */
export function toColumns(days = []) {
  const columns = [];
  for (let i = 0; i < days.length; i += 7) {
    columns.push(days.slice(i, i + 7));
  }
  return columns;
}

/** The short month name a column's first day falls in. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Which columns carry a month label, and what it says.
 *
 * THE FIRST COLUMN ALWAYS, so the year has a beginning, and then the first column whose month
 * differs from the last labelled one. The one refinement is the spacing rule: a label is
 * skipped when the previous one is within two columns, because "Aug"/"Sep" two columns apart
 * overlap into "AugSep" and a month the reader cannot read is worse than a month with no
 * label. GitHub wears the same collision, and the labels it drops are always the ones nobody
 * needed (a month is three or four columns wide).
 *
 * @returns {Map<number, string>} column index → label
 */
export function monthLabels(columns = []) {
  const labels = new Map();
  let lastMonth = -1;
  let lastLabelled = -Infinity;

  columns.forEach((column, index) => {
    const first = column?.[0]?.date;
    if (!first) return;
    const month = Number(String(first).slice(5, 7)) - 1;
    if (!Number.isFinite(month) || month === lastMonth) return;
    lastMonth = month;
    if (index - lastLabelled < 3) return;
    labels.set(index, MONTHS[month] ?? '');
    lastLabelled = index;
  });

  // The first column, unconditionally, even if the spacing rule would have skipped it.
  if (columns[0]?.[0]?.date) {
    labels.set(0, MONTHS[Number(String(columns[0][0].date).slice(5, 7)) - 1] ?? '');
  }
  return labels;
}

/** The row labels, GitHub's three: enough to read the sheet, few enough to not shout. */
export const WEEKDAY_ROWS = [
  { index: 1, label: 'Mon' },
  { index: 3, label: 'Wed' },
  { index: 5, label: 'Fri' },
];

/** `YYYY-MM-DD` as a reader outside the database says it: `dd/mm/yyyy`. */
function asDate(date) {
  const [y, m, d] = String(date).split('-');
  return `${d}/${m}/${y}`;
}

/** The clock part of a server stamp (`YYYY-MM-DD HH:MM:SS`), which is what a span shows. */
function asClock(stamp) {
  const raw = String(stamp ?? '');
  const time = raw.includes(' ') ? raw.split(' ')[1] : raw;
  return time.slice(0, 5);
}

/**
 * What one square says when a pointer rests on it.
 *
 * THE DATE COMES FIRST, because it is the only thing the reader already knows: an
 * administrator arrives at this sheet looking for a specific day ("was he here on the
 * 18th?"), and a sentence that opens with the number makes them find the square first and
 * read the date second. The date is the server's own `YYYY-MM-DD` reordered, never a
 * localised format — the record's dates are all machine stamps (see the view's note).
 *
 * THE TWO READINGS SAY DIFFERENT KINDS OF THING, deliberately:
 *
 *   time      the span first (`09:02–17:11`) and then the time at the desk, because those
 *             are the two facts a time sheet exists for, and the sign-in count in
 *             parentheses as context. A day whose time is ESTIMATED says so in the square
 *             itself — an inference that cannot be told from a measurement is the one thing
 *             this sheet must not do.
 *   activity  a count, in the words the reading counts in.
 */
export function cellTitle(day, metric, today = null) {
  const info = METRIC_INFO[metric] ?? METRIC_INFO.attendance;
  if (!day || !day.date) return '';
  const when = asDate(day.date);

  // A day that has not happened yet says so, rather than reporting a zero it has no right to:
  // the server's zero-fill runs to the end of the current week.
  if (today && day.date > today) return `${when} — not yet`;

  if (info.kind === 'duration') {
    const minutes = metricValue(day, metric);
    if (minutes === 0) return `${when} — ${info.empty}`;

    const duration = formatDuration(minutes);
    // ESTIMATED. Named as an estimate in the square's own sentence, and named by what it was
    // estimated FROM, so the reader can judge it.
    if (day.basis === 'sessions') {
      return `${when} — about ${duration} at a desk, estimated from their sign-ins`;
    }
    const span = day.first_seen && day.last_seen ? `${asClock(day.first_seen)}–${asClock(day.last_seen)}, ` : '';
    const signIns = Number(day.sign_ins) || 0;
    const context = signIns > 0 ? ` (${signIns === 1 ? '1 sign-in' : `${signIns} sign-ins`})` : '';
    return `${when} — ${span}${duration} at a desk${context}`;
  }

  const n = metricValue(day, metric);
  if (n === 0) return `${when} — ${info.empty}`;
  if (n === 1) return `${when} — 1 ${info.noun}`;
  return `${when} — ${n} ${info.noun}s`;
}

/**
 * The line above the sheet: what the year holds, in absolute numbers.
 *
 * ABSOLUTE ON PURPOSE. The shades are scaled to this account's own busiest day (see
 * `levelOf`), so the colours cannot be compared between two officers — the numbers can, and
 * this is where they are. The DAY COUNT is part of it for both readings, because the
 * question the sheet is best at answering is a consistency one ("is he here most days, or an
 * hour on Tuesdays"), and a total without the day count hides exactly that.
 *
 * The window is stated too when it is shorter than a year, so a sheet covering four weeks is
 * never read as a quiet year.
 */
export function summaryLine(summary, metric, window = {}) {
  const info = METRIC_INFO[metric] ?? METRIC_INFO.attendance;
  const s = summary?.[info.summaryKey] ?? {};
  const days = Number(s.active_days) || 0;

  if (info.kind === 'duration') {
    const total = Number(s.total_minutes) || 0;
    const busiest = Number(s.busiest_minutes) || 0;
    if (total === 0) return `No time at a desk in ${span(window)}.`;
    const spread = days === 1 ? 'on a single day' : `across ${days} days`;
    return `${formatDuration(total)} at a desk ${spread}, and never more than ${formatDuration(busiest)} in one day.`;
  }

  const total = Number(s.total) || 0;
  const busiest = Number(s.busiest) || 0;
  if (total === 0) return `No ${info.label.toLowerCase()} in ${span(window)}.`;
  const noun = total === 1 ? info.noun : `${info.noun}s`;
  const spread = days === 1 ? 'on a single day' : `on ${days} days`;
  return `${total} ${noun} ${spread}, and never more than ${busiest} in one day.`;
}

/** "the last year" for a whole-year window, or the exact day count for a shorter one. */
function span(window = {}) {
  const days = windowDays(window);
  if (days === 0) return 'this window';
  return days >= 365 ? 'the last year' : `the last ${days} days`;
}

/**
 * How much of what is drawn was MEASURED, and how much was INFERRED — or null when the
 * answer is "all of it", which needs no sentence.
 *
 * This exists because the sheet draws two different kinds of number in one ramp: time the
 * presence clock actually watched, and time worked out from sign-ins for the days before that
 * clock existed. They can look identical on the page, so the page has to say which is which.
 * Left unsaid, an estimate reads as a measurement, and a reader would quote it as one.
 */
export function basisNote(summary, window = {}) {
  const s = summary?.attendance ?? null;
  if (!s) return null;
  const measured = Number(s.measured_days) || 0;
  const estimated = Number(s.estimated_days) || 0;
  if (estimated === 0) return null;
  if (measured === 0) {
    return 'Every day here is estimated from their sign-ins — the presence clock has no record for any of them.';
  }
  return `${measured} of these days are measured from the presence clock; the ${estimated} before them are estimated from their sign-ins.`;
}

/** How many days the window covers, for the sentences that name it. */
export function windowDays(window = {}) {
  if (!window.from || !window.to) return 0;
  const from = Date.parse(`${window.from}T00:00:00Z`);
  const to = Date.parse(`${window.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400000) + 1;
}

/**
 * The sheet's accessible name — the whole drawing's one sentence.
 *
 * The grid is a `role="img"`, so it announces THIS rather than its 371 children. That is not
 * a shortcut around labelling the squares; it is the only workable shape: a screen reader
 * walked through a year of squares one at a time has been handed a spreadsheet to read
 * instead of a picture, and the two lists under it already say which days matter. So the
 * label carries what the picture is FOR — the span, the total, the spread, and the busiest
 * day — and the squares keep their `title`, which reaches the pointer.
 *
 * Whether any of it is estimated is NOT in here: it is stated in the summary line above,
 * which is ordinary text a screen reader reads in order. Repeating it inside the image label
 * would say the same caveat twice.
 */
export function sheetLabel(summary, metric, window = {}) {
  const info = METRIC_INFO[metric] ?? METRIC_INFO.attendance;
  const s = summary?.[info.summaryKey] ?? {};
  const days = Number(s.active_days) || 0;
  const range = window.from && window.to ? ` from ${window.from} to ${window.to}` : '';
  const title = info.legend;

  if (info.kind === 'duration') {
    const total = Number(s.total_minutes) || 0;
    if (total === 0) return `${title} sheet${range}: no time recorded at a desk.`;
    return `${title} sheet${range}: ${formatDuration(total)} across ${days} ${days === 1 ? 'day' : 'days'}, busiest day ${formatDuration(Number(s.busiest_minutes) || 0)}.`;
  }

  const total = Number(s.total) || 0;
  if (total === 0) return `${title} sheet${range}: nothing recorded.`;
  const noun = total === 1 ? info.noun : `${info.noun}s`;
  return `${title} sheet${range}: ${total} ${noun} on ${days} ${days === 1 ? 'day' : 'days'}, busiest day ${Number(s.busiest) || 0}.`;
}
