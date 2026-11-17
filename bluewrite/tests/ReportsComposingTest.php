<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

// The latch window is a constant on the controller, for the same reason the
// message-typing tests require theirs: a test that typed `15` here would agree
// with the code only until the code changed.
require_once __DIR__ . '/../app/controllers/ReportsController.php';

use App\Controllers\ReportsController;

/**
 * The "somebody is composing a report" latch (migration 030).
 *
 * Covers the whole contract: POST /reports/:id/composing stamps one row per
 * writer, GET /users and GET /presence/snapshot read it back fresh, a second
 * ping replaces the stamp, an old stamp claims nothing, and the gate is the
 * same one every report write uses — a session and a real report.
 */
final class ReportsComposingTest extends BaseApiTestCase
{
    private function rowFor(array $users, string $username): array
    {
        foreach ($users as $row) {
            if (($row['username'] ?? null) === $username) {
                return $row;
            }
        }
        $this->fail("{$username} is not in the directory.");

        return [];
    }

    private function readDirectory(string $cookie): array
    {
        $res = $this->request('GET', '/users', null, $cookie);
        $this->assertSame(200, $res['status']);

        return $res['body']['users'];
    }

    public function testComposingPingFlagsTheWriterOnTheDirectoryAndTheSnapshot(): void
    {
        $window = ReportsController::COMPOSING_WINDOW;
        [$adminCookie] = $this->login('t.admin');
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $report = $this->createReport($officerCookie, $officerCsrf);

        // NOTHING COMPOSING YET. A missing latch reads as null, not as
        // unknown — there is no third answer the board could draw.
        $users = $this->readDirectory($adminCookie);
        $this->assertNull($this->rowFor($users, 't.officer')['composing_report_id']);

        $ping = $this->request('POST', '/reports/' . $report['id'] . '/composing', null, $officerCookie, $officerCsrf);
        $this->assertSame(200, $ping['status'], json_encode($ping['body']));

        // THE DIRECTORY CARRIES IT: the writer's row names the report, while
        // an account that touched nothing reads null.
        $users = $this->readDirectory($adminCookie);
        $officer = $this->rowFor($users, 't.officer');
        $this->assertSame((int) $report['id'], $officer['composing_report_id']);
        $this->assertNull($this->rowFor($users, 't.admin')['composing_report_id']);

        // A LATCH, NOT A LOG: the second ping rewrites the stamp.
        $this->request('POST', '/reports/' . $report['id'] . '/composing', null, $officerCookie, $officerCsrf);
        $rows = (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.report_composing')->fetchColumn();
        $this->assertSame(1, $rows, 'a second ping replaces the stamp rather than adding a row');

        // THE SNAPSHOT CARRIES IT TOO, for the live tick — but only for
        // accounts inside the presence window, so the officer is stamped seen
        // first, the way a heartbeat would have left them.
        $this->db()->exec("UPDATE bluewrite_test.users SET last_seen_at = NOW() WHERE username = 't.officer'");
        $snap = $this->request('GET', '/presence/snapshot', null, $adminCookie);
        $this->assertSame(200, $snap['status']);
        $found = null;
        foreach ($snap['body']['online'] as $entry) {
            if (($entry['id'] ?? null) === $officer['id']) {
                $found = $entry;
            }
        }
        $this->assertNotNull($found, 'the officer is not on the snapshot');
        $this->assertSame((int) $report['id'], $found['composing_report_id']);

        // IT EXPIRES WITH NOBODY CLEANING UP. A session that died mid-sentence
        // leaves a stamp that stops claiming anything on both reads.
        $this->db()->exec(
            'UPDATE bluewrite_test.report_composing SET updated_at = NOW() - INTERVAL ' . ($window + 1) . ' SECOND'
        );
        $users = $this->readDirectory($adminCookie);
        $this->assertNull($this->rowFor($users, 't.officer')['composing_report_id'], 'a stale latch still flags the directory');
        $snap = $this->request('GET', '/presence/snapshot', null, $adminCookie);
        foreach ($snap['body']['online'] as $entry) {
            if (($entry['id'] ?? null) === $officer['id']) {
                $this->assertNull($entry['composing_report_id'], 'a stale latch still flags the snapshot');
            }
        }

        // The gate is the same one every report write uses: a session, and a
        // report that exists and is not deleted.
        $anonymous = $this->request('POST', '/reports/' . $report['id'] . '/composing');
        $this->assertContains($anonymous['status'], [401, 419], 'composing is not an anonymous act');
        $missing = $this->request('POST', '/reports/999999/composing', null, $officerCookie, $officerCsrf);
        $this->assertSame(404, $missing['status']);
    }

    public function testLivePeekReturnsAnExcerptAndWritesNoTrail(): void
    {
        [$adminCookie] = $this->login('t.admin');
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $report = $this->createReport($officerCookie, $officerCsrf);
        $id = (int) $report['id'];

        // A short narrative first: the excerpt IS the document, and the flag
        // says so — the drawer must not print an ellipsis it did not earn.
        $peek = $this->request('GET', '/reports/' . $id . '/live', null, $adminCookie);
        $this->assertSame(200, $peek['status'], json_encode($peek['body']));
        $this->assertSame($id, $peek['body']['report']['id']);
        $this->assertSame('draft', $peek['body']['report']['status']);
        $this->assertSame('Test narrative for the report.', $peek['body']['report']['narrative_excerpt']);
        $this->assertFalse($peek['body']['report']['narrative_truncated']);

        // A narrative long enough to prove the excerpt is an excerpt.
        $long = str_repeat('The officer walked the length of the market row. ', 20);
        $patch = $this->patchReport($officerCookie, $officerCsrf, $id, ['narrative' => $long]);
        $this->assertSame(200, $patch['status'], 'could not lengthen the narrative: ' . json_encode($patch['body']));

        $before = (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.audit_logs')->fetchColumn();
        $peek = $this->request('GET', '/reports/' . $id . '/live', null, $adminCookie);
        $this->request('GET', '/reports/' . $id . '/live', null, $adminCookie);
        $after = (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.audit_logs')->fetchColumn();
        $this->assertSame($before, $after, 'live peeks must not write the trail they are read from');
        $this->assertSame(600, mb_strlen($peek['body']['report']['narrative_excerpt']));
        $this->assertTrue($peek['body']['report']['narrative_truncated']);
        $this->assertNotNull($peek['body']['report']['updated_at']);

        // The gate is printData's own: a session, and a report that exists.
        // (Officers may view every report, so no 403 lives on this route —
        // the retired Staff role is covered by printData's own tests.)
        $anonymous = $this->request('GET', '/reports/' . $id . '/live');
        $this->assertContains($anonymous['status'], [401, 419], 'the peek is not an anonymous act');
        $missing = $this->request('GET', '/reports/999999/live', null, $adminCookie);
        $this->assertSame(404, $missing['status']);
    }
}
