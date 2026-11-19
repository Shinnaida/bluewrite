// BlueWrite — the phone arrival banner (PhoneArrivalWatcher).
//
// WHAT THIS PINS. The banner is the only thing that tells an officer their
// phone filing reached the portal, and it fails SILENTLY: a rule that is one
// condition too tight simply never draws the card, and the officer concludes the
// capture was lost. It shipped once with such a rule — the first poll treated
// the register's head as already-seen, so a filing that was waiting when the
// portal loaded never bannered (owner report, 2026-11-18: "the issue is that
// this is gone and I want this back"). These tests read the component as TEXT
// and assert the four questions it must ask, plus the absence of the rule that
// swallowed it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const watcher = readFileSync(
  new URL('../../src/components/reports/PhoneArrivalWatcher.jsx', import.meta.url),
  'utf8',
);
const shell = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../app/controllers/ReportsController.php', import.meta.url), 'utf8');

test('the poll asks for drafts, newest edit first', () => {
  assert.match(watcher, /const LIST_PATH = '\/reports\?status=draft&sort=updated_at&dir=desc&per_page=\d+'/);
  assert.match(watcher, /await api\(LIST_PATH\)/);
  // ...and the server still answers exactly those two parameters: `status` is
  // an allowlist and `updated_at` is what a phone filing has in common with
  // nothing else in the register.
  assert.match(controller, /elseif \(in_array\(\$status, \['draft', 'submitted', 'finalized'\], true\)\)/);
  assert.match(controller, /'updated_at' => 'r\.updated_at'/);
});

test('a waiting filing banners even when it was already there at page load', () => {
  // The old head-learning rule is gone: no seen-id is learned from a poll.
  assert.doesNotMatch(watcher, /seenRef|readSeen\(|writeSeen\(|bw\.arrivalSeen/);
  // The only watermark is what the officer dealt with, and it can only rise.
  assert.match(watcher, /dueRef\.current = readDue\(user\.id\)/);
  assert.match(watcher, /\.filter\(\(r\) => Number\(r\.id\) > dueRef\.current\)/);
  assert.match(watcher, /dueRef\.current = Math\.max\(dueRef\.current, shownRef\.current\)/);
});

test('only this officer\'s own untouched, still-waiting filing banners', () => {
  assert.match(watcher, /Number\(r\.created_by\) === Number\(user\.id\)/);
  assert.match(watcher, /Number\(r\.capture_count\) > 0/);
  assert.match(watcher, /String\(r\.updated_at\) === String\(r\.created_at\)/);
  assert.match(watcher, /openRef\.current !== Number\(r\.id\)/);
});

test('a TYPED phone filing banners too, with no capture at all (2026-11-19)', () => {
  // "when the notes in the app is continue to write report it would also show
  // like the second image": the typed blotter files a draft with no photo, so
  // the card has to read the draft's own client mark (migration 032).
  assert.match(
    watcher,
    /Number\(r\.capture_count\) > 0 \|\| String\(r\.filed_from \|\| ''\) === 'phone'/, 
  );
  assert.match(watcher, /Phone blotter filed — draft #\{arrival\.id\} is waiting\./);
  assert.match(watcher, /Open it to review its text, then insert\./);
  // The browser never creates a filed_from draft; the web stays silent.
  assert.match(controller, /\$filedFrom !== 'phone'/);
  assert.match(controller, /\$params\[':filed_from'\] = \$filedFrom/);
  // The register list carries the mark for the watcher to read.
  assert.match(controller, /\$filedSelect = \$hasFiledFrom \? 'r\.filed_from, ' : ''/);
  // ...and both phone filing paths name their client.
  const textFiling = readFileSync(
    new URL('../../../blotter-app/lib/screens/write_blotter_screen.dart', import.meta.url),
    'utf8',
  );
  const photoFiling = readFileSync(
    new URL('../../../blotter-app/lib/screens/review_screen.dart', import.meta.url),
    'utf8',
  );
  assert.match(textFiling, /'filed_from': 'phone'/);
  assert.match(photoFiling, /'filed_from': 'phone'/);
});

test('dismissing is remembered, so the same filing does not nag', () => {
  assert.match(watcher, /`bw\.arrivalDue\.\$\{uid\}`/);
  assert.match(watcher, /window\.localStorage\.setItem\(dueKey\(uid\), String\(id\)\)/);
  // Both actions retire the card through the one path that writes the mark.
  assert.match(watcher, /const dismiss = \(\) => retireRef\.current\(\);/);
  assert.match(watcher, /retireRef\.current\(\);\s*\n\s*onOpenReport\?\.\(id\)/);
});

test('Review now lands on the filing, not on a narrative the phone already wrote', () => {
  const editor = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  // The banner's press carries the intent into the view...
  assert.match(
    shell,
    /onOpenReport=\{\(reportId\) => setView\(\{ kind: 'report', id: reportId, revealSource: true \}\)\}/,
  );
  // ...which the editor is handed, and only for a report view.
  assert.match(shell, /revealSource=\{view\.kind === 'report' && view\.revealSource === true\}/);
  assert.match(editor, /revealSource = false,/);
  // A phone filing puts the same words in the narrative AND the capture, so the
  // "already written" test would skip the page that was just asked for: the
  // intent wins over it, once, on load.
  assert.match(
    editor,
    /\(revealSource && \(Array\.isArray\(loaded\) \? loaded\.find\(\(c\) => c && !c\.reviewed_at\) : null\)\) \|\|/,
  );
  // ...and what opens is the blotter dialog with the capture's own source text.
  assert.match(editor, /text: c\.ocr_text \|\| '',/);
});

test('the card is still the one the officer was shown, on every screen', () => {
  assert.match(watcher, /Phone capture filed — draft #\{arrival\.id\} is waiting\./);
  assert.match(watcher, /Open it to review the photo beside its text, then insert\./);
  assert.match(watcher, /className="arrival-toast"/);
  assert.match(shell, /import PhoneArrivalWatcher from '\.\/reports\/PhoneArrivalWatcher\.jsx'/);
  assert.match(shell, /<PhoneArrivalWatcher[\s\S]*?onOpenReport=/);
});
