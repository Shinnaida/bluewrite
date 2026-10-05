// BlueWrite — THE RECENT FOLDER: one week, one shelf, above Draft.
//
// The register's folders are incident TYPES on a status shelf. Recent is neither:
// it is a WINDOW over the record — the reports whose incident date falls in the
// last seven days, whatever their type and whatever their status — so it gets a
// shelf of its own at the top rather than a folder inside Draft or Submitted
// (owner request, 2026-10-06).
//
// Four things can go wrong quietly, and each is asserted here:
//
//   1. THE WINDOW ITSELF — seven days back on the officer's own calendar. The
//      obvious implementation (`toISOString().slice(0,10)`) answers in UTC, which
//      puts the window a day out for the eight hours of every night that Cebu is
//      already on tomorrow's date — the hours an officer is most likely to be
//      filing;
//   2. THE OFFICER'S OWN FILTER — a From date inside the window NARROWS the
//      count rather than being replaced by it, or the folder would count reports
//      the list inside it refuses to show;
//   3. THE SHELF'S SHAPE — one folder, counted by the same tally the other
//      shelves are, and NO folder when the week is empty (an empty folder is a
//      promise a shelf cannot keep);
//   4. THE ASKING — the count arrives with the shelf's own tally, and is asked
//      for ONCE when the officer's filter already starts inside the window.
//
// Read from source, like the rest of tests/rules: what is guarded is which
// window is asked for and which shelf is drawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RECENT_DAYS,
  RECENT_LABEL,
  RECENT_ICON,
  recentFrom,
  recentWindowFrom,
  withRecentShelf,
} from '../../src/lib/reportFolder.js';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const SRC = code(REPORTS);
const STYLE = code(CSS);

test('the window is seven days back on the officer’s own calendar', () => {
  assert.equal(RECENT_DAYS, 7);
  // One week back, same month.
  assert.equal(recentFrom(new Date(2026, 9, 6, 23, 30)), '2026-09-29');
  // Across a month boundary, and across a year boundary.
  assert.equal(recentFrom(new Date(2026, 9, 3, 0, 15)), '2026-09-26');
  assert.equal(recentFrom(new Date(2026, 0, 3, 12, 0)), '2025-12-27');
  // Zero-padded, both parts, or the query string would carry a date the server
  // refuses (its own validator wants YYYY-MM-DD).
  assert.equal(recentFrom(new Date(2026, 0, 8, 9, 0)), '2026-01-01');
  assert.match(recentFrom(new Date(2026, 8, 9, 9, 0)), /^\d{4}-\d{2}-\d{2}$/);
  // LATE EVENING LOCAL TIME is the case a UTC answer gets wrong: 11:30 PM on the
  // 6th in Cebu is still the 6th, while UTC is already the 6th at 15:30 — but
  // 1:00 AM on the 7th is the 6th in UTC, and a UTC-sliced window would answer
  // one day early.
  assert.equal(recentFrom(new Date(2026, 9, 7, 1, 0)), '2026-09-30');
});

test('the officer’s own From date narrows the window, never replaces it', () => {
  const window = recentFrom();
  // Nothing chosen: the week.
  assert.equal(recentWindowFrom(''), window);
  assert.equal(recentWindowFrom(undefined), window);
  // A From date INSIDE the week is the later of the two — the officer asked for
  // a narrower slice of the same week, and the count follows the list.
  assert.equal(recentWindowFrom('2099-01-01'), '2099-01-01');
  // A From date BEFORE the week is widened away: the folder is a WEEK, and the
  // officer's earlier bound is already satisfied by it.
  assert.equal(recentWindowFrom('2000-01-01'), window);
  assert.equal(recentWindowFrom('   '), window);
});

test('the Recent shelf is one folder, first, and empty when the week is', () => {
  const shelves = [{ key: 'draft', label: 'Draft', total: 4, folders: [{ type: 'Theft', count: 4 }] }];
  const [first, ...rest] = withRecentShelf(shelves, 3);

  assert.equal(first.key, 'recent');
  assert.equal(first.label, RECENT_LABEL);
  assert.equal(first.note, `Last ${RECENT_DAYS} days`);
  assert.equal(first.recent, true);
  assert.equal(first.total, 3);
  // ONE folder, named the same as the shelf: the window is the folder.
  assert.deepEqual(first.folders, [{ type: RECENT_LABEL, count: 3, recent: true }]);
  // The shelves it was given are untouched and still in their own order.
  assert.deepEqual(rest, shelves);

  // An empty week draws the shelf (so the register can say so) and NO folder.
  const [empty] = withRecentShelf(shelves, 0);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.folders, []);

  // A nonsense count is an empty week rather than a NaN on the face.
  assert.equal(withRecentShelf([], null)[0].total, 0);
  assert.equal(withRecentShelf([], 'x')[0].total, 0);
  assert.deepEqual(withRecentShelf(null, 2)[0].folders.length, 1);
});

test('the register asks for the week’s tally, once, under its own filters', () => {
  // The count comes from the SAME endpoint and the same filters as every other
  // shelf, one window back — that is what makes a folder's face and the list
  // inside it impossible to disagree.
  assert.match(SRC, /const windowParams = new URLSearchParams\(listParams\(\)\);/);
  assert.match(SRC, /windowParams\.set\('date_from', recentWindowFrom\(query\.date_from\)\)/);
  assert.match(SRC, /api\(`\/reports\/folders\?\$\{windowQs\}`\)/);
  // ONE request when the officer's own filter already starts inside the window:
  // the two queries are the same query then, and the filtered tally is the
  // week's tally.
  assert.match(SRC, /windowQs === qs \? Promise\.resolve\(null\) : /);
  assert.match(SRC, /setRecentCount\(tallyTotal\(\(window \?\? data\)\.folders\)\)/);

  // The shelf is composed where the shelves are, so a mode that draws ONE shelf
  // of its own (the archive, the translation queue) never gets a Recent one.
  assert.match(SRC, /if \(showArchived \|\| awaiting \|\| recentCount === null\) return built;/);
  assert.match(SRC, /return withRecentShelf\(built, recentCount\);/);
});

test('the Recent folder wears the clock and says which window it is', () => {
  // The glyph: a window is not an incident type, so it cannot come from the
  // type→glyph map (see RECENT_ICON).
  assert.match(SRC, /name=\{openFolder\.recent \? RECENT_ICON : typeIcon\(openFolder\.type\)\}/);
  // The shelf's own note, and the empty week's sentence.
  assert.match(SRC, /<span className="folder-shelf__note">\{shelf\.note\}<\/span>/);
  assert.match(SRC, /if \(shelf\.recent\) return `Nothing recorded in the last \$\{RECENT_DAYS\} days\.`;/);
  assert.match(STYLE, /\.folder-shelf__note \{/);
});
