<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Item 4 — Reports tests: validation errors, finalize completeness check,
 * soft-delete only (no hard deletes), restore behavior (Item 2).
 */
final class ReportsTest extends BaseApiTestCase
{
    public function testCreateReportRequiresKnownIncidentType(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/reports', [
            'incident_type' => 'Alien Invasion',
            'incident_datetime' => '2026-09-01T08:30',
            'location' => 'Test Location',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(422, $res['status']);
    }

    public function testCreateReportRejectsMissingLocation(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-09-01T08:30',
            'location' => '',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(422, $res['status']);
        $this->assertArrayHasKey('fields', $res['body']);
    }

    public function testCreateReportRejectsInvalidDatetime(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_datetime' => 'not-a-date',
            'location' => 'Test Location',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(422, $res['status']);
    }

    public function testFinalizeRequiresNarrative(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['narrative' => '']);

        $res = $this->patchReport($cookie, $csrf, (int) $report['id'], ['status' => 'finalized']);
        $this->assertSame(422, $res['status']);
        $this->assertStringContainsString('narrative', $res['body']['error']);
    }

    /**
     * Migration 004: a report may not be finalized without an Action Taken /
     * Status. The rule is enforced server-side too (the form is only the
     * first gate).
     */
    public function testFinalizeRequiresActionTaken(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['action_taken' => '']);

        $res = $this->patchReport($cookie, $csrf, (int) $report['id'], ['status' => 'finalized']);
        $this->assertSame(422, $res['status']);
        $this->assertStringContainsString('action taken', strtolower((string) ($res['body']['error'] ?? '')));

        // Supplying it in the same PATCH finalizes cleanly.
        $ok = $this->patchReport($cookie, $csrf, (int) $report['id'], [
            'status' => 'finalized',
            'action_taken' => 'Subject turned over to the station for proper disposition.',
        ]);
        $this->assertSame(200, $ok['status']);
    }

    /** Migration 004: the IOC name is required to finalize as well. */
    public function testFinalizeRequiresIoc(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['ioc_name' => '']);

        $res = $this->patchReport($cookie, $csrf, (int) $report['id'], ['status' => 'finalized']);
        $this->assertSame(422, $res['status']);
        $this->assertStringContainsString('investigator-on-case', strtolower((string) ($res['body']['error'] ?? '')));

        $ok = $this->patchReport($cookie, $csrf, (int) $report['id'], [
            'status' => 'finalized',
            'ioc_name' => 'Sgt. Test Investigator',
        ]);
        $this->assertSame(200, $ok['status']);
    }

    public function testArchiveIsSoftDeleteOnly(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);

        $del = $this->request('DELETE', "/reports/{$report['id']}", null, $cookie, $csrf);
        $this->assertSame(200, $del['status']);

        // Row must still exist with deleted_at set — never hard-deleted.
        $row = self::db()->query('SELECT deleted_at FROM bluewrite_test.reports WHERE id = ' . (int) $report['id'])->fetch();
        $this->assertNotFalse($row, 'archived report row must still exist');
        $this->assertNotNull($row['deleted_at']);

        // And it no longer appears in the active list.
        $list = $this->request('GET', '/reports', null, $cookie);
        $ids = array_column($list['body']['reports'], 'id');
        $this->assertNotContains((int) $report['id'], $ids);
    }

    public function testUserDeactivateIsSoftOnly(): void
    {
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        // Deactivate the Staff user (id 3) — not the last admin, allowed.
        $res = $this->request('DELETE', '/users/3', null, $adminCookie, $adminCsrf);
        $this->assertSame(200, $res['status']);

        $row = self::db()->query('SELECT status FROM bluewrite_test.users WHERE id = 3')->fetch();
        $this->assertNotFalse($row, 'deactivated user row must still exist (soft delete)');
        $this->assertSame('inactive', $row['status']);
    }

    public function testRestoreBringsArchivedReportBack(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $report = $this->createReport($officerCookie, $officerCsrf);

        $this->request('DELETE', "/reports/{$report['id']}", null, $officerCookie, $officerCsrf);

        // Officer may not restore (Admin-only).
        $forbidden = $this->request('PATCH', "/reports/{$report['id']}/restore", null, $officerCookie, $officerCsrf);
        $this->assertSame(403, $forbidden['status']);

        // Admin restores it.
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $ok = $this->request('PATCH', "/reports/{$report['id']}/restore", null, $adminCookie, $adminCsrf);
        $this->assertSame(200, $ok['status']);

        $row = self::db()->query('SELECT deleted_at FROM bluewrite_test.reports WHERE id = ' . (int) $report['id'])->fetch();
        $this->assertNull($row['deleted_at'], 'restored report must have deleted_at cleared');

        // History snapshot for the restore is written.
        $hist = $this->request('GET', "/reports/{$report['id']}/history", null, $adminCookie);
        $notes = array_column($hist['body']['history'], 'change_note');
        $this->assertContains('Report restored from archive.', $notes);
    }

    public function testHistoryEndpointReturnsSnapshots(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);
        $this->patchReport($cookie, $csrf, (int) $report['id'], ['location' => 'Updated location']);

        $res = $this->request('GET', "/reports/{$report['id']}/history", null, $cookie);
        $this->assertSame(200, $res['status']);
        $this->assertCount(2, $res['body']['history']); // created + updated
        $first = $res['body']['history'][0];
        foreach (['change_note', 'snapshot', 'created_at', 'changed_by'] as $key) {
            $this->assertArrayHasKey($key, $first);
        }
    }
}
