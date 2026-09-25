// BlueWrite — the render fixture for the activity sheet (one account's own year).
//
// WHY THIS FILE EXISTS. The sheet is a drawing, and a drawing is the one thing a text-based
// test cannot check: 53 columns of squares is a shape that can come out mirrored, a day out,
// or one column short without any assertion on the source noticing. So it is bundled
// (esbuild, through renderHarness.mjs) and rendered, and the tests read the markup.
//
// THE SERIES IS GENERATED HERE RATHER THAN COPIED, and it is generated the way the SERVER
// builds it: Sunday first, zero-filled, one entry per day to the end of the current week,
// with both readings on every day — `minutes` with its `basis` and the span it came from, and
// `events`. A hand-typed handful of days would have tested the drawing against a shape the
// endpoint never produces, and the zero-fill is exactly the part a client gets wrong.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActivitySheet from '../../src/components/ActivitySheet.jsx';

/** The window the fixture draws: thirteen weeks, which is a sheet and not a novel. */
export const WEEKS = 13;

/** A Sunday, because the server's window always starts on one. */
export const FROM = '2026-06-28';

/** The server's own idea of today, three days before the window ends. */
export const TODAY = '2026-09-24';

/**
 * Where the presence tally starts: two thirds of the way through the window, so the fixture
 * carries BOTH sources — the older days estimated from sign-ins, the newer ones measured by
 * the presence clock. A fixture with only one of them could not check the boundary, and the
 * boundary is the part the page has to state out loud.
 */
export const PRESENCE_FROM = '2026-08-23';

const DAY_MS = 86400000;

/** The date string `n` days after the window's first day. */
function dayAt(n) {
  const d = new Date(`${FROM}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The year, in the shape `GET /users/:id/activity` returns it.
 *
 * FOUR THINGS IN IT ARE DELIBERATE, and each is a state the drawing has to survive:
 *
 *   - a GAP at the end (the last four days have nothing), because an officer who stopped
 *     coming in is the single most important thing this sheet can show;
 *   - WEEKENDS EMPTY and Mondays longer than the rest, so the ramp has more than one shade to
 *     draw and the busiest day is not simply "every working day";
 *   - DAYS THAT HAVE NOT HAPPENED YET at the tail, because the window runs to the end of the
 *     current week and a square that is not yet due is not a square with a zero in it;
 *   - BOTH BASES — estimated before PRESENCE_FROM, measured after it — because a sheet that
 *     draws an inference exactly like a measurement is the failure this whole reading has to
 *     avoid.
 */
export function buildDays() {
  const days = [];
  for (let n = 0; n < WEEKS * 7; n++) {
    const date = dayAt(n);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const working = weekday !== 0 && weekday !== 6;
    const gap = n >= WEEKS * 7 - 4;
    const present = working && !gap;
    const signIns = present ? (weekday === 1 ? 2 : 1) : 0;

    // A shift: in at 08:0x, out at 17:0x, with Mondays the long day.
    const minutes = present ? (weekday === 1 ? 545 : 8 * 60 + (weekday * 7)) : 0;
    const measured = date >= PRESENCE_FROM;
    const firstSeen = present ? `${date} 08:0${weekday}:00` : null;
    const lastSeen = present ? `${date} ${minutes >= 540 ? '17' : '16'}:1${weekday}:00` : null;

    days.push({
      date,
      sign_ins: signIns,
      events: signIns === 0 ? 0 : signIns + (weekday === 2 ? 3 : 1),
      minutes,
      // A day before the tally carries the estimate as its basis; a day inside it, or a
      // weekend with nothing on it, carries none.
      basis: minutes > 0 ? (measured ? 'presence' : 'sessions') : null,
      first_seen: measured ? firstSeen : null,
      last_seen: measured ? lastSeen : null,
    });
  }
  return days;
}

/** Both summaries, counted from the same series the way the controller counts them. */
export function buildSummary(days = buildDays()) {
  const attendance = {
    total_minutes: 0,
    active_days: 0,
    busiest_minutes: 0,
    measured_days: 0,
    estimated_days: 0,
  };
  const events = { total: 0, active_days: 0, busiest: 0 };

  for (const day of days) {
    if (day.date >= PRESENCE_FROM) attendance.measured_days += 1;
    else attendance.estimated_days += 1;

    attendance.total_minutes += day.minutes;
    if (day.minutes > 0) {
      attendance.active_days += 1;
      attendance.busiest_minutes = Math.max(attendance.busiest_minutes, day.minutes);
    }

    events.total += day.events;
    if (day.events > 0) {
      events.active_days += 1;
      events.busiest = Math.max(events.busiest, day.events);
    }
  }
  return { attendance, events };
}

export const WINDOW = {
  from: FROM,
  to: dayAt(WEEKS * 7 - 1),
  weeks: WEEKS,
  today: TODAY,
  presence_from: PRESENCE_FROM,
};

/** The sheet, painted. Either reading, or one of its two empty states. */
export function renderSheet(overrides = {}) {
  const days = overrides.days ?? buildDays();
  return renderToStaticMarkup(
    React.createElement(ActivitySheet, {
      days,
      summary: buildSummary(days),
      window: WINDOW,
      metric: 'attendance',
      onMetric: () => {},
      ...overrides,
    })
  );
}
