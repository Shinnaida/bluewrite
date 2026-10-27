// BlueWrite — the activity sheet: one account's own year, drawn as squares.
//
// WHAT IT IS FOR. An administrator opens a colleague's account to answer a question the
// two lists under this could only answer by being read line by line: "is this person
// actually here?" A year of squares answers it in one glance — the pattern of days, the
// gaps, and whether the last gap is closing.
//
// PRESENTATIONAL, AND CONTROLLED. It fetches nothing (the container reads
// /users/:id/activity once, with the rest of the page) and it holds no state: which of the
// two readings is showing is a prop, so the same account can be rendered both ways in a
// test and so the choice survives moving to another colleague. The counting is the
// server's (see UsersController::activity) and the calendar arithmetic is
// src/lib/activitySheet.js's; what is left here is drawing.
//
// THE GRID IS ONE IMAGE TO A SCREEN READER, and that is a decision rather than a
// convenience. 371 squares are 371 stops on a keyboard, and a reader walked through a year
// one square at a time has been handed a spreadsheet instead of a picture. So the grid is
// `role="img"` with a label that states the span, the total and the busiest day, each
// square keeps a `title` for the pointer, and the DETAIL stays where it already is: the
// two lists below. Nobody is asked to tab through a calendar.
//
// WHAT THE SHADES MEAN is deliberately relative, and the page says so under the legend:
// the ramp is scaled to THIS account's busiest day, so two colleagues' sheets are not
// comparable square for square. The absolute numbers are in the line above the sheet,
// where they can be compared.

import React from 'react';
import {
  METRIC_INFO,
  METRICS,
  WEEKDAY_ROWS,
  basisNote,
  cellTitle,
  levelOf,
  metricValue,
  monthLabels,
  sheetLabel,
  summaryLine,
  toColumns,
  windowDays,
} from '../../lib/activitySheet.js';

/**
 * The sheet, drawn.
 *
 * `days` is the server's zero-filled series (Sunday first, one entry per day to the end of
 * the current week), `summary` is both readings' totals, and `window` carries the span and
 * the server's own today. `metric` / `onMetric` are the switch.
 */
export default function ActivitySheet({
  days = [],
  summary = null,
  window = {},
  metric = 'attendance',
  onMetric = () => {},
  loading = false,
  failed = null,
}) {
  const info = METRIC_INFO[metric] ?? METRIC_INFO.attendance;
  const columns = toColumns(days);
  const labels = monthLabels(columns);
  // The scale's ceiling in THIS reading's own unit — minutes for time, a count for
  // activity — read from the same block the sentence above the sheet is built from, so the
  // shades and the numbers cannot disagree about the busiest day.
  const busiest = info.kind === 'duration'
    ? Number(summary?.[info.summaryKey]?.busiest_minutes) || 0
    : Number(summary?.[info.summaryKey]?.busiest) || 0;
  const basis = basisNote(summary, window);

  return (
    // THE READING IS ON THE ROOT, and it is what chooses the ramp (`.sheet--attendance`
    // / `.sheet--activity`): the squares, the legend's samples and the pressed half of
    // the switch all read the same five variables, so the switch and the drawing can
    // never be two different colours at once.
    <div className={`sheet sheet--${metric}`}>
      <div className="sheet-head">
        {/* TWO READINGS OF THE SAME RECORD, and a switch rather than a second chart: they
            share a window, a grid and a legend, so drawing them apart would be two sheets
            of the same year. `aria-pressed` rather than a radio group because both buttons
            are always visible and one is always current — which is what a pressed state
            says and a radio does not. */}
        <div className="sheet-switch" role="group" aria-label="What the sheet counts">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              className="sheet-switch__btn"
              aria-pressed={m === metric}
              onClick={() => onMetric(m)}
            >
              {METRIC_INFO[m].label}
            </button>
          ))}
        </div>

        {/* The absolute numbers, in words: they are the half of this the colours cannot
            carry (see the relative-shading note on the legend). A read still in flight
            says so rather than printing zeroes — a zero drawn during a read is a number
            an administrator would believe. */}
        {failed ? (
          <p className="sheet-summary sheet-summary--failed">This account&rsquo;s activity could not be read.</p>
        ) : loading || days.length === 0 ? (
          <p className="sheet-summary" role="status">
            Reading their year&hellip;
          </p>
        ) : (
          <>
            <p className="sheet-summary">
              {summaryLine(summary, metric, window)}
              {windowDays(window) > 0 && windowDays(window) < 365 ? ` (${windowDays(window)} days)` : ''}
            </p>
            {/* MEASURED OR INFERRED, stated on the page rather than left to the colours.
                Two different kinds of number are drawn in one ramp — time the presence
                clock watched, and time worked out from sign-ins for the days before it
                existed — and an estimate that cannot be told from a measurement is the one
                thing this sheet must not do. `null` when every day is measured. */}
            {basis ? <p className="sheet-basis">{basis}</p> : null}
          </>
        )}
      </div>

      <div className="sheet-grid">
        {/* The weekday labels are the rows' names, three of the seven (see WEEKDAY_ROWS):
            the grid is 53 columns wide, and seven labels crowd the first one into a
            column of text. They are `aria-hidden` because the picture's label carries the
            meaning — a bare "Mon" beside an image announces nothing. */}
        <div className="sheet-days" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6].map((row) => {
            const named = WEEKDAY_ROWS.find((w) => w.index === row);
            return (
              <span key={row} className="sheet-days__cell">
                {named ? named.label : ''}
              </span>
            );
          })}
        </div>

        <div className="sheet-body">
          <div className="sheet-months" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns.length}, var(--sheet-cell))` }}>
            {columns.map((_, index) => (
              <span key={index} className="sheet-months__cell">
                {labels.get(index) ?? ''}
              </span>
            ))}
          </div>

          <div
            className="sheet-weeks"
            role="img"
            aria-label={sheetLabel(summary, metric, window)}
            style={{ gridTemplateColumns: `repeat(${columns.length}, var(--sheet-cell))` }}
          >
            {columns.map((column, columnIndex) => (
              <div className="sheet-week" key={columnIndex}>
                {column.map((day) => {
                  const value = metricValue(day, metric);
                  const future = Boolean(window.today) && day.date > window.today;
                  return (
                    <span
                      key={day.date}
                      className={`sheet-cell sheet-cell--l${future ? 0 : levelOf(value, busiest)}${future ? ' sheet-cell--future' : ''}`}
                      title={cellTitle(day, metric, window.today)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!failed && days.length > 0 && (
        <div className="sheet-foot">
          {/* The legend is a scale, not a key: it has to be read once and then never
              again, which is why it is four squares wide and says Less/More at its ends
              rather than naming a number per shade. */}
          <span className="sheet-foot__hint">
            Shading is scaled to this account&rsquo;s own busiest day, so two officers&rsquo;
            sheets are not comparable square for square.
          </span>
          {/* The reading's name rides on the legend as well as on the switch, because the
              two ramps are two colours: a reader looking at a picture of this sheet (in a
              handover, in a report) has to be able to tell "this officer signs in" from
              "this officer files things" without the label being cropped out. */}
          <span className="sheet-legend" aria-hidden="true">
            <span className="sheet-legend__name">{info.legend}</span>
            <span>Less</span>
            <span className="sheet-cell sheet-cell--l1" />
            <span className="sheet-cell sheet-cell--l2" />
            <span className="sheet-cell sheet-cell--l3" />
            <span className="sheet-cell sheet-cell--l4" />
            <span>More</span>
          </span>
        </div>
      )}
    </div>
  );
}
