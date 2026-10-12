// BlueWrite — the Report Register's FOLDERS, as data.
//
// Three things here can go wrong quietly and none of them throws:
//
//   1. the type→icon map can MISS one of the fourteen incident types, and the
//      only symptom is the opened folder wearing the generic glyph — which looks
//      like a styling choice rather than a bug;
//   2. a shelf can drop a status. "Submitted is draft + submitted + finalized"
//      is the register's own rule, and a report filed under a status the shelf
//      does not claim would simply not appear on any shelf — a register losing
//      a report with nothing said;
//   3. a folder can promise a count the list inside it will not deliver, which
//      is why the count and the list are folded through the same rule.
//
// The drawings (ReportTypeIcon.jsx) are checked for COVERAGE only: every key the
// map can produce must have a glyph, and every glyph must be reachable — a glyph
// nothing references is a rule that can only be dead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFixture } from './renderHarness.mjs';
import { INCIDENT_TYPES } from '../../src/lib/incidentTypes.js';
import {
  TYPE_ICON,
  DEFAULT_ICON,
  TYPE_HUE,
  DEFAULT_HUE,
  typeHue,
  UNCLASSIFIED_TYPE,
  STATUS_BUCKETS,
  FINALIZED_LABEL,
  statusText,
  typeIcon,
  reportNumber,
  statusBucket,
  shelvesFor,
  buildShelves,
  defaultShelfKey,
  shelfInView,
  folderAriaLabel,
  folderHint,
  folderTrail,
  reportAriaLabel,
  reportHint,
  draftEditLabel,
  ALL_LABEL,
  ALL_SHELF,
  SORT_ORDERS,
  DEFAULT_SORT,
  sortOrder,
  sortNote,
} from '../../src/lib/reportFolder.js';

const component = readFileSync(
  new URL('../../src/components/ReportTypeIcon.jsx', import.meta.url),
  'utf8',
);
const folder = readFileSync(
  new URL('../../src/components/GlassFolder.jsx', import.meta.url),
  'utf8',
);
const list = readFileSync(
  new URL('../../src/components/ReportList.jsx', import.meta.url),
  'utf8',
);
const reports = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const shell = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
// The server, as TEXT — the one place a rule of the search box's own promise is
// kept (a report NUMBER has to find its report; see the assertions at the end of
// the rail test), and the house's way of pinning a PHP rule from the JS suite.
const controller = readFileSync(
  new URL('../../app/controllers/ReportsController.php', import.meta.url),
  'utf8',
);

// The register's FILE panel, as a DRAWING rather than as text (see the fixture):
// every test below that names ReportFiles reads its source, and text cannot see a
// component that throws — which is what the panel did the day a prop was named in
// its JSX and never destructured.
const loadRegisterFiles = () => loadFixture('tests/fixtures/registerFiles.jsx');

/** The keys the icon component can actually draw. */
const glyphKeys = [...component.matchAll(/\n  '?([a-z][a-z-]*)'?: \(/g)].map((m) => m[1]);

const TYPES = [...INCIDENT_TYPES];

/** Every report the server's tally counted — the oracle the shelves are folded
 *  against. Summed here rather than read from the module: the module has no
 *  `tallyTotal` any more (nothing in the app called it — see reportFolder.js),
 *  and a test that sums the way the code does cannot catch the code summing
 *  wrong. */
const counted = (tally) => tally.reduce((n, row) => n + row.count, 0);

test('every incident type has an icon, and no icon is dead', () => {
  // An OPENED folder wears its type's glyph in the trail (the folder face itself
  // carries none), so the map has to answer for all fourteen — a missing entry
  // would silently reuse the "Other Incident" glyph for a Theft folder.
  for (const type of INCIDENT_TYPES) {
    assert.ok(TYPE_ICON[type], `no icon mapped for incident type: ${type}`);
  }
  assert.ok(glyphKeys.length >= INCIDENT_TYPES.length, 'the component is missing glyphs');

  // Coverage the other way: the map may only name keys the component draws...
  for (const key of Object.values(TYPE_ICON)) {
    assert.ok(glyphKeys.includes(key), `mapped icon "${key}" has no glyph in ReportTypeIcon.jsx`);
  }
  assert.ok(glyphKeys.includes(DEFAULT_ICON), 'the fallback glyph must exist');
  // ...and every glyph must be reachable from the map, or be the fallback. There
  // is no third case any more: the shelf tabs draw their own marks (see
  // SHELF_GLYPHS in Reports.jsx) and the one glyph that existed for a shelf the
  // type map could not name — the Recent folder's clock — went with that shelf.
  for (const key of glyphKeys) {
    assert.ok(
      Object.values(TYPE_ICON).includes(key) || key === DEFAULT_ICON,
      `glyph "${key}" is never referenced — dead drawing`,
    );
  }

  // Every entry maps to a distinct key, so the folders do not all read alike.
  const keys = Object.values(TYPE_ICON);
  assert.equal(new Set(keys).size, keys.length, 'two types share one glyph');
});

test('an unmapped or legacy type wears the generic glyph', () => {
  assert.equal(typeIcon('Barangay Dispute'), DEFAULT_ICON);
  assert.equal(typeIcon('Other'), DEFAULT_ICON);
  assert.equal(typeIcon(undefined), DEFAULT_ICON);
  assert.equal(typeIcon('Theft'), TYPE_ICON['Theft']);
  assert.equal(typeIcon('Traffic Accident'), 'car');
});

test('every incident type reads in one of the five families the row draws', () => {
  // THE REGISTER ROW OPENS WITH THE TYPE AS A TINTED CHIP (owner request,
  // 2026-10-08), and the colour is a coarse FAMILY rather than a colour per type
  // — see TYPE_HUE. Two things have to hold for that chip to be worth drawing:
  // every type the station can record has a family, and every family the map
  // names is a class the stylesheet actually declares. A hue with no rule is not
  // a missing colour, it is FOUR families silently drawing in the fallback, which
  // is exactly the kind of failure a test reads better than an eye.
  const HUE_CLASSES = ['blue', 'violet', 'red', 'amber', 'slate'];
  for (const type of INCIDENT_TYPES) {
    assert.ok(TYPE_HUE[type], `no colour family mapped for incident type: ${type}`);
    assert.ok(HUE_CLASSES.includes(TYPE_HUE[type]), `${type} names an undeclared family`);
  }
  for (const hue of HUE_CLASSES) {
    const rule = styles.match(new RegExp(`\\.report-row__type--${hue}\\s*\\{[^}]*\\}`));
    assert.ok(rule, `.report-row__type--${hue} is not declared in the stylesheet`);
    assert.match(rule[0], /--ir-type-wash:/, `${hue} states no wash`);
    assert.match(rule[0], /--ir-type-ink:/, `${hue} states no ink`);
  }

  // GREEN IS DELIBERATELY NOT ONE OF THEM. --green-ok means a STATE everywhere in
  // this app (active, finalized, verified), so a green type chip beside a green
  // Finalized badge would be two unrelated facts wearing one colour.
  assert.ok(!Object.values(TYPE_HUE).includes('green'), 'green has been spent on a type');
  assert.ok(!HUE_CLASSES.includes('green'));

  // The three types the owner's reference happens to draw map to exactly the
  // three hues it draws them in — the chip is that design, not a near-miss.
  assert.equal(typeHue('Traffic Accident'), 'blue');
  assert.equal(typeHue('Missing Person'), 'amber');
  assert.equal(typeHue('Robbery'), 'violet');

  // TOTAL, like `typeIcon` and for the same reason: a station can add a type.
  assert.equal(typeHue('Barangay Dispute'), DEFAULT_HUE);
  assert.equal(typeHue(undefined), DEFAULT_HUE);
  assert.equal(typeHue('Other Incident'), TYPE_HUE['Other Incident']);
});

test('the report number is spelled one way, zero-padded to four', () => {
  assert.equal(reportNumber(319), 'BW-0319');
  assert.equal(reportNumber(1), 'BW-0001');
  assert.equal(reportNumber(12345), 'BW-12345');
  // The row and the menu must not be able to disagree about the number.
  assert.match(list, /reportNumber\(report\.id\)/);
  assert.match(list, /`Actions for report \$\{num\}`/);
});

// ---------------------------------------------------------------------------
// The shelves
// ---------------------------------------------------------------------------

test('the shelf is the stage of the work, not the exact status', () => {
  // A draft is still the officer's to finish; everything else has gone forward.
  // This is the ONE rule the server's tally is folded through, so the count on
  // a folder face and the rows inside it cannot come from two different ideas
  // of what "Submitted" means.
  assert.equal(statusBucket('draft'), 'draft');
  assert.equal(statusBucket('submitted'), 'submitted');
  assert.equal(statusBucket('finalized'), 'submitted');
  // TOTAL: a status this build has never heard of lands somewhere rather than
  // vanishing from a view that has no row for it.
  assert.equal(statusBucket(''), 'submitted');
  assert.equal(statusBucket(undefined), 'submitted');
  assert.equal(statusBucket('ESCALATED'), 'submitted');
  assert.equal(statusBucket('DRAFT'), 'draft');

  assert.deepEqual(STATUS_BUCKETS.map((s) => s.key), ['draft', 'submitted']);
  assert.deepEqual(STATUS_BUCKETS.map((s) => s.label), ['Draft', 'Submitted']);

  // ...AND THE OFFICER'S OWN WORD FOR THAT SHELF (owner request, 2026-10-13):
  // the TAB is renamed, the bucket it holds is not — same keys, same data, so a
  // rename can never move a report. An Admin's All Reports keeps the three
  // statuses, because a review queue IS the difference between them.
  assert.deepEqual(shelvesFor({ officer: true }).map((s) => s.label), ['All Reports', 'Draft', 'Finalized']);
  assert.deepEqual(shelvesFor({ officer: true }).map((s) => s.key), ['all', 'draft', 'submitted']);
  assert.deepEqual(shelvesFor({}).map((s) => s.label), ['All Reports', 'Draft', 'Submitted']);
});

test('the officer reads two words for a status, and the Admin reads three', () => {
  // THE OFFICER NEVER READS "SUBMITTED" (owner request, 2026-10-13: "remove
  // submitted — all data in it should be in finalized"). The word itself is
  // decided in ONE place, which is what keeps a row, the sheet it opens, the tab
  // above them and the filter under them from disagreeing.
  assert.equal(statusText('submitted', { officer: true }), 'finalized');
  assert.equal(statusText('finalized', { officer: true }), 'finalized');
  assert.equal(statusText('draft', { officer: true }), 'draft');
  // Only the two SENT states fold: a status this build has never heard of is
  // shown as it arrived rather than being called finalized.
  assert.equal(statusText('ESCALATED', { officer: true }), 'escalated');
  assert.equal(statusText('', { officer: true }), '');
  assert.equal(statusText(undefined, { officer: true }), '');
  // The Admin — whose queue is the difference — reads the raw status.
  assert.equal(statusText('submitted'), 'submitted');
  assert.equal(statusText('FINALIZED'), 'finalized');
  assert.equal(FINALIZED_LABEL, 'Finalized');
});

test('the officer’s filtered list asks for the set its shelf holds', () => {
  // `filed` is the value the officer's Status filter sends. It has to be the
  // BUCKET's own set, or a report could sit on the officer's shelf and be missing
  // from the list under it — so the two are stated together here and in the
  // controller's own pipeline
  assert.match(
    controller,
    /\$status === 'filed'[\s\S]{0,120}r\.status IN \('submitted', 'finalized'\)/,
    'the server no longer reads the officer\'s `filed` as the sent set',
  );
  // The option offers the officer's word and no third one, while All Reports
  // keeps both statuses for the Admin.
  assert.match(reports, /<option value="filed">\{FINALIZED_LABEL\}<\/option>/);
  assert.match(
    reports,
    /<option value="submitted">Submitted<\/option>[\s\S]{0,90}<option value="finalized">Finalized<\/option>/,
    'the Admin lost the two statuses they review apart',
  );
  assert.match(reports, /Needs attention \(draft \+ not finalized\)/);
  assert.match(reports, /Needs attention \(draft \+ submitted\)/);
  // The row badge and the sheet's badge both read the one word — the officer's
  // register and the panel a row opens cannot say different things.
  assert.match(list, /statusText\(report\.status, \{ officer \}\)/);
  assert.match(reports, /statusText\(sheetReport\.status, \{ officer \}\)/);
  // The badge's CLASS stays the raw status, so the colour of a state does not
  // move when its word does (styles.css declares one per status).
  assert.match(list, /className=\{`badge \$\{report\.status\}`\}/);
});

test('the mode decides the shelves: three for the register, one for the archive', () => {
  // ALL REPORTS first, then the two shelves that split it. The two splits are
  // BUCKETS (no `all`): only the shelf that holds everything carries the flag.
  assert.deepEqual(shelvesFor({}).map((s) => s.key), ['all', 'draft', 'submitted']);
  assert.deepEqual(shelvesFor({}).map((s) => Boolean(s.all)), [true, false, false]);
  assert.deepEqual(shelvesFor({}).map((s) => Boolean(s.list)), [true, false, false]);
  // The archive and the translation queue draw ONE shelf holding everything:
  // an archived report was archived whatever it was, and a report awaiting a
  // translation review is waiting on a language, not on a stage.
  const archived = shelvesFor({ archived: true });
  assert.equal(archived.length, 1);
  assert.equal(archived[0].key, 'archived');
  assert.equal(archived[0].all, true);
  const awaiting = shelvesFor({ awaiting: true });
  assert.equal(awaiting.length, 1);
  assert.equal(awaiting[0].key, 'awaiting');
  assert.equal(awaiting[0].all, true);
});

test('a tally becomes shelves of folders, in the station’s own type order', () => {
  const tally = [
    { status: 'draft', incident_type: 'Theft', count: 2 },
    { status: 'draft', incident_type: 'Fire Incident', count: 1 },
    { status: 'submitted', incident_type: 'Theft', count: 3 },
    // A shelf that is not a bucket holds several statuses of one type, which
    // have to become ONE folder.
    { status: 'finalized', incident_type: 'Theft', count: 1 },
    { status: 'draft', incident_type: 'Barangay Dispute', count: 4 },
    { status: 'draft', incident_type: '', count: 1 },
  ];
  const shelves = buildShelves(tally, { shelves: shelvesFor({}), typeOrder: TYPES });

  // ALL REPORTS HEADS THE ORDINARY REGISTER (owner request, 2026-10-07), and it
  // is the whole set: its total is every counted report, whatever the status.
  assert.deepEqual(shelves.map((s) => s.key), ['all', 'draft', 'submitted']);
  assert.equal(shelves[0].total, counted(tally));
  assert.equal(shelves[0].label, ALL_LABEL);
  const [, draft, submitted] = shelves;

  // Draft: Theft heads INCIDENT_TYPES, Fire Incident follows the others, and the
  // unranked pair (the station's own type, then the blank one) come last.
  assert.deepEqual(draft.folders.map((f) => f.type), [
    'Theft',
    'Fire Incident',
    'Barangay Dispute',
    UNCLASSIFIED_TYPE,
  ]);
  assert.deepEqual(draft.folders.map((f) => f.count), [2, 1, 4, 1]);
  assert.equal(draft.total, 8);

  // Submitted: the two statuses of Theft folded into one folder. A finalized
  // report is on this shelf, which is the whole point of the bucket.
  assert.deepEqual(submitted.folders, [{ type: 'Theft', count: 4 }]);
  assert.equal(submitted.total, 4);

  // Every shelf is returned even when empty ("nothing in drafts" is a fact worth
  // stating), and a type with no rows is absent rather than an empty folder.
  const empty = buildShelves([], { shelves: shelvesFor({}), typeOrder: TYPES });
  assert.equal(empty.length, 3);
  assert.deepEqual(empty.map((s) => s.folders), [[], [], []]);
  assert.deepEqual(empty.map((s) => s.total), [0, 0, 0]);

  // Nothing is lost, and nothing is counted twice: the two BUCKETS add up to the
  // whole, and ALL REPORTS is that same whole under one tab.
  assert.equal(counted(tally), shelves.filter((s) => !s.all).reduce((n, s) => n + s.total, 0));
  assert.equal(shelves[0].total, counted(tally));
  assert.deepEqual(buildShelves(null, { shelves: shelvesFor({}) })[0].folders, []);
});

test('the register opens on the shelf that holds something', () => {
  // The shelves are TABS (owner request, 2026-10-07), so exactly one is on screen
  // and the register has to decide which. The rule is the officer's own desk
  // rather than the list's order: a shelf with nothing in it would open the
  // register on a screen with one sentence on it.
  const shelves = [
    { key: 'all', label: ALL_LABEL, total: 0, folders: [] },
    { key: 'draft', label: 'Draft', total: 6, folders: [{ type: 'Theft', count: 6 }] },
    { key: 'submitted', label: 'Submitted', total: 1, folders: [{ type: 'Robbery', count: 1 }] },
  ];
  assert.equal(defaultShelfKey(shelves), 'draft');
  // An empty register still has a tab to stand on — the first shelf it draws —
  // because a strip with nothing selected is not a strip.
  assert.equal(
    defaultShelfKey([
      { key: 'all', folders: [], total: 0 },
      { key: 'draft', folders: [], total: 0 },
    ]),
    'all',
  );
  // THE ALL SHELF HOLDS FILES, NOT FOLDERS, so its own total is what says whether
  // it holds anything — the count is the only signal it has. Any report at all
  // lands the officer on it, which is where the register's first line of answer is.
  assert.equal(defaultShelfKey([{ key: 'all', total: 9, folders: [] }, shelves[1]]), 'all');
  // TOTAL: a shelf whose folders and count are missing counts as empty, an empty
  // list has no resting tab at all, and rubbish is not a crash.
  assert.equal(defaultShelfKey([{ key: 'draft' }, { key: 'submitted', folders: [] }]), 'draft');
  assert.equal(defaultShelfKey([]), null);
  assert.equal(defaultShelfKey(null), null);
  assert.equal(defaultShelfKey([{ folders: [] }]), null);
});

test('the shelf in view is the officer’s tab, or the rule’s when it is gone', () => {
  // One resolver, read by BOTH callers — the strip that draws the tab and the
  // register that decides whether to ask for files or for a tally — so the lit tab
  // and the panel under it are the same shelf by construction.
  const shelves = [
    { key: 'all', label: ALL_LABEL, list: true, total: 4, folders: [] },
    { key: 'draft', label: 'Draft', total: 3, folders: [{ type: 'Theft', count: 3 }] },
  ];
  assert.equal(shelfInView(shelves, 'draft').key, 'draft');
  assert.equal(shelfInView(shelves, 'all').key, 'all');
  // A tab that is no longer drawn (the mode changed under it) falls back to the
  // rule rather than to nothing.
  assert.equal(shelfInView(shelves, 'archived').key, 'all');
  assert.equal(shelfInView(shelves, null).key, 'all');
  assert.equal(shelfInView([], 'all'), null);
  assert.equal(shelfInView(null, null), null);
});

test('All Reports is the whole register as files, and it says in what order', () => {
  // "By file, not by folder" (owner request, 2026-10-07): the shelf carries
  // REPORTS, so what separates it from every other shelf is the fold's own `list`
  // — and the flag has to SURVIVE the folding, or the register would draw a grid
  // of folders for a shelf that is meant to be a list of reports.
  assert.equal(ALL_SHELF.list, true);
  assert.equal(ALL_SHELF.all, true);
  assert.equal(ALL_SHELF.note, 'Newest first');
  const [all] = buildShelves(
    [
      { status: 'draft', incident_type: 'Theft', count: 2 },
      { status: 'finalized', incident_type: 'Robbery', count: 1 },
    ],
    { shelves: shelvesFor({}), typeOrder: TYPES },
  );
  assert.equal(all.key, 'all');
  assert.equal(all.label, 'All Reports');
  assert.equal(all.list, true);
  assert.equal(all.note, 'Newest first');
  assert.equal(all.total, 3);
});

test('the archive shelf folds every status of a type into one folder', () => {
  const shelves = buildShelves(
    [
      { status: 'submitted', incident_type: 'Robbery', count: 1 },
      { status: 'finalized', incident_type: 'Robbery', count: 2 },
      { status: 'draft', incident_type: 'Robbery', count: 1 },
    ],
    { shelves: shelvesFor({ archived: true }), typeOrder: TYPES },
  );
  assert.equal(shelves.length, 1);
  assert.deepEqual(shelves[0].folders, [{ type: 'Robbery', count: 4 }]);
  assert.equal(shelves[0].total, 4);
});

// ---------------------------------------------------------------------------
// The sentences
// ---------------------------------------------------------------------------

test('a folder says what it is and how much is in it', () => {
  assert.equal(folderAriaLabel('Theft', 3), 'Open the Theft folder — 3 reports');
  assert.equal(folderAriaLabel('Theft', 1), 'Open the Theft folder — 1 report');
  // A count the register cannot have (a failed request) reads as none rather
  // than as "NaN reports".
  assert.equal(folderAriaLabel('Theft'), 'Open the Theft folder — 0 reports');
  assert.equal(folderAriaLabel('Theft', null), 'Open the Theft folder — 0 reports');
  assert.match(folderHint('Theft', 3), /^Open Theft — 3 reports$/);
});

test('the trail out of a folder names the list, the shelf and the folder', () => {
  assert.deepEqual(folderTrail('My Reports', 'Draft', 'Theft'), ['My Reports', 'Draft', 'Theft']);
  assert.deepEqual(folderTrail('All Reports', 'Archived', 'Robbery'), [
    'All Reports',
    'Archived',
    'Robbery',
  ]);
  // A missing crumb is dropped rather than left as a dangling separator.
  assert.deepEqual(folderTrail('My Reports', '', 'Theft'), ['My Reports', 'Theft']);
});

test('a row announces exactly the action the list will perform', () => {
  const r = { id: 319, incident_type: 'Theft' };
  const dateText = 'Sep 12, 2026';

  // The click shows the SHEET (owner request, 2026-10-06), so that is what the
  // row promises — for every status, because reading a record is not an edit.
  assert.equal(
    reportAriaLabel(r, { dateText }),
    'View the sheet for report BW-0319, Theft, Sep 12, 2026',
  );
  // Finalized, non-admin: locked. The sheet still opens — the pencil is what is
  // gone — and the row says so rather than refusing to open at all.
  assert.equal(
    reportAriaLabel(r, { dateText, locked: true }),
    'View the sheet for report BW-0319, Theft, Sep 12, 2026 — finalized, locked',
  );
  // The archive speaks of RESTORING, and only when that is actually offered.
  assert.equal(
    reportAriaLabel(r, { dateText, archived: true, canRestore: true }),
    'Restore archived report BW-0319, Theft, Sep 12, 2026',
  );
  assert.equal(
    reportAriaLabel(r, { dateText, archived: true, canRestore: false }),
    'Archived report BW-0319, Theft, Sep 12, 2026',
  );
  assert.equal(reportAriaLabel(r, { dateText, canOpen: false }), 'Report BW-0319, Theft, Sep 12, 2026');
  // A missing date must not leave a dangling comma.
  assert.equal(reportAriaLabel(r), 'View the sheet for report BW-0319, Theft');
  // An archived report is never announced as a view, whether or not it restores:
  // the archive's one action is Restore.
  assert.doesNotMatch(
    reportAriaLabel(r, { dateText, archived: true, canRestore: true }),
    /Open|View the sheet/,
  );
});

test('the hover hint names the same state as the label', () => {
  assert.equal(reportHint({}), 'Click to view the sheet · use More for actions');
  assert.match(reportHint({ locked: true }), /view the sheet/i);
  assert.match(reportHint({ locked: true }), /finalized/i);
  assert.equal(reportHint({ archived: true, canRestore: true }), 'Archived — use More to restore');
  assert.equal(reportHint({ archived: true }), 'Archived report');
  assert.equal(reportHint({ canOpen: false }), 'Use More for actions');
  // The hint points at the More pill rather than the right-click, because the
  // button is now the only affordance the officer can be told about in words
  // (owner request, 2026-10-07: the pill carries the name, not the ⋮ glyph).
  assert.match(reportHint({}), /More/);
  assert.doesNotMatch(reportHint({}), /right-click/i);
});

test('the draft Edit affordance says what it will do, and that it asks first', () => {
  assert.equal(draftEditLabel(319), 'Edit draft report BW-0319');
  // The row only offers it for a draft (see ReportsTable's rowMeta) — asserted
  // here so the button and the rule cannot drift.
  assert.match(reports, /canEdit: !showArchived && statusBucket\(r\.status\) === 'draft'/);
  assert.match(list, /meta\.canEdit && \(/);
});

// ---------------------------------------------------------------------------
// The markup and the stylesheet
// ---------------------------------------------------------------------------

test('the folder is one button, with no icon and no card around it', () => {
  // A single click/Enter/Space opens: a <button> is what makes that true for the
  // keyboard and gives the focus ring. The whole folder is that one control.
  assert.match(folder, /className="glass-folder__open"/);
  assert.match(folder, /<button[\s\S]*?className="glass-folder__open"/);
  assert.match(folder, /aria-label=\{folderAriaLabel\(/);
  assert.match(folder, /onClick=\{\(\) => onOpen\?\.\(type\)\}/);

  // The three sheets and the two tabs, which is what makes it a folder.
  for (const n of [1, 2, 3]) {
    assert.ok(folder.includes(`glass-folder__sheet glass-folder__sheet--${n}`), `missing sheet ${n}`);
  }
  assert.match(folder, /className="glass-folder__back"/);
  assert.match(folder, /className="glass-folder__front"/);

  // NO icon on the face, and no card wrapper: the type name is the label, and
  // the folder sits directly on the page (see the shelf's own flex row).
  assert.doesNotMatch(folder, /<ReportTypeIcon/);
  assert.doesNotMatch(folder, /report-folder/);
  // The label is bottom-left and the count rides with it.
  assert.match(folder, /className="glass-folder__label"/);
  assert.match(folder, /className="glass-folder__count"/);
});

test('an opened folder lists its reports as real rows with their actions', () => {
  // A row's whole left side opens the report; the ⋮ is a SIBLING control (a
  // button cannot legally nest in a button), independently focusable.
  assert.match(list, /className="report-row__open"/);
  assert.match(list, /className="report-row__menu"/);
  assert.match(list, /aria-haspopup="menu"/);
  assert.match(list, /onContextMenu=\{/);
  assert.match(list, /e\.shiftKey && e\.key === 'F10'/);
  // A locked row must not open on click even though it stays focusable.
  // The whole report travels with the click: the sheet page names the record off
  // the row it was opened from (see the register's openSheet).
  assert.match(list, /if \(meta\.canOpen\) onOpen\?\.\(report\)/);
  // The status and translation badges are the app's own, reused not restyled.
  assert.match(list, /className=\{`badge \$\{report\.status\}`\}/);
  assert.match(list, /rv-badge rv-badge--sm/);

  // THE TYPE LEADS THE ROW, AS A CHIP (owner request, 2026-10-08). The reference
  // the owner sent draws the incident type as a tinted chip with its glyph at
  // the head of the card, so the row opens with it: the glyph comes from the
  // type's own map, the family from the map beside it, and the plain grey type
  // line that used to sit under the number is GONE — one statement of the type,
  // in the chip, not two.
  assert.match(
    list,
    /className=\{`report-row__type report-row__type--\$\{typeHue\(report\.incident_type\)\}`\}/,
  );
  assert.match(
    list,
    /<ReportTypeIcon[\s\S]*?name=\{typeIcon\(report\.incident_type\)\}[\s\S]*?className="report-row__type-mark"/,
  );
  assert.match(list, /<span className="report-row__type-text">\{report\.incident_type\}<\/span>/);
  assert.equal(
    list.match(/report\.incident_type\}<\/span>/g)?.length ?? 0,
    1,
    'the type is written on the row twice',
  );
  // ...and the chip comes FIRST: type, then the record's number and its badges.
  assert.ok(list.indexOf('report-row__type-text') < list.indexOf('report-row__num'));
  assert.ok(list.indexOf('report-row__num') < list.indexOf('report-row__badges'));

  // The chip is a chip, not a tinted word: the capsule corner and the tracked
  // capitals are what make it read as the reference's chip, and the name gives
  // way inside it rather than growing the row.
  const pill = styles.match(/\.report-row__type \{[^}]*\}/)?.[0] ?? '';
  assert.ok(pill, '.report-row__type is gone from the stylesheet');
  assert.match(pill, /border-radius:\s*999px/, 'the type is not a capsule');
  assert.match(pill, /text-transform:\s*uppercase/, 'the type is not the reference’s capitals');
  assert.match(pill, /var\(--ir-type-wash/, 'the chip states no wash');
  assert.match(styles, /\.report-row__type-text \{[^}]*text-overflow:\s*ellipsis/);

  // THE WHEN IS SET LARGE (owner request, 2026-10-08): the reference's card is
  // built around its date and time, and it is the register's own sort key — so
  // that one cell is the row's headline value and the two quieter facts keep the
  // row's plain size.
  assert.match(list, /className="report-row__cell report-row__cell--when"/);
  assert.match(
    styles,
    /\.report-row__cell--when \.report-row__cell-value \{[^}]*font-size:\s*0\.9rem/,
    'the when is no longer the row’s loudest value',
  );
  // The register does NOT draw a table any more, and no longer double-clicks.
  assert.doesNotMatch(reports, /onDoubleClick=/);
  assert.doesNotMatch(reports, /<table>/);
});

test('the register draws a shelf, and a folder opens into its own list', () => {
  // The shelf: one glass folder per type per shelf, and the SHELVES come from
  // shelvesFor — so archived and the translation queue get their single shelf
  // without the render knowing about the modes.
  assert.match(reports, /<GlassFolder/);
  assert.match(reports, /buildShelves\(folders, \{/);
  // ...and the ORDER goes in with the mode, because the ALL shelf's own note is
  // the order the list under it is in (see the orders test). The register's role
  // travels with them too: it is what renames the second tab for the officer
  // (see the shelf test) without touching the bucket it holds.
  assert.match(
    reports,
    /shelvesFor\(\{[\s\S]{0,120}sort: query\.sort,[\s\S]{0,60}dir: query\.dir,[\s\S]{0,40}officer,[\s\S]{0,20}\}\)/,
    'the shelves no longer get the order and the role together',
  );
  assert.match(reports, /active\.folders\.map\(\(folder\) => \(/);
  // Folders sit directly on the page — no card wrapper — in an even grid of
  // aligned columns (owner request, 2026-10-06: the wrapped flex row left every
  // folder at its natural width and the columns unaligned between shelves).
  assert.match(styles, /\.folder-shelf__row \{[^}]*display:\s*grid/);
  assert.match(styles, /\.folder-shelf__row \{[^}]*grid-template-columns:\s*repeat\(auto-fill/);

  // The drill-in: the contents list, the trail back, and a request scoped to
  // the open folder.
  assert.match(reports, /<ReportList/);
  assert.match(reports, /rowMeta=\{rowMeta\}/);
  // ...scoped by the folder: the shelf is the bucket, the folder is the type —
  // and the RECENT folder, which is neither, is scoped by its window alone.  // ...and the OPEN FOLDER is the only thing that scopes it: with no folder open
  // the request is the plain filtered set, which is what ALL REPORTS shows.
  assert.match(reports, /const folderParams = openFolder \? \{ bucket: openFolder\.shelf, type: openFolder\.type \} : \{\}/);
  assert.match(reports, /folderTrail\(listTitle, openFolder\.label, openFolder\.type\)/);
  assert.match(reports, /onClick=\{closeFolder\}/);
  // The breadcrumb is a real landmark and the last crumb is the current page.
  assert.match(reports, /aria-label="Folder"/);
  assert.match(reports, /aria-current=\{last \? 'page' : undefined\}/);

  // Opening a folder must not make the filter bar claim the officer chose a
  // type, and it must not leave the previous folder's rows under the new name.
  assert.match(reports, /shelf: shelf\.all \? null : shelf\.key,/);
  assert.match(reports, /label: shelf\.label,\s*\n\s*type,/);
  assert.match(reports, /function closeFolder\(\)[\s\S]*?setReports\(null\)/);
  // A folder IS a type, so narrowing by type — or clearing the filters — leaves
  // the folder rather than contradicting the breadcrumb.
  assert.match(reports, /aria-label="Filter by incident type"[\s\S]*?setOpenFolder\(null\)/);
  assert.match(reports, /setOpenFolder\(null\);\s*\n\s*setQuery\(\(q\) => \(\{ q: '', type: ''/);
});

test('the shelves are a strip of tabs, and one shelf is on screen at a time', () => {
  // The shelves used to be stacked sections (owner request, 2026-10-07): the
  // folder area ran down the page and an officer looking for their drafts
  // scrolled past a week of nothing to find them. They are tabs now, and the
  // counts ride the tabs so the strip answers "what have I got and where" before
  // a single folder is drawn.
  assert.match(reports, /export function ReportShelf\(/);
  assert.match(reports, /<ReportShelf/);
  assert.match(reports, /shelves=\{shelves\}/);
  assert.match(reports, /activeKey=\{shelfKey\}/);
  assert.match(reports, /onSelect=\{setShelfKey\}/);
  assert.match(reports, /onOpenFolder=\{openFolderAt\}/);
  // ...and the counts come from the same tally the folders do.
  assert.match(reports, /<span aria-hidden="true">\{shelf\.total\}<\/span>/);

  // A REAL TABLIST, not a row of toggles: the pattern is what gives the strip
  // the keyboard behaviour an officer already knows.
  assert.match(reports, /role="tablist"/);
  assert.match(reports, /aria-label="Report shelves"/);
  assert.match(reports, /role="tab"/);
  assert.match(reports, /aria-selected=\{selected\}/);
  assert.match(reports, /aria-controls=\{`\$\{groupId\}-panel`\}/);
  assert.match(reports, /role="tabpanel"/);
  assert.match(reports, /aria-labelledby=\{`\$\{groupId\}-tab-\$\{activeIndex\}`\}/);
  // ONE tab in the page's tab order (roving tabindex), so Tab leaves the strip
  // rather than walking every shelf in it — and the arrow keys move between them.
  assert.match(reports, /tabIndex=\{selected \? 0 : -1\}/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.ok(reports.includes(`e.key === '${key}'`), `the strip ignores ${key}`);
  }
  assert.match(reports, /onSelect\?\.\(list\[next\]\.key\);/);

  // ONLY the shelf the officer is on is drawn, so nothing of another shelf's is
  // behind this one to tab through. A LIST shelf draws the caller's own files
  // panel instead of a grid — that shelf IS reports (see ReportFiles).
  assert.match(reports, /active\.list \? \(\s*\n\s*children\s*\n\s*\) : active\.folders\.length === 0 \? \(/);
  assert.match(reports, /<p className="folder-shelf__empty">/);
  // The resting tab is the module's rule, and the officer's own choice wins over
  // it while it is still one of the shelves — resolved by the MODULE, read by the
  // strip and by the register both, so the lit tab and the panel under it cannot
  // be two different shelves.
  assert.match(reports, /const active = shelfInView\(list, activeKey\);/);
  assert.match(reports, /const activeShelf = shelfInView\(shelves, shelfKey\);/);
  assert.match(reports, /const filesInView = Boolean\(activeShelf && activeShelf\.list\) && !openFolder;/);
  // Held in the register rather than in the strip, so going into a folder and
  // back out lands on the shelf it was opened from.
  assert.match(reports, /const \[shelfKey, setShelfKey\] = useState\(null\)/);
});

test('ALL REPORTS draws the register as files, newest first, and asks for them', () => {
  // "By file, not by folder" (owner request, 2026-10-07): the ALL shelf's panel is
  // the SAME list an opened folder draws — one component, two callers — so a
  // report reads identically however the officer reached it, and its rows carry
  // the register's own actions.
  assert.match(reports, /export function ReportFiles\(\{/);
  assert.match(reports, /<ReportList\s*\n\s*reports=\{reports\}/);
  assert.match(reports, /rowMeta=\{rowMeta\}/);
  assert.match(reports, /onOpen=\{openSheet\}/);
  assert.match(reports, /onEdit=\{askEdit\}/);
  assert.match(reports, /onMenu=\{openRowMenu\}/);
  // The shelf's own panel, and the folder's — one component at each. The filter
  // count, not `filtersOn`: the term is the search box's own (it sits beside it),
  // so the sentence names the row's filters only when the ROW is what is on.
  assert.match(reports, /emptyText="No reports in this folder\."/);
  assert.match(reports, /emptyText=\{emptyAllNote\(\{ q: query\.q, filtered: filterCount > 0 \}\)\}/);
  assert.match(reports, /onPage=\{\(page\) => setQuery\(\(q\) => \(\{ \.\.\.q, page \}\)\)\}/);
  // ...AND THE VOCABULARY REACHES IT FROM THE REGISTER'S OWN FLAG, THREE TIMES:
  // once by the panel, forwarding to the rows it draws, and once at each of the
  // register's two doors (the opened folder and the ALL shelf). A panel that READS
  // `officer` while its caller forgets to pass it is a ReferenceError waiting to
  // blank the screen — see the render test at the end of this file for the crash
  // itself, which this count is the wiring half of.
  assert.equal(
    reports.match(/officer=\{officer\}/g)?.length,
    3,
    'the register no longer hands the officer/Admin vocabulary to both of its report lists',
  );
  assert.match(reports, /const officer = user\.role !== 'Admin';/);

  // NEWEST FIRST is the register's own order, unstated by the shelf because the
  // query already carries it: the newest incident at the top (see the query state
  // and listParams, which sends `sort`/`dir` with every request).
  assert.match(reports, /sort: 'incident_datetime',\s*\n\s*dir: 'desc',/);

  // THE REGISTER ASKS FOR THE RIGHT THING. An open folder asks for its contents;
  // ALL REPORTS asks for the whole filtered set AND the tally (the strip's counts
  // stay live underneath the list); any other shelf asks for the tally alone,
  // because its folders are the whole of what it draws.
  assert.match(
    reports,
    /useEffect\(\(\) => \{\s*\n\s*if \(openFolder\) load\(\);\s*\n\s*else \{\s*\n\s*loadFolders\(\);\s*\n\s*if \(filesInView\) load\(\);/,
  );
  assert.match(reports, /\}, \[showArchived, query, openFolder, filesInView\]\);/);
  // ...and a mutation on the ALL shelf refreshes BOTH, so the row that just moved
  // is gone from the list AND off the tab's count.
  assert.match(reports, /return filesInView \? Promise\.all\(\[tally, load\(\)\]\) : tally;/);
  // The empty state says WHICH emptiness it is, and quotes the term back when
  // there was one: the filters are what the officer can do about the second, and
  // a search that found nothing has to be answerable at a glance.
  assert.match(reports, /function emptyAllNote\(\{ q = '', filtered = false \} = \{\}\) \{/);
  assert.match(reports, /`No reports match “\$\{q\}” and these filters\.`/);
  assert.match(reports, /`No reports match “\$\{q\}”\.`/);
  assert.match(reports, /'No reports match these filters\.'/);
  assert.match(
    reports,
    /'Nothing has been recorded yet — a new report starts in Write Report\.'/,
  );
});

test('the register can be read in four orders, and the shelf says which one is on', () => {
  // The menu offers exactly what the SERVER can sort by (ReportsController's
  // $sortMap: incident_datetime, incident_type, status, created_by_name) — a
  // fifth order would be a control that blanks the register when it is pressed.
  assert.deepEqual(
    SORT_ORDERS.map((o) => o.key),
    ['incident_datetime', 'incident_datetime', 'incident_type', 'status', 'created_by_name'],
  );
  for (const key of SORT_ORDERS.map((o) => o.key)) {
    assert.match(
      controller,
      new RegExp(`'${key}' =>`),
      `the register offers an order the server refuses: ${key}`,
    );
  }
  for (const dir of SORT_ORDERS.map((o) => o.dir)) {
    assert.ok(['asc', 'desc'].includes(dir), `a direction the server cannot read: ${dir}`);
  }
  // Each order is offered once, carries both halves (a key without its direction
  // is a different order), and can be SAID short for the shelf's own note.
  assert.equal(new Set(SORT_ORDERS.map((o) => `${o.key} ${o.dir}`)).size, SORT_ORDERS.length);
  for (const o of SORT_ORDERS) {
    assert.ok(o.label && o.note, `an order with nothing to call it: ${o.key} ${o.dir}`);
  }
  assert.deepEqual(DEFAULT_SORT, SORT_ORDERS[0]);
  assert.equal(DEFAULT_SORT.dir, 'desc');

  // TOTAL: a pair this build does not know (a bookmarked URL, a default that
  // drifted from the server's) resolves to the register's own order rather than
  // to a menu with nothing ticked.
  assert.equal(sortOrder('incident_datetime', 'desc'), DEFAULT_SORT);
  assert.equal(sortOrder('incident_type', 'asc').label, 'Incident type, A to Z');
  assert.equal(sortOrder('incident_type', 'DESC'), DEFAULT_SORT);
  assert.equal(sortOrder('narrative', 'asc'), DEFAULT_SORT);
  assert.equal(sortOrder(undefined, undefined), DEFAULT_SORT);
  assert.equal(sortNote('incident_datetime', 'asc'), 'Oldest first');
  assert.equal(sortNote('status', 'asc'), 'Status A–Z');

  // AND THE SHELF THAT STATES AN ORDER STATES THE ONE THAT IS ON: ALL REPORTS
  // wears the officer's order when the register is built with it, so a tab cannot
  // go on claiming "Newest first" over a list of the oldest reports.
  assert.equal(shelvesFor({})[0].note, 'Newest first');
  assert.equal(shelvesFor({ sort: 'incident_datetime', dir: 'asc' })[0].note, 'Oldest first');
  assert.equal(shelvesFor({ sort: 'incident_type', dir: 'asc' })[0].note, 'Type A–Z');
  // The other two shelves have no note of their own — a shelf of folders is
  // grouped by type whatever order the list inside a folder is in.
  assert.deepEqual(shelvesFor({}).slice(1).map((s) => s.note), [undefined, undefined]);
});

test('the rail above a list of reports narrows it, orders it, and folds away', () => {
  // THE RAIL AS A COMPONENT, drawn by whoever is drawing report ROWS: the All
  // Reports shelf and the inside of an opened folder both send the officer's
  // search term with every request, and a filter whose box is off screen is a
  // list with an invisible cause.
  assert.match(reports, /export function ReportTools\(\{/);
  assert.match(reports, /const tools = \(\s*\n\s*<ReportTools/);
  // ...AND ON A SHELF OF FILES IT RIDES THE STRIP'S OWN ROW (owner request,
  // 2026-10-08). The shelf is HANDED the rail and draws it in the row beside the
  // tabs — one line of names, one line of controls, one hairline under both —
  // while the opened folder, which has no strip, still draws it under its trail.
  assert.match(reports, /tools=\{tools\}/, 'the shelf is not handed the rail');
  assert.match(reports, /className="folder-head"/, 'nothing holds the strip and the rail');
  assert.match(
    reports,
    /\{tools\}\s*\n\s*\{aside\}\s*\n\s*<\/div>/,
    'the rail does not stand in the head the tabs are in',
  );
  // ...AND THE FILTER LINE AND THE ARCHIVE SWITCH RIDE THAT HEAD TOO (owner
  // request, 2026-10-08). All three are handed to the strip, and the opened
  // folder — which has no strip — draws them under its trail. The filter line used
  // to be a CARD of its own above this one, with a navy strip holding nothing and
  // the fields under it; it is the register head's second line now, which is what
  // `filters={filterBar}` and the `{filters}` under the head are for.
  assert.match(reports, /filters=\{filterBar\}/, 'the shelf is not handed the filter line');
  assert.match(reports, /aside=\{archivedChip\}/, 'the shelf is not handed the archive switch');
  assert.match(
    reports,
    /\{tools\}\s*\n\s*\{archivedChip\}\s*\n\s*\{filterBar\}\s*\n\s*<ReportFiles/,
    'the folder view lost the rail, the filter line or the archive switch',
  );
  assert.match(
    styles,
    /\.folder-head \{[^}]*border-bottom: 1px solid var\(--ir-border\)/,
    'the row the tabs and the rail share draws no hairline',
  );
  assert.match(
    styles,
    /\.folder-tabs \{[^}]*flex: 1 1 auto/,
    'the strip no longer takes the row it is drawn in',
  );
  assert.match(
    styles,
    /\.folder-head \.register-tools \{[^}]*flex: 1 1 auto/,
    'the rail does not take the rest of the row the strip is on',
  );
  assert.match(
    styles,
    /\.folder-head \.register-tools \{[^}]*flex-wrap: nowrap/,
    'the rail folds its own keys away instead of staying one rail',
  );
  assert.match(
    styles,
    /\.folder-head \.register-tools \{[^}]*padding: 0 0 0\.35rem/,
    'the rail kept the padding it wore as a row of its own',
  );

  // THE FIELD. A form (`role="search"`), so Enter submits and Escape clears —
  // and the term commits to the register's own `q`, which the list already sends
  // (see listParams), so a new box needed no new endpoint.
  assert.match(reports, /className="reports-search register-tools__search"/);
  assert.match(reports, /role="search"/);
  assert.match(reports, /placeholder="Search by report number, location, or type…"/);
  assert.match(reports, /type="search"/);
  assert.match(reports, /onSearch\?\.\(term\.trim\(\)\);/);
  assert.match(reports, /if \(e\.key !== 'Escape'\) return;/);
  assert.match(reports, /if \(q\) onSearch\?\.\(''\);/, 'Escape does not re-ask after a search');
  assert.match(reports, /function applySearch\(term\) \{/);
  assert.match(reports, /setQuery\(\(q\) => \(\{ \.\.\.q, q: term, page: 1 \}\)\);/);
  // The magnifier is the form's own submit control — a mark that does nothing
  // when it is pressed is worse than no mark.
  assert.match(reports, /<button type="submit" className="reports-search__go" aria-label="Search reports">/);
  assert.match(reports, /const \[term, setTerm\] = useState\(q\);/);
  assert.match(reports, /setTerm\(q\);\s*\n\s*\}, \[q\]\);/, 'the box does not follow the register’s own term');

  // AND IT ANSWERS AS IT IS TYPED (owner request, 2026-10-08). Enter is no
  // longer the only way to ask: every change to the box restarts a clock and one
  // real PAUSE sends the term, so the list answers the box itself. The clock and
  // the store of "what was already asked" are the two things that must not rot —
  // without the first the register is back to waiting for a key, and without the
  // second the register's own answer re-asks for the term it just handed over.
  assert.ok(reports.includes('const SEARCH_SETTLE_MS ='), 'the field has no pause of its own');
  assert.ok(
    reports.includes('typed.current = true;'),
    'typing no longer says the term is the officer’s own',
  );
  assert.ok(reports.includes('}, SEARCH_SETTLE_MS);'), 'the field no longer waits for a pause');
  assert.ok(reports.includes('ask.current?.(next);'), 'the pause asks nothing of the register');
  assert.ok(
    reports.includes('if (next === asked.current) return;'),
    'a term the register already has is asked for again',
  );
  assert.ok(
    /typed\.current = false;\s*\n\s*onSearch\?\.\(term\.trim\(\)\);/.test(reports),
    'Enter no longer cancels the clock it commits over',
  );
  // …and the asker rides in a ref, because `onSearch` is a fresh function every
  // time the register renders: a pause that depended on its identity would have
  // its clock restarted by a presence tick and the request would never leave.
  assert.ok(
    reports.includes('const ask = useRef(onSearch);'),
    'the pause depends on a function that changes identity every render',
  );

  // THE FUNNEL is a DISCLOSURE, not a toggle button: the row it folds is the
  // register head's own second line now, so it names what it controls and states
  // whether it is showing.
  assert.match(reports, /aria-expanded=\{filtersOpen\}/);
  assert.match(reports, /aria-controls=\{filtersId\}/);
  assert.match(
    reports,
    /<div className="reports-toolbar register-filters" id=\{filtersId\} hidden=\{!filtersOpen\}>/,
    'the filter line lost the register’s own class, its id or its `hidden` state',
  );
  // ...and it RESTS FOLDED (owner request, 2026-10-12): the register opens on
  // the list, and the funnel — drawn on both views — opens the row when the
  // officer asks for it.
  assert.match(
    reports,
    /const \[filtersOpen, setFiltersOpen\] = useState\(false\)/,
    'the filter row is drawn open again instead of waiting for the funnel',
  );
  assert.match(reports, /const filtersId = `\$\{groupId\}-filters`;/);
  // The count it wears is the ROW's own filters — the term has a control of its
  // own sitting beside it — and it is what the row is holding while folded away.
  assert.match(reports, /aria-label=\{filterCount > 0 \? `Filters — \$\{filterCount\} set` : 'Filters'\}/);
  assert.match(reports, /<span className="register-tool__count" aria-hidden="true">/);

  // THE SORT KEY is a menu of the module's orders, with the one in force TICKED
  // (RowMenu's `checked`), and it states that order in its own name because a
  // mark cannot.
  assert.match(reports, /aria-label=\{`Sort reports — \$\{order.label\}`\}/);
  assert.match(reports, /aria-haspopup="menu"/);
  assert.match(reports, /data-on=\{resorted \? 'true' : undefined\}/);
  assert.match(reports, /const resorted = order\.key !== DEFAULT_SORT\.key \|\| order\.dir !== DEFAULT_SORT\.dir;/);
  assert.match(reports, /items=\{SORT_ORDERS\.map\(\(o\) => \(\{/);
  assert.match(reports, /checked: o\.key === order\.key && o\.dir === order\.dir,/);
  assert.match(reports, /function applySort\(order\) \{/);
  assert.match(reports, /setQuery\(\(q\) => \(\{ \.\.\.q, sort: order\.key, dir: order\.dir, page: 1 \}\)\);/);

  // THE DRAWING. One raised field with the app's own radius for a capsule, the
  // ring on `:focus-within` (the pill is what the officer is typing into), the
  // hairline, the two keys, and the folded row.
  assert.match(styles, /\.register-tools \{[^}]*justify-content: flex-end/);
  assert.match(styles, /\.register-tools__search \{[^}]*border-radius: 999px/);
  // A FIELD'S OWN PAIR, not a plate's: the well every input in the app wears,
  // and the ONE boundary in the palette held to a legible measure against it
  // (3:1 — the filter selects under it wear exactly these two tokens). The keys
  // beside it are plates, which is why they keep --ir-raised and --ir-border.
  assert.match(styles, /\.register-tools__search \{[^}]*background: var\(--ir-input\)/);
  assert.match(styles, /\.register-tools__search \{[^}]*border: 1px solid var\(--ir-field-border\)/);
  assert.match(styles, /\.register-tool \{[^}]*background: var\(--ir-raised\)/);
  assert.match(styles, /\.register-tools__search:focus-within \{[^}]*box-shadow: 0 0 0 3px var\(--focus-ring\)/);
  assert.match(styles, /\.register-tools__rule \{[^}]*width: 1px/);
  assert.match(styles, /\.register-tool \{[^}]*border-radius: 10px/);
  assert.match(styles, /\.register-tool\[aria-expanded='true'\]/);
  assert.match(styles, /\.register-tool\[data-on='true'\]/);
  // The row folds because the ATTRIBUTE says so: `.reports-toolbar` is a flex box,
  // and an author `display` out-ranks the UA's `[hidden]` rule.
  assert.match(styles, /\.reports-toolbar\[hidden\] \{\s*\n\s*display: none;/);
  // ...AND IT STANDS IN THE REGISTER'S OWN HEAD NOW (owner request, 2026-10-08):
  // the line keeps the grid and the compact controls styles.css draws, loses the
  // margin it wore as a card body, and brings the strip's own 1rem because the
  // register's card is `flush`. Two classes on one element, because this sheet
  // lands BEFORE styles.css in the bundle and one class would lose the tie (the
  // same reason `.main.ir-body` names two — see homeFit).
  assert.match(
    styles,
    /\.reports-toolbar\.register-filters \{[^}]*margin: 0/,
    'the filter line still carries the margin it wore as a card body',
  );
  assert.match(
    styles,
    /\.reports-toolbar\.register-filters \{[^}]*padding: 0\.7rem 1rem 0\.9rem/,
    'the filter line does not pad itself to the strip’s own edge',
  );
  // ...AND ITS FIELDS ARE SOFTLY ROUNDED (owner request, 2026-10-12): the line
  // stands under the search capsule, and the document grammar's own 3px corner
  // read as a bare box beside it. The radius is stated on the register's own
  // rule (two classes), so it out-specifies `.ir-body input` without an
  // `!important` — and it is 10px, the rail's own key, so the fields and the
  // keys a pointer meets on this screen are one shape.
  assert.match(
    styles,
    /\.reports-register \.reports-filter input,[\s\S]{0,160}border-radius: 10px/,
    'the filter fields kept the bare 3px corner',
  );
  // THE ADMIN'S ARCHIVE SWITCH went with the card that held it, so it stands in
  // that same head: a word-shaped key (a mark cannot say "Show Archived"), kept
  // out of the fold — a mode that folds away with the filters is a mode an Admin
  // can leave the register in and no longer reach.
  assert.match(reports, /aria-pressed=\{showArchived\}/, 'the archive switch lost its state');
  assert.match(reports, /className="register-tool register-tool--mode"/);
  assert.match(reports, /\{showArchived \? 'Show Active' : 'Show Archived'\}/);
  assert.match(styles, /\.register-tool--mode\[aria-pressed='true'\]/);

  // THE PLACEHOLDER'S PROMISE IS KEPT BY THE SERVER: "Search by report number,
  // location, or type" — a report number is the id, spelled the way the app spells
  // it, and a word that is one has to find the record it names. Digits only, cast
  // to an int and bound, so nothing typed reaches the SQL as anything but a number.
  assert.match(controller, /\$or\[\] = "r\.id = \{\$key\}";/);
  assert.match(controller, /preg_match\('\/\^\(\?:bw-\?\)\?0\*\(\\d\{1,9\}\)\$\/i', \$word, \$m\) === 1/);
  // ...and the prefix may stand apart from the digits: "BW 0319" is TWO words,
  // and a search that ANDs its words would otherwise demand that "bw" appear in
  // the record. The prefix takes the number off the word after it, and both
  // words then name the same report.
  assert.match(controller, /elseif \(preg_match\('\/\^bw-\?\$\/i', \$word\) === 1\) \{/);
  assert.match(controller, /if \(preg_match\('\/\^0\*\(\\d\{1,9\}\)\$\/', \$next, \$n\) === 1\) \{/);
});

test('the register explains its controls and shows a labelled result range', () => {
  assert.match(reports, /className="reports-register" aria-label=\{showArchived \? 'Archived Reports' : listTitle\}/);
  assert.doesNotMatch(reports, /className="register-heading"|Your report register|Find incident records, review report sheets/);
  assert.match(reports, /className="register-tool__label">Filters<\/span>/);
  assert.match(reports, /className="register-tool__label">Sort<\/span>/);
  assert.match(reports, /className="register-results" role="status" aria-live="polite"/);
  assert.match(reports, /pagination\.per_page/);
  assert.match(reports, /Math\.min\(pagination\.page \* pagination\.per_page, pagination\.total\)/);
  assert.match(reports, /<nav className="reports-pagination" aria-label="Report pages">/);
  assert.match(list, /<span>Edit<\/span>/);
  assert.match(list, /<span>More<\/span>/);
  assert.match(styles, /\.reports-register \.register-tool \{[^}]*min-height: 44px/);
  assert.match(styles, /\.reports-register \.report-row__cell-text \{[^}]*white-space: normal/);
});

test('the tabs state their own surface, and the folders came down a size', () => {
  // The strip is inside `.ir-body`, whose neutral button treatment paints a plate
  // and a hairline — which is exactly the strip this screen does not want. The
  // class has to be named in BOTH chains (the resting rule and its :hover twin),
  // like every other control that states its own surface.
  const neutral = styles.match(/\.ir-body button(?::not\([^)]*\))+:not\(\.danger\)/g) ?? [];
  assert.ok(neutral.length >= 1, 'the neutral .ir-body button treatment is gone');
  for (const selector of neutral) {
    assert.match(
      selector,
      /:not\(\.folder-tab\)/,
      `the shelf tab is not excluded from the neutral button treatment: ${selector}`,
    );
    // The rail's own controls state their surface too (owner request,
    // 2026-10-07): the two keys are raised plates with a radius and a hover of
    // their own, and the magnifier inside the search field has NO surface at all
    // — this selector paints it a grey plate with a hairline INSIDE the capsule
    // it sits in, which is the one thing a field's own icon cannot wear.
    for (const sel of ['.register-tool', '.reports-search__go']) {
      assert.ok(
        selector.includes(`:not(${sel})`),
        `${sel} is not excluded from the neutral button treatment: ${selector}`,
      );
    }
  }
  // The current tab wears the plate and the accent rule (the top bar's own "you
  // are here"): a hairline border and a 3px rule, BOTH transparent at rest, so a
  // tab cannot change size as it becomes the one you are on — and the tab is
  // pulled down over the strip's hairline by the pixel, so the rule COVERS that
  // line rather than floating above it.
  assert.match(styles, /\.folder-tab \{[^}]*border: 1px solid transparent/);
  assert.match(styles, /\.folder-tab \{[^}]*border-bottom: 3px solid transparent/);
  assert.match(styles, /\.folder-tab \{[^}]*margin-bottom: -1px/);
  assert.match(
    styles,
    /\.folder-tab\[aria-selected='true'\] \{[^}]*border-bottom-color: var\(--ir-bar-accent\)/,
  );
  assert.match(styles, /\.folder-tab:focus-visible \{[^}]*outline: 2px/);

  // A SIZE DOWN (owner request, 2026-10-07): the folder's cap and the shelf's
  // column are the SAME number, or a folder overhangs its column or leaves a gap
  // beside it.
  assert.match(styles, /\.glass-folder__stage \{[^}]*max-width: 12\.5rem/);
  // ...and the clearance that overhang needs. A folder's own tab stands a tenth
  // of its height above its box (see .glass-folder__back::before) and the card the
  // panel sits in clips what leaves it, so the panel's top padding and the row's
  // have to clear that — at zero, a shelf of folders draws with its tabs sliced
  // off, which is exactly what the first pass of this strip did.
  assert.match(styles, /\.folder-shelf \{[^}]*padding: 0\.[1-9]rem 1rem/);
  assert.match(styles, /\.folder-shelf__row \{[^}]*padding: 0\.[1-9]rem 0\.25rem/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fill, minmax\(12\.5rem, 1fr\)\)/);
  assert.doesNotMatch(styles, /minmax\(15rem/);
  assert.doesNotMatch(styles, /max-width: 15rem/);
});

test('editing a draft is a deliberate act: it confirms, then opens the writer', () => {
  assert.match(reports, /function askEdit\(r\) \{/);
  assert.match(reports, /confirmLabel: 'Edit Draft'/);
  assert.match(reports, /kind: 'edit'/);
  assert.match(reports, /action: \(\) => setOpenId\(r\.id\)/);
  // ...and it is NOT a destructive confirm. Without a tone the dialog falls back
  // to the red button archiving uses, which would dress an ordinary edit up as a
  // deletion.
  assert.match(reports, /tone: 'primary'/);
  // THE CONFIRM BOX ITSELF IS THE SHARED MODULE'S (ReportActions.jsx), because
  // Home puts up the same box for the same reasons — the tone fallback, and the
  // early return that keeps an EDIT from being treated as a mutation. What stays
  // this file's is the ASK: which confirm a draft's Edit puts up.
  const actions = readFileSync(new URL('../../src/components/ReportActions.jsx', import.meta.url), 'utf8');
  assert.match(actions, /confirm\.tone \?\? \(confirm\.confirmLabel === 'Finalize Report'/);
  assert.match(actions, /if \(c\.kind === 'edit'\) \{\s*\n\s*c\.action\(\);\s*\n\s*return;/);
  // ...and the register hands its ask to it rather than setting state itself.
  assert.match(reports, /actions\.ask\(\{\s*\n\s*title: `Edit draft report/);
  // The row only offers Edit where the rule says so.
  assert.match(reports, /onEdit=\{askEdit\}/);
});

test('the shelf, the folder and the row are declared once and used once', () => {
  const declared = (selector) => styles.includes(selector);
  for (const sel of [
    '.folder-shelves',
    '.folder-head',
    '.folder-tabs',
    '.folder-tab',
    '.folder-tab__note',
    '.folder-tab__count',
    '.folder-shelf__empty',
    '.folder-shelf__row',
    '.glass-folder__open',
    '.glass-folder__stage',
    '.glass-folder__back',
    '.glass-folder__sheet',
    '.glass-folder__front',
    '.glass-folder__label',
    '.glass-folder__count',
    '.report-trail__back',
    '.report-trail__crumbs',
    '.report-row__open',
    '.report-row__num',
    '.report-row__meta',
    '.report-row__actions',
    '.report-row__edit',
    '.report-row__menu',
    // The rail above a list of reports (owner request, 2026-10-07).
    '.register-tools',
    '.register-tools__search',
    '.register-tools__rule',
    '.register-tool',
    '.register-tool__count',
    '.reports-search__go',
  ]) {
    assert.ok(declared(sel), `${sel} is not declared at all`);
  }
  // The moving parts are all decorative: the button's own name is what assistive
  // tech reads, so the stage is hidden.
  assert.match(folder, /className="glass-folder__stage" aria-hidden="true"/);

  // The reference's angles, so the fan cannot quietly flatten to nothing.
  for (const deg of [20, 30, 38, 46]) {
    assert.match(styles, new RegExp(`rotateX\\(-${deg}deg\\)`), `no rotateX(-${deg}deg) leaf`);
  }
  // ...and the perspective that makes a rotateX read as a lid rather than a
  // squash.
  assert.match(styles, /\.glass-folder__stage \{[^}]*perspective:\s*\d/);

  // The motion is optional, the state is not: the transitions live in the
  // no-preference query, and every colour is a role token.
  // EVERY no-preference block, not only the first: the sheet carries more than one
  // (the assistant's Generate pill has its own motion), and what is asserted is
  // that the folder's transition lives INSIDE such a block.
  const blocks = [...styles.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0, 'the sheet states no reduced-motion branch at all');
  const motion = blocks.find((b) => b.includes('.glass-folder__sheet')) ?? '';
  assert.match(motion, /\.glass-folder__sheet,\s*\n\s*\.glass-folder__front \{[^}]*transition:\s*transform/);
  assert.match(styles, /--ir-folder-face:/);
  assert.match(styles, /--ir-folder-ink:/);
});

test('hovering a folder fans it open and draws nothing around it', () => {
  // THE SHELF IS INSIDE `.ir-body` (Shell wraps every page in it), and
  // `.ir-body button` carries the neutral treatment for the app's ordinary
  // controls. The folder is not ordinary: its tabs overhang its own box, so the
  // treatment's 1px border draws a RECTANGLE cutting across the silhouette —
  // and on hover that border turns `--ir-blue`, which is the blue box around a
  // hovered folder. The class has to be named in the exclusions, both the
  // resting rule and its :hover twin, or the artifact comes straight back.
  // The premise first, so the exclusion below cannot pass by being vacuous.
  assert.match(shell, /className="main ir-body"/, 'every page is no longer wrapped in .ir-body');

  const neutral = styles.match(/\.ir-body button(?::not\([^)]*\))+:not\(\.danger\)/g) ?? [];
  assert.ok(neutral.length >= 1, 'the neutral .ir-body button treatment is gone');
  for (const selector of neutral) {
    assert.match(
      selector,
      /:not\(\.glass-folder__open\)/,
      `the folder is not excluded from the neutral button treatment: ${selector}`,
    );
  }

  // ...and the element-level `button:hover` in styles.css (a :hover pseudo-class
  // out-specifies `.glass-folder__open` itself) must find nothing to paint
  // either: no plate behind the glass, no border on the box, and no accent ink
  // borrowed from a button the folder is not.
  assert.match(styles, /\.glass-folder__open:hover \{[^}]*background:\s*none/);
  assert.match(styles, /\.glass-folder__open:hover \{[^}]*border:\s*0/);
  assert.match(styles, /\.glass-folder__open:hover \{[^}]*color:\s*inherit/);

  // The KEYBOARD ring stays: a mouse never matches :focus-visible, so removing
  // the hover chrome must not cost the officer who tabs to a folder the one
  // thing that says which folder they are on.
  assert.match(styles, /\.glass-folder__open:focus-visible \{[^}]*outline:\s*2px/);
});

test('the register paints its file panel, and the officer reads two words', async () => {
  // THE ASSERTION THAT MATTERS IS THAT THIS RENDER RETURNS AT ALL. `officer` was
  // named in ReportFiles' JSX and never destructured from its props, and a missed
  // prop in JavaScript is not a warning — it is a ReferenceError thrown during
  // render, and this app has no error boundary, so React unmounts the workspace and
  // the officer gets a WHITE SCREEN the moment the register draws its rows. Every
  // text test in this file passed while that was true. Rendering the panel is what
  // makes the prop list real.
  const { render, REPORTS } = await loadRegisterFiles();
  const officerView = render({ officer: true });

  // The rows are the register's own records, numbered the register's way.
  assert.match(officerView, /BW-0318/);
  assert.match(officerView, /BW-0312/);
  assert.match(officerView, /Rape \/ Sexual Assault/);
  // The count line and the pager come off `pagination`, and both are read by the
  // officer rather than asserted about: "6-10 of 12 reports" is page two of five.
  assert.match(officerView, /6-10 of 12 reports/);
  assert.match(officerView, /Page 2 of 3/);

  // ONE VOCABULARY PER READER (see statusText in lib/reportFolder.js): everything
  // that has left the officer's hands is FINALIZED to them — the word is folded,
  // and the badge's own class stays the raw status so the colour does not move —
  // while All Reports keeps `submitted` and `finalized` apart, because the Admin's
  // review queue is the difference between them.
  assert.match(officerView, /<span class="badge submitted">finalized<\/span>/);
  assert.match(render({ officer: false }), /<span class="badge submitted">submitted<\/span>/);
  // A DRAFT wears no badge for either reader: the resting state is not news.
  assert.equal(officerView.match(/class="badge draft"/g), null);

  // The empty and loading states are the caller's sentence, not the panel's...
  assert.match(render({ reports: [] }), /No reports in this folder\./);
  assert.match(render({ reports: null }), /Loading reports…/);
  // ...and their own wording comes back once the connection drops.
  assert.match(render({ reports: null, conn: 'offline' }), /Waiting for the connection to come back/);

  // A single page draws no pager at all: a Prev/Next pair over one page of one is
  // two controls that can only do nothing.
  assert.equal(render({ pagination: { page: 1, per_page: 5, total: REPORTS.length, total_pages: 1 } }).includes('reports-pagination'), false);
});
