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
import { INCIDENT_TYPES } from '../../src/lib/incidentTypes.js';
import {
  TYPE_ICON,
  DEFAULT_ICON,
  UNCLASSIFIED_TYPE,
  STATUS_BUCKETS,
  typeIcon,
  reportNumber,
  statusBucket,
  shelvesFor,
  buildShelves,
  tallyTotal,
  folderAriaLabel,
  folderHint,
  folderTrail,
  reportAriaLabel,
  reportHint,
  draftEditLabel,
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

/** The keys the icon component can actually draw. */
const glyphKeys = [...component.matchAll(/\n  '?([a-z][a-z-]*)'?: \(/g)].map((m) => m[1]);

const TYPES = [...INCIDENT_TYPES];

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
  // ...and every glyph must be reachable from the map (or be the fallback).
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
});

test('the mode decides the shelves: two for the register, one for the archive', () => {
  assert.deepEqual(shelvesFor({}).map((s) => s.key), ['draft', 'submitted']);
  assert.equal(shelvesFor({}).every((s) => !s.all), true);
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

  assert.deepEqual(shelves.map((s) => s.key), ['draft', 'submitted']);
  const [draft, submitted] = shelves;

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
  assert.equal(empty.length, 2);
  assert.deepEqual(empty.map((s) => s.folders), [[], []]);
  assert.deepEqual(empty.map((s) => s.total), [0, 0]);

  // Nothing is lost: every counted report lands on a shelf.
  assert.equal(tallyTotal(tally), shelves.reduce((n, s) => n + s.total, 0));
  assert.deepEqual(buildShelves(null, { shelves: shelvesFor({}) })[0].folders, []);
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

  assert.equal(reportAriaLabel(r, { dateText }), 'Open report BW-0319, Theft, Sep 12, 2026');
  // Finalized, non-admin: locked — the row must not promise an open it cannot do.
  assert.equal(
    reportAriaLabel(r, { dateText, locked: true }),
    'Report BW-0319, Theft, Sep 12, 2026 — finalized, locked',
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
  assert.equal(reportAriaLabel(r), 'Open report BW-0319, Theft');
  // An archived report is never announced as "Open", whether or not it restores.
  assert.doesNotMatch(reportAriaLabel(r, { dateText, archived: true, canRestore: true }), /Open/);
});

test('the hover hint names the same state as the label', () => {
  assert.equal(reportHint({}), 'Click to open · use ⋮ for actions');
  assert.match(reportHint({ locked: true }), /Finalized — locked/);
  assert.equal(reportHint({ archived: true, canRestore: true }), 'Archived — use ⋮ to restore');
  assert.equal(reportHint({ archived: true }), 'Archived report');
  assert.equal(reportHint({ canOpen: false }), 'Use ⋮ for actions');
  // The hint points at the ⋮ button rather than the right-click, because the
  // button is now the only affordance the officer can be told about in words.
  assert.match(reportHint({}), /⋮/);
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
  assert.match(list, /if \(meta\.canOpen\) onOpen\?\.\(report\.id\)/);
  // The status and translation badges are the app's own, reused not restyled.
  assert.match(list, /className=\{`badge \$\{report\.status\}`\}/);
  assert.match(list, /rv-badge rv-badge--sm/);
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
  assert.match(reports, /shelvesFor\(\{ archived: showArchived, awaiting \}\)/);
  assert.match(reports, /shelf\.folders\.map\(\(folder\) => \(/);
  // Folders sit in a flex row directly on the page — no grid, no card.
  assert.match(styles, /\.folder-shelf__row \{[^}]*display:\s*flex/);

  // The drill-in: the contents list, the trail back, and a request scoped to
  // the open folder.
  assert.match(reports, /<ReportList/);
  assert.match(reports, /rowMeta=\{rowMeta\}/);
  assert.match(reports, /const folderParams = openFolder \? \{ bucket: openFolder\.shelf, type: openFolder\.type \} : \{\}/);
  assert.match(reports, /folderTrail\(listTitle, openFolder\.label, openFolder\.type\)/);
  assert.match(reports, /onClick=\{closeFolder\}/);
  // The breadcrumb is a real landmark and the last crumb is the current page.
  assert.match(reports, /aria-label="Folder"/);
  assert.match(reports, /aria-current=\{last \? 'page' : undefined\}/);

  // Opening a folder must not make the filter bar claim the officer chose a
  // type, and it must not leave the previous folder's rows under the new name.
  assert.match(reports, /setOpenFolder\(\{ shelf: shelf\.all \? null : shelf\.key, label: shelf\.label, type \}\)/);
  assert.match(reports, /function closeFolder\(\)[\s\S]*?setReports\(null\)/);
  // A folder IS a type, so narrowing by type — or clearing the filters — leaves
  // the folder rather than contradicting the breadcrumb.
  assert.match(reports, /aria-label="Filter by incident type"[\s\S]*?setOpenFolder\(null\)/);
  assert.match(reports, /setOpenFolder\(null\);\s*\n\s*setQuery\(\(q\) => \(\{ q: '', type: ''/);
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
  assert.match(reports, /confirm\.tone \?\? \(confirm\.confirmLabel === 'Finalize Report'/);
  // The confirm is not a mutation: it opens the writer and re-reads nothing.
  assert.match(reports, /if \(c\.kind === 'edit'\) \{\s*\n\s*c\.action\(\);\s*\n\s*return;/);
  // The row only offers Edit where the rule says so.
  assert.match(reports, /onEdit=\{askEdit\}/);
});

test('the shelf, the folder and the row are declared once and used once', () => {
  const declared = (selector) => styles.includes(selector);
  for (const sel of [
    '.folder-shelves',
    '.folder-shelf__head',
    '.folder-shelf__count',
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
  const motion = styles.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
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
