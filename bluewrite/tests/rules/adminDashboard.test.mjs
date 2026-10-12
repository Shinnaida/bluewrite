// BlueWrite — the Admin dashboard's design, RENDERED (owner request, 2026-10-12).
//
// WHY THIS FILE RENDERS INSTEAD OF READING. The request was a drawing: four
// cards with tinted marks and a sparkline, a chart card headed by a mark and a
// sub-line with a corner control, a panel of recent records with status chips,
// and a summary strip whose arrows point the way each reading MOVES. Every one of
// those can be satisfied by source that paints nothing — an undefined path map, a
// card that comes out as an empty plate, a median whose fall is painted red
// because the arrow's direction was read as the reading's. So the pieces are
// bundled and rendered (renderHarness.mjs) and the assertions run over markup.
//
// WHAT THIS FILE IS NOT. It does not re-assert the chart internals
// (dashboardChart.test.mjs owns the stacked columns, the peek and the menus) and
// it does not re-assert the head's own layout rules (dashboardLayout.test.mjs).
// It covers the furniture this request added.
//
// LAST, AND THE POINT OF THE WHOLE FILE: the page is MOUNTED (renderDashboard),
// because a screen that throws on its first render passes every source test in
// this suite. Effects do not run under `renderToStaticMarkup`, so what is drawn is
// the loading state — which is exactly the state an Admin sees first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/adminDashboard.jsx');

test('the page mounts, and paints its head, its range card and its skeletons', async () => {
  const { renderDashboard } = await load();
  const html = renderDashboard();

  // The title and the reference's sub-line: a live dot, the station's own name
  // and the time it was last read.
  assert.match(html, /<h1>Dashboard<\/h1>/);
  assert.ok(html.includes('dash-live'), 'the sub-line lost its live dot');
  assert.ok(html.includes('Naga City Police Station'), 'the station’s own name is not in the sub-line');
  assert.ok(html.includes('Incident report overview'), 'the sub-line lost what the page reads');

  // …and the sub-line simply omits the station while Shell's letterhead read is
  // still in flight, rather than drawing a placeholder for it.
  const bare = renderDashboard({ stationName: null });
  assert.ok(!bare.includes('Naga City Police Station'));
  assert.ok(bare.includes('Incident report overview'));

  // THE RANGE CARD: the three fields the reference draws, each under its own
  // caption, inside the card the head carries.
  assert.ok(html.includes('dash-filters'), 'the range card is gone from the head');
  for (const label of ['>From<', '>To<', '>Incident type<']) {
    assert.ok(html.includes(label), `the range card lost the ${label} field`);
  }
  // And the two strips this dashboard already had are still in it — the presets
  // and the station/mine scope — because the card holds the page's whole range,
  // not only the reference's three fields.
  assert.ok(html.includes('dash-presets'), 'the range presets left the range card');
  assert.ok(html.includes('dash-scope'), 'the station/mine scope left the range card');

  // The first load draws SKELETONS rather than four empty cards: one per reading,
  // the trend panel's and the activity list's.
  const skeletons = html.match(/dash-kpi is-skeleton/g) ?? [];
  assert.equal(skeletons.length, 4, `the loading strip drew ${skeletons.length} skeletons, not four`);
  assert.ok(html.includes('dash-panel is-skeleton'), 'the trend panel drew no loading state');
  assert.match(html, /dash-activity__list is-skeleton/);
});

test('each reading is a card: a tinted mark, the caption, the number, one line', async () => {
  const { renderCards } = await load();
  const html = renderCards();

  // Four families, each named for the reading rather than for a colour, and the
  // drawing is INSIDE the mark (a mark that renders empty is the failure here).
  for (const family of ['blue', 'green', 'amber', 'violet']) {
    assert.ok(html.includes(`dash-kpi__mark--${family}`), `the ${family} reading lost its mark`);
  }
  const marks = html.match(/dash-kpi__glyph/g) ?? [];
  assert.equal(marks.length, 4, 'a reading’s mark is not drawn');
  // Every mark draws real geometry — not an empty <svg> from a missing path.
  assert.ok(
    (html.match(/<path d="M/g) ?? []).length >= 6,
    'the marks lost their paths: the drawing map came back empty',
  );

  // The readings themselves, in the reference's words.
  for (const label of ['Total reports', 'Needs attention', 'Finalized', 'Median draft to final']) {
    assert.ok(html.includes(label), `the ${label} card is missing`);
  }
  assert.match(html, /<span class="dash-kpi__value ">26<\/span>/);
  assert.match(html, /<span class="dash-kpi__value dash-kpi__value--time">2h 47m<\/span>/);

  // The sub-line under each number says what the number counts.
  assert.ok(html.includes('20 draft · 2 awaiting finalization'), 'the queue card lost the split inside it');
  assert.ok(html.includes('15% of reports in range'), 'the finalized card lost its share');

  // THE SPARKLINE: the range's own daily series, drawn as a polyline with one
  // point per day, and labelled for a reader who cannot see it.
  assert.ok(html.includes('dash-spark'), 'the total card lost its sparkline');
  assert.match(html, /aria-label="Reports per day in this range"/);
  const line = html.match(/points="([^"]+)"/);
  assert.ok(line, 'the sparkline has no line');
  assert.equal(line[1].trim().split(/\s+/).length, 30, 'the sparkline is not one point per day');

  // The ONE card that is also a control is the queue, and it is a real button
  // with a name for the pointer.
  assert.match(html, /<button type="button" class="dash-kpi dash-kpi--link"/);
  assert.ok(html.includes('Open the needs-attention queue in All Reports'));
  assert.equal(
    (html.match(/<button/g) ?? []).length,
    1,
    'a card that is not a control is being drawn as one',
  );
});

test('a change is drawn as an arrow, and the median reads a fall as the good direction', async () => {
  const { renderSummary } = await load();
  const html = renderSummary();

  // Four readings, and every one of them carries a measured change.
  assert.equal((html.match(/vs\. previous period/g) ?? []).length, 4);
  assert.match(html, />↑<\/span> 78%/, 'the total lost its rise');
  assert.match(html, />↑<\/span> 65%/);
  assert.match(html, />↑<\/span> 33%/);

  // THE ONE THAT MATTERS: the median FELL (42% faster) and is painted as the good
  // direction — a green arrow pointing down. Reading the sign as the sentiment
  // instead of the reading's own direction is the bug this asserts against.
  assert.match(
    html,
    /<span class="dash-kpi__delta is-up"><span aria-hidden="true">↓<\/span> 42% vs\. previous period<\/span>/,
    'a faster median is not drawn as the improvement it is',
  );

  // …and with nothing in the window before, a reading draws NO arrow rather than a
  // 0% that would read as "no change" — the figure simply stands alone.
  const noComparison = renderSummary({ medianPct: null });
  assert.equal(
    (noComparison.match(/vs\. previous period/g) ?? []).length,
    3,
    'a figure with nothing to compare against invented a percentage',
  );
  assert.ok(noComparison.includes('2h 47m'), 'the reading itself went with its arrow');
});

test('recent activity lists records, with their type mark and their state', async () => {
  const { renderActivity } = await load();
  const html = renderActivity();

  // One row per record, newest first, and each one names the record it opens.
  assert.equal((html.match(/dash-activity__row/g) ?? []).length, 4);
  assert.match(html, /title="Open report BW-0331"/);
  assert.ok(html.indexOf('Barangay San Isidro') < html.indexOf('Rizal Avenue'), 'the rows are not newest first');

  // The type's own mark, in the register's own hue family, drawn as geometry.
  assert.ok(html.includes('dash-activity__mark--violet'), 'a Theft lost the register’s own hue');
  assert.ok(html.includes('dash-activity__mark--blue'), 'a Traffic Accident lost its hue');
  assert.ok(html.includes('dash-activity__glyph'), 'the rows lost their type marks');

  // What the panel says about each row: what it was, where, and when.
  assert.ok(html.includes('Barangay San Isidro'));
  assert.ok(html.includes('12 Oct 2026, 18:42'), 'the row lost the minute it happened');

  // WHERE THE RECORD STANDS: three states, three chips, each one NAMED as well as
  // tinted — a chip that is only a colour is unreadable to a reader who cannot see
  // the difference between them.
  for (const [state, label] of [
    ['draft', 'Draft'],
    ['submitted', 'Awaiting Finalization'],
    ['finalized', 'Finalized'],
  ]) {
    assert.ok(html.includes(`dash-status--${state}`), `the ${label} chip lost its own state class`);
    assert.ok(html.includes(`>${label}<`), `the ${label} chip lost its words`);
  }

  // A row with no place recorded still draws: the meta line is the time, not a
  // dangling separator.
  assert.match(html, /<span class="dash-activity__meta">12 Oct 2026, 14:27<\/span>/);

  // The second way in, and the empty case: a range with nothing in it says so
  // rather than drawing an empty list.
  assert.ok(html.includes('View All'), 'the panel lost its way into the register');
  const empty = renderActivity({ reports: [] });
  assert.ok(empty.includes('dash-empty'), 'an empty range draws nothing at all');
  assert.ok(!empty.includes('dash-activity__row'), 'an empty range still draws rows');
});

test('the chart card is headed by its mark, its name and a corner control', () => {
  // THE ONE THING THIS FILE CANNOT RENDER. The chart card's head only exists in
  // the LOADED state (the page fetches on mount and effects do not run under
  // `renderToStaticMarkup`), and the card itself is a 500-line SVG component that
  // dashboardChart.test.mjs already covers. So the head and the corner control are
  // read from the source, and what is asserted is the arrangement the request
  // asked for: the mark, the name, the sub-line, and the control that gives the
  // chart the whole row.
  const src = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');

  assert.match(src, /title="Reports over time"/);
  assert.match(src, /mark=\{<BarsMark \/>\}/, 'the chart card lost its mark');
  assert.match(
    src,
    /sub="Number of incident reports per day"/,
    'the chart card lost the line under its name',
  );

  // The corner control is a STATE, not a dialog: it is pressed and unpressed, and
  // the row it changes is the grid the two cards share.
  assert.match(src, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(src, /className="dash-expand"/);
  assert.match(src, /aria-pressed=\{expanded\}/);
  assert.match(src, /onClick=\{\(\) => setExpanded\(\(v\) => !v\)\}/);
  assert.match(
    src,
    /dash-grid-main--split\$\{expanded \? ' is-expanded' : ''\}/,
    'the control is not wired to the row it expands',
  );

  // AND THE ACTIVITY PANEL IS IN THAT ROW — the two answer the same question at
  // two resolutions, which is why they share a line rather than stacking.
  const row = src.slice(src.indexOf('dash-grid-main--split'), src.indexOf('{/* ---- Status, beside the hour'));
  assert.match(row, /<RecentActivity/);
  assert.match(row, /onOpen=\{onOpenReport\}/, 'an activity row no longer opens its record');
});
