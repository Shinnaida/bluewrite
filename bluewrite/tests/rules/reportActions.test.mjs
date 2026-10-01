// BlueWrite — A REPORT'S ACTIONS ARE STATED ONCE, AND BOTH SCREENS USE THEM.
//
// Open, History, Print and Archive began on the register's rows. Home now offers
// the same four on the same records — a draft row carries a kebab that opens the
// register's own menu — so the machinery moved into ReportActions.jsx and both
// screens consume it.
//
// WHY THIS IS WORTH A TEST. The whole point of the move is that there is ONE
// place where "Archive Report" is worded, where its confirm says the report is
// soft-deleted rather than destroyed, which endpoint it calls, and what it
// announces when it lands. A second copy on Home would look right on the day it
// was written and drift from the register's the first time either was touched —
// and the thing that would drift is what the officer is told happens to a police
// record. So this asserts the SHARING, not the wording: the module is imported by
// both screens, no screen states the actions itself, and each action's endpoint
// appears exactly once in the project.
//
// It also pins the split that made the sharing possible, because it is the part a
// later change is most likely to blur: the ACTIONS are shared, and the way a
// screen OPENS a report is not — the register opens one in its own side panel,
// Home navigates to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MODULE = readFileSync(new URL('../../src/components/ReportActions.jsx', import.meta.url), 'utf8');
const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');

/** Source with comments taken out — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ACTIONS = code(MODULE);
const SRC = code(REPORTS);

/** Home's own component — the half of Reports.jsx this test is about. */
const welcome = () => {
  const at = SRC.indexOf('export function ReportWelcome');
  assert.notEqual(at, -1, 'ReportWelcome is gone');
  return SRC.slice(at, SRC.indexOf('\nexport function', at + 1));
};

/** The register's component. */
const register = () => {
  const at = SRC.indexOf('export function ReportsTable');
  assert.notEqual(at, -1, 'ReportsTable is gone');
  return SRC.slice(at, SRC.indexOf('\nexport function', at + 1));
};

test('the module owns the four actions, their endpoints and their wording', () => {
  // The menu, in order — and the locked half stated where it is decided.
  for (const label of ["label: 'Open'", "label: 'Open (locked)'", "label: 'History'", "label: 'Print'", "label: 'Archive'", "label: 'Restore'"]) {
    assert.ok(ACTIONS.includes(label), `${label} left the shared module`);
  }
  // The two record mutations, each ONCE, with the shape of the act stated where
  // the officer is asked: archived rather than destroyed, and restorable.
  assert.match(ACTIONS, /api\(`\/reports\/\$\{r\.id\}`, \{ method: 'DELETE' \}\)/, 'the archive call moved');
  assert.match(ACTIONS, /api\(`\/reports\/\$\{r\.id\}\/restore`/, 'the restore call moved');
  assert.match(ACTIONS, /soft-deleted/, 'the confirm no longer says what archiving actually does');
  assert.match(ACTIONS, /can be restored by an administrator/, 'the confirm lost the way back');

  // The two dialogs and the print sheet live here, so both screens get the same
  // three, and the snapshot reader is shared rather than duplicated.
  assert.match(ACTIONS, /export function SnapshotDiff/, 'the snapshot reader is not shared');
  assert.match(ACTIONS, /History — Report #BW-/, 'the history dialog moved out');
  assert.match(ACTIONS, /<ReportPrint/, 'the print sheet moved out');
});

test('each action is stated in exactly one place across the project', () => {
  // The register must NOT keep a second copy. If it does, the two can disagree
  // about a police record's fate, and this is the assertion that says so.
  const say = (src, needle) => src.split(needle).length - 1;
  for (const needle of [
    'Remove report from the working list?',
    'Report archived.',
    'Report restored.',
    'Restore report #BW-',
  ]) {
    assert.equal(say(ACTIONS, needle), 1, `"${needle}" is stated ${say(ACTIONS, needle)} times in the shared module`);
  }
  // The Archive label and its danger flag are the module's alone.
  assert.equal(say(SRC, "label: 'Archive'"), 0, 'the register still states the Archive item itself');
  assert.equal(say(SRC, "label: 'History'"), 0, 'the register still states the History item itself');

  // And the register no longer owns the state the actions run on: the confirm,
  // the history dialog and the print sheet are not its locals any more.
  const reg = register();
  for (const local of ['const [confirm, setConfirm]', 'const [historyFor,', 'const [printingId,', 'function rowItems(']) {
    assert.ok(!reg.includes(local), `the register still declares ${local}`);
  }
  assert.match(reg, /useReportRowActions\(\{/, 'the register does not use the shared actions');
  // ...and it still names how IT opens a record, which is the half that is not
  // shared: the register opens it in the side panel.
  assert.match(reg, /onOpen: \(r\) => setOpenId\(r\.id\)/, 'the register lost its own way in');
});

test('Home offers the same actions, and its own way in', () => {
  const home = welcome();
  assert.match(home, /useReportRowActions\(\{/, 'Home does not use the shared actions');
  // Home NAVIGATES to a report rather than opening a panel inside itself.
  assert.match(home, /onOpen: onOpenReport,/, 'Home no longer says how it opens a record');
  // Archiving from Home has to announce itself and re-read the list, which is
  // what the shell's toast and its list-bump are for.
  assert.match(home, /onChanged,/, 'Home does not tell the shell that a record moved');
  assert.match(home, /onError: notify,/, 'Home has nowhere to report a failed action');
  // Home's list is drafts, so it never asks for the archived variant.
  assert.match(home, /showArchived: false,/, 'Home is asking for the archive view');
  assert.match(home, /\{actions\.dialogs\}/, 'Home does not draw the shared dialogs');
});

test('Home is handed the toast and the list-bump it needs, from the shell', () => {
  // A prop that is never passed is the failure mode here: the actions would run,
  // and the outcome would go nowhere and the list would stay stale.
  assert.match(
    SHELL,
    /<ReportWelcome[\s\S]*?notify=\{notify\}\s*\n\s*onChanged=\{bumpList\}/,
    'the shell does not pass Home the toast and the list-bump its actions need',
  );
});
