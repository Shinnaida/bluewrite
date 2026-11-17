<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * The directory's right hand — `GET /users` carries each account's filings.
 *
 * WHAT THIS COVERS. The directory answers "how many, and when" itself rather
 * than opening every account: the index counts live reports per author plus a
 * sparse per-day map for the miniature — two grouped queries for the whole
 * station rather than one read per row. The endpoint under test is still hit
 * over HTTP and its answer read as JSON; the reports go through the real route
 * and only their DATES are moved by hand (the API stamps `created_at` as now,
 * and no honest filing produces a spread of days).
 */
final class UsersDirectoryTest extends BaseApiTestCase
{
    private function userId(string $username): int
    {
        return (int) $this->db()->query(
            'SELECT id FROM bluewrite_test.users WHERE username = ' . $this->db()->quote($username)
        )->fetchColumn();
    }

    /** Move a report's creation stamp N days into the past. */
    private function backdate(int $reportId, int $days): string
    {
        $day = (new \DateTimeImmutable('today'))->modify("-{$days} days")->format('Y-m-d');
        $this->db()->exec(
            "UPDATE bluewrite_test.reports SET created_at = '{$day} 10:00:00' WHERE id = {$reportId}"
        );

        return $day;
    }

    /** The directory, as the admin reads it. */
    private function readDirectory(string $cookie): array
    {
        $res = $this->request('GET', '/users', null, $cookie);
        $this->assertSame(200, $res['status']);
        $this->assertArrayHasKey('users', $res['body']);

        return $res['body']['users'];
    }

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

    public function testEachRowCarriesItsLiveCountAndItsFilingDays(): void
    {
        [$adminCookie] = $this->login('t.admin');
        [$officerCookie, $officerCsrf] = $this->login('t.officer');

        // Three filed on three days, one of them deleted: the register hides
        // `deleted_at` rows, so a count that included them would disagree with
        // every screen that lists reports.
        $first = $this->createReport($officerCookie, $officerCsrf);
        $second = $this->createReport($officerCookie, $officerCsrf);
        $third = $this->createReport($officerCookie, $officerCsrf);
        $dayOne = $this->backdate((int) $first['id'], 5);
        $dayTwo = $this->backdate((int) $second['id'], 40);
        $this->db()->exec(
            "UPDATE bluewrite_test.reports SET deleted_at = NOW() WHERE id = {$third['id']}"
        );

        $users = $this->readDirectory($adminCookie);
        $officer = $this->rowFor($users, 't.officer');
        $this->assertSame(2, $officer['report_count']);
        // Loose on purpose: GROUP BY promises the groups, not their order.
        $this->assertEquals([$dayOne => 1, $dayTwo => 1], (array) $officer['report_days']);
    }

    public function testFilingsOutsideTheWindowCountNowhere(): void
    {
        [$adminCookie] = $this->login('t.admin');
        [$officerCookie, $officerCsrf] = $this->login('t.officer');

        // Older than the trailing 91 days: the count and the grid cover the
        // same ground, so it reads in neither.
        $old = $this->createReport($officerCookie, $officerCsrf);
        $this->backdate((int) $old['id'], 100);

        $users = $this->readDirectory($adminCookie);
        $officer = $this->rowFor($users, 't.officer');
        $this->assertSame(0, $officer['report_count']);
        $this->assertEquals([], (array) $officer['report_days']);
    }

    public function testAnAccountThatFiledNothingReadsZero(): void
    {
        [$adminCookie] = $this->login('t.admin');

        // No reports at all: a real zero the cell can print, not a missing key
        // the cell would have to guess at.
        $users = $this->readDirectory($adminCookie);
        $staff = $this->rowFor($users, 't.staff');
        $this->assertSame(0, $staff['report_count']);
        $this->assertEquals([], (array) $staff['report_days']);
    }

    public function testAFreshFilingMarksItsAuthorAsWritingUntilItAgesOut(): void
    {
        [$adminCookie] = $this->login('t.admin');
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $officerId = $this->userId('t.officer');

        // Filing goes through the real route, so the trail holds a genuine
        // `report.create` for the officer — the directory should read it back
        // as a writing stamp, while an account that touched nothing reads null.
        $this->createReport($officerCookie, $officerCsrf);

        $users = $this->readDirectory($adminCookie);
        $officer = $this->rowFor($users, 't.officer');
        $this->assertNotNull($officer['last_report_write_at']);
        $admin = $this->rowFor($users, 't.admin');
        $this->assertNull($admin['last_report_write_at']);

        // Ten minutes on: the same touch has aged past the five-minute window
        // the panel draws, so the stamp must be gone rather than lingering.
        $this->db()->exec(
            "UPDATE bluewrite_test.audit_logs
             SET created_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE)
             WHERE user_id = {$officerId}
               AND action IN ('report.create', 'report.update', 'report.capture_add', 'ocr.read', 'ai.narrative.generate')"
        );

        $users = $this->readDirectory($adminCookie);
        $officer = $this->rowFor($users, 't.officer');
        $this->assertNull($officer['last_report_write_at']);
    }
}
