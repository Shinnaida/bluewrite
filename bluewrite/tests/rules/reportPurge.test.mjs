// BlueWrite — the archive's permanent delete (migration 031).
//
// WHAT THIS PINS. The station asked for a delete on archived reports, with a
// seven-day grace period and a restore, and every part of that promise is a rule
// in a different file: the window is a PHP constant, the stamp is SQL, the sweep
// is a private method, the route is a line in api/index.php, and the button is a
// menu item. These tests read those files as TEXT and assert the five together,
// because the failure that matters is not "the code threw" — it is a delete that
// happens at once, or a window a client can choose, or a restore that leaves the
// row on its way out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const controller = readFileSync(new URL('../../app/controllers/ReportsController.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../api/index.php', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../../src/components/reports/ReportActions.jsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('../../src/pages/ReportList.jsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/031_report_purge_grace.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../migrations/031_report_purge_grace.down.sql', import.meta.url), 'utf8');

test('the grace period is seven days, and the database stamps it', () => {
  assert.match(controller, /private const PURGE_GRACE_DAYS = 7;/);
  // The date is computed server-side from the constant — no request field and no
  // client clock can reach it.
  assert.match(controller, /DATE_ADD\(NOW\(\), INTERVAL ' \. self::PURGE_GRACE_DAYS \. ' DAY\)/);
  assert.doesNotMatch(controller, /purge_after = :/);
});

test('the migration adds the stamp, its author and the index the sweep needs', () => {
  assert.match(migration, /ADD COLUMN purge_after DATETIME NULL DEFAULT NULL/);
  assert.match(migration, /ADD COLUMN purge_requested_by INT UNSIGNED NULL DEFAULT NULL/);
  assert.match(migration, /ADD KEY idx_reports_purge_after \(purge_after\)/);
  // The rollback undoes exactly those three and nothing else.
  assert.match(rollback, /DROP FOREIGN KEY fk_reports_purge_by/);
  assert.match(rollback, /DROP KEY idx_reports_purge_after/);
  assert.match(rollback, /DROP COLUMN purge_after/);
});

test('only an administrator can schedule a delete, and only on an archived row', () => {
  assert.match(controller, /public function requestDeletion\(string \$id\): void\s*\{\s*\$user = Auth::requireRole\('Admin'\);/);
  // Archived specifically: a live report has to be archived first, so a delete
  // is never a one-click answer to a report somebody is still writing.
  assert.match(controller, /SELECT \* FROM reports WHERE id = :id AND deleted_at IS NOT NULL/);
  // Scheduling twice is refused rather than silently re-dated (which would let a
  // caller restart the clock forever).
  assert.match(controller, /This report is already scheduled for deletion\./);
});

test('the sweep removes only rows whose window has run out, children first', () => {
  assert.match(controller, /WHERE purge_after IS NOT NULL AND purge_after <= NOW\(\)/);
  assert.match(controller, /\$pdo->beginTransaction\(\);/);
  assert.match(
    controller,
    /foreach \(\['report_captures', 'report_composing', 'report_verifications', 'report_history'\] as \$table\)/,
  );
  // A restore that landed between the read and the delete wins.
  assert.match(controller, /AND deleted_at IS NOT NULL\s*\n\s*AND purge_after IS NOT NULL\s*\n\s*AND purge_after <= NOW\(\)/);
  // The phone photos go too, or the sweep would leak a file per deleted capture.
  assert.match(controller, /ReportCaptures::path\(\$name\)/);
});

test('the sweep runs on reads of the archive, so no cron is required', () => {
  assert.match(controller, /private function listQueryFilters\(array \$user, bool \$showArchived\): array\s*\{[\s\S]*?if \(\$showArchived\) \{\s*\$this->purgeExpiredReports\(Database::pdo\(\)\);\s*\}/);
});

test('restore is the undo for both halves — it clears the date as well as the archive', () => {
  assert.match(controller, /purge_after = NULL, purge_requested_by = NULL/);
  // The snapshot sentence stays the literal the notification feed matches, or a
  // restore would vanish from the feed the day it was cancelled.
  assert.match(controller, /'Report restored from archive\.'/);
});

test('the route exists and the archive menu offers the delete', () => {
  assert.match(routes, /if \(\$parts\[2\] === 'purge' && \$method === 'DELETE'\) \{\s*\$c->requestDeletion\(\(string\) \$seg1\);/);
  assert.match(actions, /api\(`\/reports\/\$\{r\.id\}\/purge`, \{ method: 'DELETE' \}\)/);
  assert.match(actions, /label: 'Delete permanently', danger: true/);
  // Once scheduled, the item becomes the countdown and cannot be pressed again.
  assert.match(actions, /label: `Deletes in \$\{days\} day\$\{days === 1 \? '' : 's'\}`/);
  assert.match(actions, /hint: 'Already scheduled — Restore cancels it\.'/);
  // Officers see nothing here at all: the archive and its delete are an
  // administrator's, and the menu says so rather than drawing a dead item.
  assert.match(actions, /if \(user\.role !== 'Admin'\) return \[\];/);
});

test('the countdown is the server date, rounded up, and drawn on the row', () => {
  assert.match(actions, /export function daysUntilPurge\(purgeAfter, now = Date\.now\(\)\)/);
  assert.match(actions, /Math\.max\(0, Math\.ceil\(\(when - now\) \/ 86400000\)\)/);
  assert.match(list, /daysUntilPurge\(report\.purge_after\)/);
  assert.match(list, /className="badge purge"/);
});
