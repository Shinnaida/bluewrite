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

  // The title is removed (owner request, 2026-10-13), and so is the sub-line. Neither
  // must render.
  assert.ok(!html.includes('<h1>Dashboard</h1>'), 'the Dashboard title is back on the page');
  assert.ok(!html.includes('dash-sub'), 'the removed sub-line is still rendered');
  assert.ok(!html.includes('Incident report overview'), 'the removed sub-line text is still rendered');

  const bare = renderDashboard({ stationName: null });
  assert.ok(!bare.includes('Incident report overview'));

  // THE RANGE CARD IS REMOVED (owner request, 2026-10-13): the From, To, Incident
  // type, presets and Station/My reports controls are no longer drawn on the
  // dashboard. The page still reads its default range; only the controls are gone.
  assert.ok(!html.includes('dash-filters'), 'the range card is back on the dashboard');
  assert.ok(!html.includes('dash-presets'), 'the range presets are back on the dashboard');
  assert.ok(!html.includes('dash-scope'), 'the station/mine scope is back on the dashboard');
  for (const label of ['>From<', '>To<', '>Incident type<']) {
    assert.ok(!html.includes(label), `the ${label} filter is back on the dashboard`);
  }

  // The first load draws SKELETONS rather than empty cards: the Active Accounts
  // lanyard plate (the one MetricCard left — the hero Total plate draws its own
  // register shell), the trend panel's and the activity list's.
  const skeletons = html.match(/dash-kpi is-skeleton/g) ?? [];
  assert.equal(skeletons.length, 1, `the loading strip drew ${skeletons.length} skeletons, not one`);
  assert.ok(html.includes('dash-panel is-skeleton'), 'the trend panel drew no loading state');
  assert.match(html, /dash-activity__list is-skeleton/);
});

test('each reading is a card: a tinted disc, the caption, the number, one line', async () => {
  const { renderCards } = await load();
  const html = renderCards();

  // Two families, blue and yellow only (owner request, 2026-10-30) — the
  // number's echo wears it. No icon discs — the caption carries the card.
  for (const family of ['blue', 'gold']) {
    assert.ok(html.includes(`cmd-card--${family}`), `the ${family} reading lost its card`);
    assert.ok(!html.includes(`cmd-card__icon--${family}`), `the ${family} reading grew its disc back`);
  }
  assert.doesNotMatch(html, /cmd-card__icon/, 'the removed icon discs are back on the cards');

  // The readings themselves, in the reference's words. (Needs attention and
  // Median draft to final were removed on request; neither may come back.)
  for (const label of ['Total Reports', 'Finalized Reports']) {
    assert.ok(html.includes(label), `the ${label} card is missing`);
  }
  for (const label of ['Needs attention', 'Median draft to final']) {
    assert.ok(!html.includes(label), `the removed ${label} card is back on the strip`);
  }
  assert.match(html, /<span class="cmd-card__value">26<\/span>/);

  // NO foot lines (owner request, 2026-10-30): no change-against-the-period,
  // no "Not yet submitted", no standing line. Only the headcount keeps its
  // admin/officer line, which these two cards never had — yellow only,
  // sitting beside the number on its own line, each with its own person mark.
  assert.doesNotMatch(html, /vs\. previous period/, 'the removed change line is back on the cards');
  assert.ok(!html.includes('Not yet submitted'), 'the removed drafts line is back on the cards');
  assert.ok(!html.includes('— No change'), 'the removed standing line is back on the cards');
  assert.doesNotMatch(html, /cmd-card__foot/, 'a removed foot line is back on the cards');
  assert.ok(html.includes('cmd-card__value-row'), 'the value row is missing');
  const page = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');
  // Headcount split retired with the lanyard card (owner request): no role-coloured
  // split remains on the page — the Active Accounts plate draws lanyards instead.
  assert.doesNotMatch(page, /cmd-role cmd-role--/, 'a removed role split is back on the cards');
  assert.match(page, /cmd-active-lanyard-card/, 'the Active Accounts lanyard plate is missing');

  // NO MINIS: the cards are readings, not charts — no bars beside the numbers.
  assert.equal(
    (html.match(/cmd-mini__bar/g) ?? []).length,
    0,
    'the removed mini bars are back on the cards',
  );
  assert.doesNotMatch(html, /cmd-card__mini/, 'the removed mini slot is back on the cards');

  // NO card is a control: a card is a reading, so the row draws no buttons.
  assert.equal(
    (html.match(/<button/g) ?? []).length,
    0,
    'a card is still being drawn as a control',
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

test('recent activity lists records as compact cards: orange file, type pill, bold case number', async () => {
  const { renderActivity } = await load();
  const html = renderActivity();

  // One row per record, newest first, and each one names the record it opens.
  assert.equal((html.match(/dash-activity__row/g) ?? []).length, 4);
  assert.match(html, /title="Open report BW-0331"/);
  assert.ok(html.indexOf('Barangay San Isidro') < html.indexOf('Rizal Avenue'), 'the rows are not newest first');

  // The head is the name only — the sub-line is removed.
  assert.ok(!html.includes('Latest reports and system activities'), 'the removed head sub-line is back');

  // The reference's own row: the register's file logo (All Reports), the type
  // pill in the register's own hue family with its tracked capitals, and the
  // bold case number.
  assert.ok(html.includes('dash-activity__file'), 'the rows lost the register file logo');
  assert.ok(html.includes('dash-activity__type--violet'), 'a Theft lost the register’s own hue');
  assert.ok(html.includes('dash-activity__type--blue'), 'a Traffic Accident lost its hue');
  assert.ok(html.includes('dash-activity__type-text">Theft<'), 'the rows lost their type pills');
  assert.ok(html.includes('>BW-0331<'), 'the rows lost their bold case numbers');

  // What the panel says about each row: what it was, where, and when.
  assert.ok(html.includes('Barangay San Isidro'));
  assert.ok(html.includes('12 Oct 2026, 18:42'), 'the row lost the minute it happened');

  // WHERE THE RECORD STANDS: three states, three chips, each one NAMED as well as
  // tinted — a chip that is only a colour is unreadable to a reader who cannot see
  // the difference between them.
  for (const [state, label] of [
    ['draft', 'Draft'],
    ['submitted', 'Finalized'],
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

test('the chart card is headed by its name and the range control', () => {
  // THE ONE THING THIS FILE CANNOT RENDER. The chart card's head only exists in
  // the LOADED state (the page fetches on mount and effects do not run under
  // `renderToStaticMarkup`), and the card itself is a 500-line SVG component that
  // dashboardChart.test.mjs already covers. So the heads are read from the
  // source, and what is asserted is the arrangement the owner asked for: every
  // panel head is its name only — no mark, no sub-line (owner request,
  // 2026-10-30) — and the trend head keeps the colour key and the one range
  // control for the page.
  const src = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');

  // Every panel's own opening tag carries neither a mark nor a sub-line. Report
  // Status is no panel at all any more (owner request, 2026-10-30): its split
  // reads as two pills under the trend, and must not come back as a card.
  assert.doesNotMatch(src, /title="Report Status"/, 'the removed Report Status panel is back');
  for (const title of [
    'Reports Overview',
    'AI Insights',
    'Top Locations',
    'System Status',
  ]) {
    const at = src.indexOf(`title="${title}"`);
    assert.ok(at >= 0, `the ${title} panel is missing`);
    const head = src.slice(src.lastIndexOf('<Panel', at), src.indexOf('>', at));
    assert.doesNotMatch(head, /mark=\{/, `the ${title} head is drawing a mark again`);
    assert.doesNotMatch(head, /sub=/, `the ${title} head grew its sub-line back`);
  }
  // And the removed sub-lines read nowhere else either.
  for (const line of [
    'Number of incident reports per day',
    'Latest reports and system activities',
    'Draft vs filed in this range',
    'Advisory highlights from this range',
    'Distribution of reports',
    'Areas with most reports',
    'All systems operational',
  ]) {
    assert.ok(!src.includes(line), `the removed "${line}" line is back`);
  }
  // The AI source line with it: no connected badge, no from–to range.
  assert.doesNotMatch(src, /cmd-ai__source/, 'the removed AI source line is back');
  assert.ok(!src.includes('AI connected'), 'the removed AI badge is back');
  // AND THE CHIPS ARE REMOVED: no All-types row above the plot — each band tall
  // enough to hold it carries its incident type, written inside the column.
  assert.doesNotMatch(src, /<TypeChips/, 'the removed type chips are back above the chart');
  assert.doesNotMatch(src, /function TypeChips/, 'the removed TypeChips component is back');
  assert.match(src, /segTag\(b\.type/, 'the bands no longer write their incident type inside the column');
  // The head marks are gone with their heads: no mark components remain.
  for (const mark of ['ClockMark', 'BarsMark', 'TrioMark', 'PieMark', 'PinMark', 'ShieldMark']) {
    assert.doesNotMatch(src, new RegExp(`function ${mark}\\b`), `the removed ${mark} is back`);
    assert.doesNotMatch(src, new RegExp(`<${mark}[ />]`), `the ${mark} head mark is drawn again`);
  }

  // The range the head reads, in the head that reads it: the colour key and the
  // Last-5/7/14/30-days control share the head's aside, and the control is wired
  // to the preset that every fetch reads.
  // FIVE COLUMNS ON LOAD (owner request, 2026-10-30): the dashboard opens on
  // the last five days, and the control offers that window back once changed.
  assert.match(src, /<option value=\{5\}>Last 5 days<\/option>/, 'the Last-5-days window is not offered');
  assert.match(src, /const \[preset, setPreset\] = useState\(5\)/, 'the dashboard no longer opens on five columns');
  assert.match(src, /useState\(\(\) => datesForPreset\(5\)\)/, 'the opening window is not the last five days');
  // THE HERO CARDS READ THE REGISTER (owner request, 2026-10-30): Total,
  // Drafts and Finalized match All Reports whatever window the trend reads.
  assert.match(src, /data\?\.registerTotals \?\? k/, 'the hero cards no longer read the whole register');
  // AND THE RANGE MOVES ONLY THE CHART (owner request, 2026-10-30): the page
  // reads the register once, the trend re-reads its own window, and the stack
  // is ordered off the chart's payload — never the page's.
  assert.match(src, /const \[chartData, setChartData\] = useState\(null\)/, 'the trend lost its own window');
  assert.match(src, /series=\{chartData\?\.seriesOverTime \?\? \[\]\}/, 'the chart is not reading its own window');
  assert.match(src, /orderForDisplay\(chartData\?\.seriesByType\)/, 'the stack is ordered off the page, not the chart');
  assert.match(src, /loadPage\(\);\n        loadChart\(\);/, 'retry does not re-read both halves');
  // THE STATUS SPLIT READS AS PILLS UNDER THE TREND (owner request,
  // 2026-10-30): the split sits inside the Reports Overview panel — between
  // the trend's own head and the duo row — drawn as pills, not bars.
  const trendBlock = src.slice(src.indexOf('title="Reports Overview"'), src.indexOf('title="AI Insights"'));
  assert.match(trendBlock, /<StatusBars status=\{data\?\.statusBreakdown\} \/>/, 'the status split is not under the trend');
  assert.match(src, /cmd-statuspills/, 'the status split is not drawn as pills');
  assert.doesNotMatch(src, /dash-grid-duo/, 'the emptied duo row is still drawn');
  const css2 = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.ok(css2.includes('cmd-statuspills'), 'the pills lost their stylesheet');
  // AND THE FOOT IS TRIMMED: the plot reserves 16px — not 26 — under the axis,
  // and the card's own bottom padding is cut, so no empty band sits there.
  assert.match(src, /b: 16/, 'the plot still reserves its old foot under the axis');
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.ok(
    css.includes('.dash-grid-main--split > .dash-panel:first-child'),
    'the trend card lost its trimmed foot',
  );
  assert.match(src, /<ChartKey byType=\{chartTypes\} \/>/);
  assert.match(src, /<RangeSelect preset=\{preset\} onPick=\{applyPreset\} \/>/);
  assert.match(src, /const applyPreset = \(days\) => \{[\s\S]{0,120}?setPreset\(days\)/);

  // NO corner control any more: the trend takes the row's wide column at every
  // range, so there is nothing to expand — and no state for it.
  assert.doesNotMatch(src, /dash-expand/, 'the removed corner control is back');
  assert.doesNotMatch(src, /setExpanded/, 'the removed expand state is back');

  // AND THE ACTIVITY PANEL IS IN THAT ROW — the two answer the same question at
  // two resolutions, which is why they share a line rather than stacking — and
  // it now reads the audit feed too, not only the records.
  const row = src.slice(src.indexOf('dash-grid-main--split'), src.indexOf('dash-grid-trio'));
  assert.match(row, /<RecentActivity/);
  assert.match(row, /events=\{data\?\.recentActivity\}/, 'the activity panel no longer reads the audit feed');
  assert.match(row, /onOpen=\{onOpenReport\}/, 'an activity row no longer opens its record');
});

test('the trio answers three questions: kind, place, pulse — above the brief', async () => {
  // The status pie and the hour chart are gone (owner request, 2026-10-26): the
  // trend's own head already carries the range, and this row is the reference's
  // Incident Types, Top Locations and System Status.
  const src = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');
  // Incident Types lives in the Total Reports hero plate (owner request,
  // 2026-10-30), not as its own trio panel — the trio is place + pulse.
  for (const title of ['Top Locations', 'System Status']) {
    assert.match(src, new RegExp(`title="${title}"`), `the ${title} panel is missing`);
  }
  assert.match(src, /cmd-total-types/, 'the Incident Types hero strip is missing');
  assert.match(src, /<TypeDonut slices=\{donutRows\}[^>]*\/>/);
  assert.match(src, /<LocationBars places=\{/);
  assert.match(src, /<SystemGrid system=\{/);
  // ORDER (owner request, 2026-10-30): the register's own facts read first,
  // the analyst's advice after them — trio above, brief below.
  assert.ok(
    src.indexOf('dash-grid-trio') < src.indexOf('title="AI Insights"'),
    'the brief is still sitting above the trio',
  );
  // THE BRIEF DRESSES LIKE ITSELF: the violet-tinted panel and the tabbed
  // slips, not a fourth white card.
  assert.match(src, /<Panel title="AI Insights" className="dash-panel--ai">/, 'the brief lost its own panel');
  const briefCss = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.ok(briefCss.includes('dash-panel--ai'), 'the brief lost its tinted panel');
  assert.ok(briefCss.includes('cmd-ai__list li::before'), 'the slips lost their violet tabs');
  assert.doesNotMatch(src, /title="Status breakdown"/, 'the status pie is back');
  assert.doesNotMatch(src, /title="Reports by hour"/, 'the hour chart is back');

  // RENDERED, with the shapes the endpoint really sends: the donut names every
  // slice with its count and its share, the places draw the busiest street
  // longest, and the system grid names its four services with icon, label and
  // their Online state (owner request, 2026-10-30).
  const { renderTrio } = await load();
  const html = renderTrio();
  for (const label of ['Traffic Accident', 'Theft', 'Others']) {
    assert.ok(html.includes(label), `the donut lost its ${label} slice`);
  }
  assert.ok(html.includes('50%'), 'the busiest slice lost its share');
  assert.ok(html.includes('National Highway'), 'the places lost their busiest street');
  assert.match(html, /width: ?100%/, 'the busiest street is not drawn longest');
  // Four boxes, each naming its service — and silence where the chorus was.
  assert.equal((html.match(/cmd-sys__box--/g) ?? []).length, 4, 'the grid does not draw four boxes');
  for (const label of ['Database', 'AI Service', 'File Storage', 'Notification']) {
    assert.ok(html.includes(label), `the grid lost its ${label} box`);
  }
  assert.ok(html.includes('Online'), 'the grid no longer names which services are online');
  assert.ok(!html.includes('All systems operational'), 'the removed summary line is back on the grid');
  assert.doesNotMatch(html, /cmd-sys__head/, 'the removed grid head is back');
  assert.doesNotMatch(html, /cmd-sys__badge/, 'the removed grid badge is back');
});
