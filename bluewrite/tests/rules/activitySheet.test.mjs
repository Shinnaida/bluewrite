// BlueWrite — the activity sheet: one account's own year, drawn as squares.
//
// WHAT THIS IS. A contribution-style calendar on the account page: a square per day, deeper
// on the days that account did more, with a switch between the two readings the record
// supports —
//
//   TIME      how long the officer was at a desk. A DURATION, measured by the workspace's
//             own thirty-second heartbeat (`presence_days`, migration 017) and, for the days
//             before that tally existed, ESTIMATED from the trail's sign-ins.
//   ACTIVITY  how many things were recorded for them.
//
// WHY IT IS TESTED AT THIS LENGTH. The measuring is the server's and the fetching is the
// container's, so what is left here is a drawing — and a drawing is the one thing that fails
// invisibly. The failures this file exists to catch, in order of how likely they are: a
// window that starts on the wrong weekday (the whole sheet is a day out, for a year, and
// looks fine); a tail of days drawn as "nothing happened" when they have not happened yet; a
// ramp that draws a busy officer flat because it was scaled to somebody else's numbers; a
// duration formatted as a number; and — the one this feature could most easily get wrong —
// AN ESTIMATE DRAWN EXACTLY LIKE A MEASUREMENT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';
import {
  METRIC_INFO,
  METRICS,
  WEEKDAY_ROWS,
  basisNote,
  cellTitle,
  formatDuration,
  levelOf,
  metricValue,
  monthLabels,
  sheetLabel,
  summaryLine,
  toColumns,
  windowDays,
} from '../../src/lib/activitySheet.js';

const load = () => loadFixture('tests/fixtures/activitySheet.jsx');

const readController = () => readFile(path.join(root, 'app/controllers/UsersController.php'), 'utf8');
const readRoutes = () => readFile(path.join(root, 'api/index.php'), 'utf8');
const readPresence = () => readFile(path.join(root, 'app/controllers/PresenceController.php'), 'utf8');
const readMigration = () => readFile(path.join(root, 'migrations/017_presence_days.sql'), 'utf8');
const readContainer = () => readFile(path.join(root, 'src/components/Users.jsx'), 'utf8');
const readView = () => readFile(path.join(root, 'src/components/UserProfileView.jsx'), 'utf8');
const readCss = () => readFile(path.join(root, 'src/styles.css'), 'utf8');
const readDarkCss = () => readFile(path.join(root, 'src/dark-theme.css'), 'utf8');

const flat = (text) => text.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// The two readings
// ---------------------------------------------------------------------------

test('the two readings are named once, and each names the keys the server sends', async () => {
  // ONE HOME for everything a reading needs (see METRIC_INFO): its labels, its noun, and the
  // keys its numbers arrive under. A key written twice is how a reading silently draws a year
  // of zeroes — the failure mode with no error anywhere, because a blank year looks like an
  // answer.
  assert.deepEqual(METRICS, ['attendance', 'activity']);

  assert.equal(METRIC_INFO.attendance.kind, 'duration');
  assert.equal(METRIC_INFO.attendance.dayKey, 'minutes');
  assert.equal(METRIC_INFO.attendance.summaryKey, 'attendance');
  assert.equal(METRIC_INFO.activity.kind, 'count');
  assert.equal(METRIC_INFO.activity.dayKey, 'events');
  assert.equal(METRIC_INFO.activity.summaryKey, 'events');

  for (const metric of METRICS) {
    const info = METRIC_INFO[metric];
    assert.ok(info.label && info.legend && info.empty && info.noun, `${metric} must be named`);
    assert.ok(!info.legend.includes('sign-in'), 'the first reading is TIME now, not a count of sign-ins');
  }
});

test('minutes read as a person says them, never as a fraction of an hour', () => {
  // A time sheet is read in hours and minutes ("six forty"); 6.67h is a number no reader
  // converts in their head. Minutes are PADDED, so a column of durations lines up and a
  // five-minute difference is visible rather than something to squint at.
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(59), '59m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(65), '1h 05m');
  assert.equal(formatDuration(545), '9h 05m');
  assert.equal(formatDuration(480), '8h');
  // Nothing invents a negative or a fraction: a duration is whole minutes or it is nothing.
  assert.equal(formatDuration(-30), '0m');
  assert.equal(formatDuration(90.4), '1h 30m');
  assert.equal(formatDuration(undefined), '0m');
});

test('a day’s number is read through the reading’s own key', () => {
  const day = { date: '2026-09-14', minutes: 512, events: 6, basis: 'presence' };
  assert.equal(metricValue(day, 'attendance'), 512);
  assert.equal(metricValue(day, 'activity'), 6);
  // A day with nothing in it is a zero, not `undefined` and not NaN — either of which would
  // draw as a hole in the ramp rather than as an empty square.
  assert.equal(metricValue({ date: '2026-09-14' }, 'attendance'), 0);
  assert.equal(metricValue(undefined, 'activity'), 0);
});

// ---------------------------------------------------------------------------
// The five shades
// ---------------------------------------------------------------------------

test('the shades are scaled to this account’s own busiest day, and are a real ladder', () => {
  // A DAY WITH NOTHING IN IT IS NOT A SHADE OF "A LITTLE" — it is the empty square.
  assert.equal(levelOf(0, 545), 0);
  // The busiest day is always the deepest step, whatever that day's number happens to be: an
  // officer whose longest day is two hours must not be drawn entirely flat.
  assert.equal(levelOf(545, 545), 4);
  assert.equal(levelOf(120, 120), 4);
  // And a step never goes backwards as the value rises — that is the whole readability of a
  // ramp, and it is exactly what an eye-picked set of colours gets wrong (the incident ramp
  // has a test for the same property, for the same reason).
  let previous = 0;
  for (let m = 0; m <= 600; m += 5) {
    const level = levelOf(m, 600);
    assert.ok(level >= previous, `${m} minutes drew a lighter step than ${m - 5}`);
    assert.ok(level >= 0 && level <= 4);
    previous = level;
  }
  // A day with a single beat — a minute at the desk — is the faintest working square, not an
  // empty one: it happened.
  assert.equal(levelOf(1, 545), 1);
  // Defensive: both readings absent must not divide by zero.
  assert.equal(levelOf(300, 0), 0);
  assert.equal(levelOf(undefined, undefined), 0);
});

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

test('the series is cut into whole weeks, seven days to a column', async () => {
  const { buildDays, WEEKS } = await load();
  const days = buildDays();
  const columns = toColumns(days);

  assert.equal(days.length, WEEKS * 7);
  assert.equal(columns.length, WEEKS);
  for (const column of columns) assert.equal(column.length, 7);

  // SEVEN DAYS TO A COLUMN ONLY MEANS ANYTHING IF THE FIRST DAY IS A SUNDAY, and that is the
  // server's promise, not this module's (see UsersController::activity, which snaps the
  // window back to the Sunday on or before today). The fixture asserts the promise so a
  // change there fails HERE rather than silently drawing a sheet that is one day out.
  for (const column of columns) {
    assert.equal(new Date(`${column[0].date}T00:00:00Z`).getUTCDay(), 0, 'a column must start on a Sunday');
  }
  // …and the days are consecutive, with no hole where a quiet week was.
  const flatDates = days.map((d) => d.date);
  assert.equal(new Set(flatDates).size, flatDates.length, 'no day twice');
  for (let i = 1; i < flatDates.length; i++) {
    const gap = Date.parse(`${flatDates[i]}T00:00:00Z`) - Date.parse(`${flatDates[i - 1]}T00:00:00Z`);
    assert.equal(gap, 86400000, `a day is missing before ${flatDates[i]}`);
  }

  // A partial tail (a server that sent 30 days rather than 28) still ends in a short column
  // rather than dropping the days.
  assert.equal(toColumns(flatDates.slice(0, 30).map((date) => ({ date }))).length, 5);
  assert.equal(toColumns([]).length, 0);
});

test('every column that carries a month label carries the right one', async () => {
  const { buildDays } = await load();
  const columns = toColumns(buildDays());
  const labels = monthLabels(columns);

  // THE FIRST COLUMN ALWAYS, so the year has a beginning.
  assert.ok(labels.has(0), 'the sheet must start with a labelled month');

  const labelled = [...labels.keys()].sort((a, b) => a - b);
  for (const index of labelled) {
    const month = Number(String(columns[index][0].date).slice(5, 7)) - 1;
    const expected = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month];
    assert.equal(labels.get(index), expected, `column ${index} is labelled for the wrong month`);
  }

  // THE SPACING RULE: two labels two columns apart overlap into "AugSep", and a month the
  // reader cannot read is worse than a month with no label at all.
  for (let i = 1; i < labelled.length; i++) {
    assert.ok(labelled[i] - labelled[i - 1] >= 3, `labels ${labelled[i - 1]} and ${labelled[i]} would collide`);
  }

  const shown = labelled.map((i) => labels.get(i));
  assert.equal(new Set(shown).size, shown.length, 'a month must not be labelled twice');
});

test('the three weekday rows are the app’s, and the two extra are left blank', () => {
  assert.deepEqual(WEEKDAY_ROWS.map((w) => w.label), ['Mon', 'Wed', 'Fri']);
  assert.deepEqual(WEEKDAY_ROWS.map((w) => w.index), [1, 3, 5]);
});

// ---------------------------------------------------------------------------
// What a square says
// ---------------------------------------------------------------------------

test('a time square gives the span and the time at the desk, and a count square counts', () => {
  const today = '2026-09-24';

  // TIME, measured: the span first — the two facts a time sheet exists for — then the time at
  // the desk, with the sign-in count in parentheses as context rather than as the measure.
  assert.equal(
    cellTitle(
      { date: '2026-09-14', minutes: 545, sign_ins: 2, basis: 'presence', first_seen: '2026-09-14 08:02:00', last_seen: '2026-09-14 17:11:00' },
      'attendance',
      today
    ),
    '14/09/2026 — 08:02–17:11, 9h 05m at a desk (2 sign-ins)'
  );
  // One sign-in is one sign-in.
  assert.match(
    cellTitle({ date: '2026-09-15', minutes: 480, sign_ins: 1, basis: 'presence', first_seen: '2026-09-15 08:00:00', last_seen: '2026-09-15 16:00:00' }, 'attendance', today),
    /\(1 sign-in\)$/
  );

  // TIME, ESTIMATED — and this is the sentence the feature turns on: an inference that cannot
  // be told from a measurement is the one thing this sheet must not do.
  assert.equal(
    cellTitle({ date: '2026-07-06', minutes: 470, sign_ins: 1, basis: 'sessions' }, 'attendance', today),
    '06/07/2026 — about 7h 50m at a desk, estimated from their sign-ins'
  );

  // ACTIVITY is a count, in its own words.
  assert.equal(cellTitle({ date: '2026-09-14', events: 6 }, 'activity', today), '14/09/2026 — 6 recorded acts');
  assert.equal(cellTitle({ date: '2026-09-14', events: 1 }, 'activity', today), '14/09/2026 — 1 recorded act');
});

test('a square knows the difference between no time, no act, and not yet', () => {
  const today = '2026-09-24';

  // Each reading's own words for nothing — and never "0 minutes", which reads as a bug in a
  // tooltip.
  assert.equal(cellTitle({ date: '2026-09-14', minutes: 0, events: 0, basis: null }, 'attendance', today), '14/09/2026 — not at a desk');
  assert.equal(cellTitle({ date: '2026-09-14', minutes: 0, events: 0, basis: null }, 'activity', today), '14/09/2026 — nothing recorded');

  // A DAY THAT HAS NOT HAPPENED YET says so rather than reporting a zero it has no right to:
  // the server's zero-fill runs to the end of the current week, so the tail of the last column
  // is full of days the clock could not possibly have.
  assert.equal(cellTitle({ date: '2026-09-26', minutes: 0, events: 0 }, 'attendance', today), '26/09/2026 — not yet');
  // Today itself is a real day.
  assert.equal(cellTitle({ date: today, minutes: 0, events: 0 }, 'attendance', today), '24/09/2026 — not at a desk');
});

// ---------------------------------------------------------------------------
// The lines above the sheet
// ---------------------------------------------------------------------------

test('the summary states the numbers, because the colours cannot', () => {
  // THE SHADES ARE RELATIVE (see levelOf), so two colleagues' sheets are not comparable square
  // for square. The numbers are, and this is where they are — the total AND the spread across
  // days, because "an hour most days" and "one long day a month" total the same.
  assert.equal(
    summaryLine({ attendance: { total_minutes: 3245, active_days: 22, busiest_minutes: 545 } }, 'attendance', { from: '2026-06-28', to: '2026-09-26' }),
    '54h 05m at a desk across 22 days, and never more than 9h 05m in one day.'
  );
  // Singular, in both the noun and the day count.
  assert.equal(
    summaryLine({ attendance: { total_minutes: 480, active_days: 1, busiest_minutes: 480 } }, 'attendance', { from: '2026-06-28', to: '2026-09-26' }),
    '8h at a desk on a single day, and never more than 8h in one day.'
  );
  // A window with nothing in it is a sentence rather than "0m across 0 days", and it names the
  // span in the reader's own unit: a full sheet is 53 whole weeks — 371 days, which is not a
  // number anybody reads as a year.
  assert.match(
    summaryLine({ attendance: { total_minutes: 0, active_days: 0, busiest_minutes: 0 } }, 'attendance', { from: '2026-06-28', to: '2026-09-26' }),
    /^No time at a desk in the last 91 days\.$/
  );
  assert.match(
    summaryLine({ attendance: { total_minutes: 0, active_days: 0, busiest_minutes: 0 } }, 'attendance', { from: '2025-09-21', to: '2026-09-26' }),
    /^No time at a desk in the last year\.$/
  );

  // The count reading keeps counting.
  assert.equal(
    summaryLine({ events: { total: 41, active_days: 24, busiest: 5 } }, 'activity', { from: '2026-06-28', to: '2026-09-26' }),
    '41 recorded acts on 24 days, and never more than 5 in one day.'
  );
  assert.equal(windowDays({ from: '2026-06-28', to: '2026-09-26' }), 91);
  assert.equal(windowDays({}), 0);
});

test('the page says how much of the year was measured and how much was inferred', () => {
  // A MIXED YEAR is the ordinary case right after the tally is introduced, and the note has to
  // read like a fact rather than like an apology.
  assert.equal(
    basisNote({ attendance: { measured_days: 35, estimated_days: 56 } }, { from: '2026-06-28', to: '2026-09-26' }),
    '35 of these days are measured from the presence clock; the 56 before them are estimated from their sign-ins.'
  );
  // A whole year of estimates — the state on a database that has just run the migration, and
  // the sentence that stops a reader quoting an inference as a measurement.
  assert.match(
    basisNote({ attendance: { measured_days: 0, estimated_days: 91 } }),
    /^Every day here is estimated from their sign-ins/
  );
  // ALL MEASURED NEEDS NO SENTENCE AT ALL: a caveat printed when there is nothing to caveat is
  // a caveat readers learn to skip.
  assert.equal(basisNote({ attendance: { measured_days: 91, estimated_days: 0 } }), null);
  assert.equal(basisNote(null), null);
});

test('the sheet announces itself as one picture, not as 371 squares to tab through', () => {
  // A duration reads as a duration in the image's own label, and the busiest day is named in
  // the same unit — never "busiest day 545".
  assert.equal(
    sheetLabel({ attendance: { total_minutes: 3245, active_days: 22, busiest_minutes: 545 } }, 'attendance', { from: '2026-06-28', to: '2026-09-26' }),
    'Time at a desk sheet from 2026-06-28 to 2026-09-26: 54h 05m across 22 days, busiest day 9h 05m.'
  );
  // An empty year still names the span, so the image is never an unlabelled box.
  assert.equal(
    sheetLabel({ attendance: { total_minutes: 0, active_days: 0, busiest_minutes: 0 } }, 'attendance', { from: '2026-06-28', to: '2026-09-26' }),
    'Time at a desk sheet from 2026-06-28 to 2026-09-26: no time recorded at a desk.'
  );
  assert.equal(
    sheetLabel({ events: { total: 0, active_days: 0, busiest: 0 } }, 'activity', { from: '2026-06-28', to: '2026-09-26' }),
    'Recorded activity sheet from 2026-06-28 to 2026-09-26: nothing recorded.'
  );
});

// ---------------------------------------------------------------------------
// The pairing that crosses the language boundary
// ---------------------------------------------------------------------------

test('the keys the sheet reads are the keys the controller sends', async () => {
  const php = await readController();
  const body = flat(php.slice(php.indexOf('public function activity')));

  // DAY KEYS. `METRIC_INFO.dayKey` is what the sheet indexes a day by; a rename on either side
  // draws a year of zeroes with no error anywhere, which is why this is asserted rather than
  // trusted.
  assert.match(body, /'minutes' => \$minutes,/);
  assert.match(body, /'events' => \$counts\['events'\],/);
  // SUMMARY KEYS, and the two blocks they name.
  assert.match(body, /'attendance' => \[ 'total_minutes' => 0, 'active_days' => 0, 'busiest_minutes' => 0,/);
  assert.match(body, /'events' => \['total' => 0, 'active_days' => 0, 'busiest' => 0\],/);
  assert.match(body, /\$summary\['attendance'\]\['total_minutes'\] \+= \$minutes;/);
  assert.match(body, /\$summary\['events'\]\['total'\] \+= \$n;/);

  // AND THE BOUNDARY TRAVELS: `presence_from` is what tells the sheet where the year stops
  // being measured and starts being inferred. A client that guessed it would draw an estimate
  // as a measurement — the single failure this reading must not have.
  assert.match(body, /'presence_from' => \$presenceFrom,/);
  assert.match(body, /\$measured = \$presenceFrom !== null && \$key >= \$presenceFrom;/);
  assert.match(body, /\$basis = 'presence';/);
  assert.match(body, /\$basis = 'sessions';/);
});

test('time comes from the presence tally, and only the past is estimated', async () => {
  const php = await readController();
  const body = flat(php.slice(php.indexOf('public function activity')));

  // THE MEASUREMENT is the tally the heartbeat keeps, read for the window — not a count of
  // sign-ins, and not a second aggregate computed another way.
  assert.match(body, /FROM presence_days WHERE user_id = :uid AND day >= :from AND day <= :to/);
  // A DAY WITH ONE BEAT IS A DAY SOMEBODY WAS THERE, and a sum of intervals would call it zero
  // seconds — so the tally keeps the beat count and the reader never sees a day that was worked
  // drawn as a day that was not.
  assert.match(body, /\$minutes = \$seconds > 0 \? \(int\) ceil\(\$seconds \/ 60\) : \(\(int\) \$row\['beats'\] > 0 \? 1 : 0\);/);
  // The two sources are never mixed for one day: where the tally reaches, it IS the answer.
  assert.match(body, /\$estimated = \$this->sessionSeconds\(\$pdo, \$userId, \$from, \$to\);/);
  assert.match(body, /else \{ \$summary\['attendance'\]\['estimated_days'\]\+\+;/);
  assert.match(body, /if \(\$measured\) \{ \$summary\['attendance'\]\['measured_days'\]\+\+;/);

  // AND A DATABASE WITHOUT THE MIGRATION STILL ANSWERS: with no tally the whole window is
  // estimated, which is exactly what the client draws for the days before the table existed.
  assert.match(body, /catch \(\\Throwable \$e\) \{ \/\/ A database that has not had migration 017/);
});

test('the estimate is bounded by the trail’s own evidence, and by the idle rule that ends a session', async () => {
  const php = await readController();
  const body = flat(php.slice(php.indexOf('private function sessionSeconds')));

  // A SESSION BEGINS AT A COMPLETED SIGN-IN. Not `login.password_ok` (a password accepted with
  // nothing signed in) and not `mfa.verified` (the same sign-in, one step later): either would
  // report an abandoned attempt as time at a desk.
  assert.match(body, /if \(\$r\['action'\] === 'login\.success'\) \{ \$logins\[\] = \$ts;/);
  assert.match(body, /elseif \(\$r\['action'\] === 'logout'\) \{ \$logouts\[\] = \$ts;/);
  assert.match(body, /if \(\$logout > \$start && \(\$nextLogin === null \|\| \$logout <= \$nextLogin\)\)/);

  // THE TAIL IS THE SYSTEM'S OWN RULE, not a guess: a session really does survive the idle
  // timeout after its last request, and the trail's entries are the evidence of when the last
  // request was. The number is READ FROM THE CONFIGURATION that enforces it.
  assert.match(body, /\$grace = 60 \* max\(1, \(int\) Config::get\('app\.session_idle_minutes', 30\)\);/);
  assert.match(body, /\$end = \$last \+ \$grace;/);

  // AND IT CAN NEVER RUN INTO THE NEXT SESSION: without that bound the two would overlap and
  // the same hour would be counted twice.
  assert.match(body, /if \(\$nextLogin !== null && \$end > \$nextLogin\) \{ \$end = \$nextLogin; \}/);

  // A SESSION CAN CROSS MIDNIGHT, so it is cut at the day boundaries rather than attributed to
  // the day it began.
  assert.match(body, /\$overlap = min\(\$end, \$dayEnd\) - max\(\$start, \$dayStart\);/);
  assert.match(body, /\$cursor = \$cursor->modify\('\+1 day'\);/);
});

test('the tally is the heartbeat, kept — and it cannot take the rail down with it', async () => {
  const presence = flat(await readPresence());

  // ONE EXTRA WRITE ON A ROUTE THAT RUNS EVERY THIRTY SECONDS, on the same beat that already
  // updates `users.last_seen_at`.
  assert.match(presence, /UPDATE users SET last_seen_at = NOW\(\) WHERE id = :id/);
  assert.match(presence, /\$this->tally\(\$pdo, \(int\) \$me\['id'\]\);/);

  // THE INTERVAL IS ACCUMULATED BEFORE `last_seen` MOVES, and the order in the statement is
  // load-bearing: MySQL evaluates an `ON DUPLICATE KEY` assignment list left to right, so a
  // `seconds` written after `last_seen` would measure the gap between this beat and itself —
  // which is zero, for ever.
  const insert = /INSERT INTO presence_days \(user_id, day, first_seen, last_seen, seconds, beats\)(.*?)ON DUPLICATE KEY UPDATE(.*?)'/.exec(presence);
  assert.ok(insert, 'the tally must still be an upsert');
  assert.ok(
    insert[2].indexOf('seconds = seconds +') < insert[2].indexOf('last_seen = NOW()'),
    'the interval must be accumulated before last_seen moves'
  );
  // A break is a break: past the online window nothing is added, and only `last_seen` moves.
  assert.match(presence, /TIMESTAMPDIFF\(SECOND, last_seen, NOW\(\)\) <= :gap/);
  assert.match(presence, /:gap' => self::ONLINE_WINDOW_SECONDS/);

  // IT CANNOT FAIL THE BEAT. The rail and the unread counts ride on this endpoint, so a
  // database that has not had migration 017 applied must lose the tally and not the rail.
  assert.match(presence, /catch \(\\Throwable \$e\) \{ error_log\('presence tally skipped: '/);
});

test('the tally’s own table says what it measures, and why it starts empty', async () => {
  const sql = await readMigration();

  // A ROW PER ACCOUNT PER DAY, not a row per beat: a beat is a liveness signal, and the sheet
  // asks a question about days.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS presence_days/);
  assert.match(sql, /PRIMARY KEY \(user_id, day\)/);
  // The sum and the span are two facts about a day, not two versions of one: the sheet shows
  // the span on hover and shades by the sum.
  for (const column of ['first_seen', 'last_seen', 'seconds', 'beats']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`), `presence_days must keep ${column}`);
  }
  // THE THRESHOLD IS THE RAIL'S, and the migration says so: one window decides both who is
  // online and whether two beats are one sitting.
  assert.match(sql, /ONLINE_WINDOW_SECONDS/);
});

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

test('the year is drawn as columns of seven, and the shaded ones carry their day', async () => {
  const { renderSheet, buildDays, WEEKS } = await load();
  const html = renderSheet();
  const days = buildDays();

  // ONE SQUARE PER DAY. Measured rather than assumed: the drawing is where a column of seven
  // becomes a column of six and nobody notices for a year.
  assert.equal((html.match(/class="sheet-cell/g) || []).length, days.length + 4, 'the four legend squares are not days');
  assert.equal((html.match(/class="sheet-week"/g) || []).length, WEEKS);

  // THE SHADES ARE ACTUALLY DIFFERENT SHADES. A rendering that painted every square level 0
  // would pass every count above — so the depth of the busiest day and the emptiness of the
  // weekends are both asserted by name.
  assert.match(html, /sheet-cell--l4/);
  assert.match(html, /sheet-cell--l1/);
  assert.match(html, /sheet-cell--l0/);

  // THE GAP AT THE END IS VISIBLE as empty squares, and the days after the server's today are
  // drawn as not-yet rather than as empty: those two facts are what an administrator opens this
  // for, and a sheet that cannot show a gap shows nothing.
  assert.match(html, /sheet-cell--future/);

  // Every square has a sentence for the pointer, and a day that was worked has its TIME in it —
  // not just "yes".
  assert.match(html, /title="[0-9]{2}\/[0-9]{2}\/[0-9]{4} — [0-9]{2}:[0-9]{2}–[0-9]{2}:[0-9]{2}, \d+h( \d+m)? at a desk/);
  assert.match(html, /title="[0-9]{2}\/[0-9]{2}\/[0-9]{4} — not at a desk"/);
  assert.match(html, /title="[0-9]{2}\/[0-9]{2}\/[0-9]{4} — not yet"/);
  // AND THE ESTIMATED DAYS SAY SO IN THEIR OWN SQUARE, because this fixture carries both bases.
  assert.match(html, /title="[0-9]{2}\/[0-9]{2}\/[0-9]{4} — about [\dhm ]+ at a desk, estimated from their sign-ins"/);
});

test('the sheet is one image with a label, and it says which reading and which scale', async () => {
  const { renderSheet } = await load();
  const html = renderSheet();

  // ONE STOP FOR A SCREEN READER, not 371: a reader walked through a year of squares has been
  // handed a spreadsheet instead of a picture, and the lists below already carry the detail.
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Time at a desk sheet from 2026-06-28 to 2026-09-26: /);

  // The weekday labels and the month labels are decoration for a reader who can see the
  // picture, so they are hidden from one who cannot — the image's label carries the meaning.
  assert.match(html, /class="sheet-days" aria-hidden="true"/);
  assert.match(html, /class="sheet-months" aria-hidden="true"/);
  assert.match(html, /class="sheet-legend" aria-hidden="true"/);

  // The scale is stated in words, because the colours are relative and a reader who cannot see
  // them must not be left believing two sheets are comparable.
  assert.match(html, /Shading is scaled to this account’s own busiest day/);
  // …and the legend names ITS reading, so a picture of this sheet says which one it shows.
  assert.match(html, /<span class="sheet-legend__name">Time at a desk<\/span>/);
});

test('the page states measured against estimated, and the sheet itself is drawn either way', async () => {
  const { renderSheet, buildSummary, buildDays } = await load();
  const html = renderSheet();

  // THE CAVEAT IS ON THE PAGE, in ordinary text a screen reader reads in order — not inside
  // the image's label and not left to the colours.
  const summary = buildSummary(buildDays());
  assert.match(html, /class="sheet-basis"/);
  assert.match(
    html,
    new RegExp(`${summary.attendance.measured_days} of these days are measured from the presence clock; the ${summary.attendance.estimated_days} before them are estimated from their sign-ins\\.`)
  );

  // ALL MEASURED DRAWS NO CAVEAT: a note printed when there is nothing to caveat is a note
  // readers learn to skip.
  const measuredOnly = renderSheet({
    days: buildDays().map((d) => (d.minutes > 0 ? { ...d, basis: 'presence' } : d)),
    summary: { attendance: { total_minutes: 100, active_days: 1, busiest_minutes: 100, measured_days: 91, estimated_days: 0 }, events: { total: 1, active_days: 1, busiest: 1 } },
  });
  assert.doesNotMatch(measuredOnly, /sheet-basis/);
});

test('the switch offers both readings, and says which one is showing', async () => {
  const { renderSheet } = await load();

  // THE READING IS ON THE ROOT, which is what picks the ramp: the squares, the legend's samples
  // and the pressed half of the switch all read the same five variables, so the switch and the
  // drawing cannot be two different colours at once.
  const attendance = renderSheet({ metric: 'attendance' });
  assert.match(attendance, /<div class="sheet sheet--attendance">/);
  assert.match(attendance, /<div class="sheet-switch" role="group" aria-label="What the sheet counts">/);
  assert.match(attendance, /<button type="button" class="sheet-switch__btn" aria-pressed="true">Time<\/button>/);
  assert.match(attendance, /<button type="button" class="sheet-switch__btn" aria-pressed="false">Activity<\/button>/);
  // The summary is that reading's own sentence, in that reading's own unit — a duration here,
  // a count there.
  assert.match(attendance, /at a desk across \d+ days/);

  const activity = renderSheet({ metric: 'activity' });
  assert.match(activity, /<div class="sheet sheet--activity">/);
  assert.match(activity, /<button type="button" class="sheet-switch__btn" aria-pressed="true">Activity<\/button>/);
  assert.match(activity, /recorded acts? on \d+ days/);
  assert.match(activity, /<span class="sheet-legend__name">Recorded activity<\/span>/);
  assert.match(activity, /aria-label="Recorded activity sheet from 2026-06-28 to 2026-09-26: /);

  // THE SAME YEAR EITHER WAY: switching a reading must not change the calendar, only the
  // shading and the numbers. Anything else would mean one of the two was reading a different
  // window.
  assert.equal(
    (attendance.match(/class="sheet-cell/g) || []).length,
    (activity.match(/class="sheet-cell/g) || []).length
  );
  // …and a minute reading is never formatted as a count, nor the count as minutes.
  assert.doesNotMatch(activity, /at a desk across/);
  assert.doesNotMatch(attendance, /recorded acts/);
});

test('a read in flight says so, and a failure is not a blank calendar', async () => {
  const { renderSheet, buildDays } = await load();

  // LOADING. A zero drawn during a read is a number an administrator would believe, so the
  // sheet says it is reading and draws no squares at all.
  const loading = renderSheet({ days: [], summary: null, loading: true });
  assert.match(loading, /Reading their year…/);
  assert.match(loading, /role="status"/);
  assert.equal((loading.match(/class="sheet-cell/g) || []).length, 0);

  // FAILED — the sheet's own sentence, and no legend (there is no scale to explain).
  const failed = renderSheet({ days: [], summary: null, failed: 'The request timed out.' });
  assert.match(failed, /class="sheet-summary sheet-summary--failed"/);
  assert.match(failed, /This account’s activity could not be read\./);
  assert.doesNotMatch(failed, /Less/);

  // AND AN EMPTY YEAR IS NOT A FAILED ONE: it draws its 91 squares and says so, which is a real
  // answer to the question the page asks.
  const empty = renderSheet({ days: buildDays().map((d) => ({ ...d, minutes: 0, events: 0, basis: null, first_seen: null, last_seen: null })) });
  assert.match(empty, /No time at a desk in the last 91 days\./);
  assert.match(empty, /class="sheet-cell sheet-cell--l0"/);
});

// ---------------------------------------------------------------------------
// The wiring, and the styles
// ---------------------------------------------------------------------------

test('the sheet sits above the lists, and its state belongs to the page', async () => {
  const view = flat(await readView());
  const container = flat(await readContainer());

  // ABOVE THE LISTS, and inside the same card: the sheet is the shape of the year, the lists
  // under it are the days — so a reader who has spotted a gap scrolls down to the date rather
  // than to another screen.
  assert.ok(
    view.indexOf('<ActivitySheet') < view.indexOf('Reading the audit trail…'),
    'the sheet must be drawn above the two lists'
  );
  assert.match(view, /<ActivitySheet days=\{sheet\?\.days \?\? \[\]\} summary=\{sheet\?\.summary \?\? null\} window=\{sheet\?\.window \?\? \{\}\} metric=\{metric\} onMetric=\{onMetric\} loading=\{loading\} failed=\{failed\} \/>/);
  // The card says what it is: a year of time at a desk and of what was recorded, then the days.
  assert.match(view, /<h3>Attendance and activity<\/h3>/);

  // THE READING IS THE PAGE'S STATE, not the sheet's: it survives moving to another colleague,
  // which is what an administrator comparing two accounts is doing — and it is what lets the
  // same account be drawn both ways in a test.
  assert.match(container, /const \[sheetMetric, setSheetMetric\] = useState\('attendance'\);/);
  assert.match(container, /sheet=\{profile\.sheet\} metric=\{sheetMetric\} onMetric=\{setSheetMetric\}/);
  // The view stays presentational: no state of its own (see its own header).
  assert.doesNotMatch(await readView(), /useState/);
});

test('each reading has its own ramp, and neither is inherited from the other', async () => {
  const css = flat(await readCss());
  const dark = flat(await readDarkCss());

  // TWO RAMPS AND ONE SHARED EMPTY. An empty day is empty in BOTH readings, so flipping the
  // switch must not repaint it — and a ramp per reading is how a reader knows which of the two
  // questions they are looking at without re-reading the label.
  assert.match(css, /--sheet-cell: 11px;/);
  for (const ramp of ['ins', 'act']) {
    for (let step = 1; step <= 4; step++) {
      assert.match(css, new RegExp(`--sheet-${ramp}-${step}: #[0-9A-F]{6};`), `${ramp} step ${step} (light)`);
      assert.match(dark, new RegExp(`--sheet-${ramp}-${step}: #[0-9A-F]{6};`), `${ramp} step ${step} must be solved again in dark`);
    }
    // The switch's fill is its own token in both themes, because the deepest STEP is chosen to
    // read as a square and not to hold a label (white on dark's step 4 measures ~2.4:1).
    assert.match(css, new RegExp(`--sheet-${ramp}-fill: #[0-9A-F]{6};`));
    assert.match(dark, new RegExp(`--sheet-${ramp}-fill: #[0-9A-F]{6};`));
  }

  // THE TWO RAMPS ARE ACTUALLY TWO COLOURS — which is the whole request this pair exists for: a
  // second ramp a reader cannot tell from the first is worse than one ramp, because the switch
  // then looks broken rather than informative.
  //
  // MEASURED AS HUE AND NOT AS DISTANCE, and that is not a softer test: at the palest step both
  // ramps are near-white tints, so the summed RGB difference between a faint blue and a faint
  // violet is small even though the two are unmistakable side by side — and the two never ARE
  // side by side, because flipping the switch repaints all 371 squares at once. Hue is what a
  // reader is actually comparing, so hue is what is asserted.
  const stepsOf = (text, ramp) => [1, 2, 3, 4].map((n) => new RegExp(`--sheet-${ramp}-${n}: (#[0-9A-F]{6});`).exec(text)[1]);
  const hue = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h / 6) * 360;
  };
  for (const [theme, text] of [['light', css], ['dark', dark]]) {
    const ins = stepsOf(text, 'ins');
    const act = stepsOf(text, 'act');
    for (let i = 0; i < 4; i++) {
      const apart = Math.abs(hue(ins[i]) - hue(act[i]));
      assert.ok(apart > 25, `${theme} step ${i + 1}: the two ramps are ${apart.toFixed(1)}° of hue apart, too close to tell apart`);
    }
  }

  // A DARK CALENDAR HAS TO BE LIGHTER THAN ITS PANEL, which is the inversion every ramp in this
  // app faces — so the dark steps climb WHILE the light ones descend. The check that matters:
  // the deepest step is the most prominent in both themes.
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const ramp of ['ins', 'act']) {
    const light = stepsOf(css, ramp).map(lum);
    const darkSteps = stepsOf(dark, ramp).map(lum);
    for (let i = 1; i < 4; i++) {
      assert.ok(light[i] < light[i - 1], `light ${ramp} step ${i + 1} is not darker than step ${i}`);
      assert.ok(darkSteps[i] > darkSteps[i - 1], `dark ${ramp} step ${i + 1} is not lighter than step ${i}`);
    }
    const empty = lum(/--sheet-0: (#[0-9A-F]{6});/.exec(css)[1]);
    assert.ok(light[0] < empty, 'light: step 1 must be visibly filled against an empty square');
    const emptyDark = lum(/--sheet-0: (#[0-9A-F]{6});/.exec(dark)[1]);
    assert.ok(darkSteps[0] > emptyDark, 'dark: step 1 must be visibly lifted off an empty square');
  }

  // THE SQUARES AND THE LEGEND ARE DRAWN BY THE READING'S VARIABLES, and the legend's four
  // samples are the same four steps the calendar draws.
  assert.match(css, /\.sheet-cell--l4 \{ background: var\(--sheet-4\); \}/);
  assert.match(css, /\.sheet-cell--future \{ background: none; box-shadow: inset 0 0 0 1px var\(--line\); \}/);

  // ONE PLACE MAPS A READING TO ITS RAMP: the modifier sets the five variables, and nothing in
  // the drawing knows which reading it is.
  assert.match(css, /\.sheet--attendance \{ --sheet-1: var\(--sheet-ins-1\); --sheet-2: var\(--sheet-ins-2\); --sheet-3: var\(--sheet-ins-3\); --sheet-4: var\(--sheet-ins-4\); --sheet-fill: var\(--sheet-ins-fill\); \}/);
  assert.match(css, /\.sheet--activity \{ --sheet-1: var\(--sheet-act-1\); --sheet-2: var\(--sheet-act-2\); --sheet-3: var\(--sheet-act-3\); --sheet-4: var\(--sheet-act-4\); --sheet-fill: var\(--sheet-act-fill\); \}/);
  assert.match(css, /\.sheet-switch__btn\[aria-pressed='true'\], \.sheet-switch__btn\[aria-pressed='true'\]:hover \{ background: var\(--sheet-fill, var\(--accent-fill\)\); color: var\(--on-accent\); \}/);
});

test('the switch says which reading is current, and where the keyboard is', async () => {
  const css = flat(await readCss());

  // (The fill rule itself is pinned above; what this pins is that the pressed half has a hover
  // of its own, so the app's global `button:hover` panel-grey can never put a hole in the fill
  // while a pointer is over the selected reading.)
  //
  // AND IT IS A VEIL RATHER THAN A BRIGHTENING FILTER: this stylesheet refuses `brightness(>1)`
  // anywhere in it, because Blink clamps a brightening filter on an SVG element to a no-op and
  // the pie chart's test guards that file-wide. A white veil is the same lightening with no
  // filter, so the response stays and the guard keeps its teeth.
  assert.match(css, /\.sheet-switch__btn\[aria-pressed='true'\]:hover \{ box-shadow: inset 0 0 0 999px rgba\(255, 255, 255, 0\.08\); \}/);

  // THE RING FOLLOWS THE SELECTION, so the state is legible even where the fill and the pill's
  // own background are close — a second signal in the same colour as the first.
  assert.match(css, /\.sheet-switch:has\(\[aria-pressed='true'\]\) \{ border-color: var\(--sheet-fill, var\(--line-bright\)\); \}/);

  // …AND A FOCUS RING OF ITS OWN. A pressed state is not a focus state: one says which reading
  // is current, the other says where the next key press lands. The offset is negative because
  // the pill clips — an outline drawn outside the button would be cut off, which is the same as
  // having none.
  assert.match(css, /\.sheet-switch__btn:focus-visible \{ outline: 2px solid var\(--focus-ring-strong\); outline-offset: -2px; \}/);

  // The measured-or-estimated line is the quietest thing on the card, and it exists.
  assert.match(css, /\.sheet-basis \{ margin: 0\.2rem 0 0; font-size: 0\.72rem; color: var\(--cyan-dim\); \}/);
});
