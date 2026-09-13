<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Item 4 — RBAC tests: Staff cannot finalize, non-owner cannot edit,
 * finalized reports locked except Admin, last admin cannot be deactivated.
 * Permissions are enforced server-side; these tests hit the API directly.
 */
final class RbacTest extends BaseApiTestCase
{
    public function testStaffCannotFinalize(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $report = $this->createReport($staffCookie, $staffCsrf, ['narrative' => 'Complete narrative for finalize.']);

        $res = $this->patchReport($staffCookie, $staffCsrf, (int) $report['id'], ['status' => 'finalized']);
        $this->assertSame(403, $res['status']);
        $this->assertStringContainsString('finalize', $res['body']['error']);
    }

    public function testOfficerCanFinalizeOwnReport(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $report = $this->createReport($officerCookie, $officerCsrf, ['narrative' => 'Complete narrative for finalize.']);

        $res = $this->patchReport($officerCookie, $officerCsrf, (int) $report['id'], ['status' => 'finalized']);
        $this->assertSame(200, $res['status']);
    }

    public function testNonOwnerOfficerCannotEditAnotherUsersReport(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $report = $this->createReport($staffCookie, $staffCsrf);

        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $res = $this->patchReport($officerCookie, $officerCsrf, (int) $report['id'], ['location' => 'Hijacked']);
        $this->assertSame(403, $res['status']);
        $this->assertStringContainsString('only edit reports you recorded', $res['body']['error']);
    }

    public function testAdminCanEditAnotherUsersReport(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $report = $this->createReport($staffCookie, $staffCsrf);

        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $res = $this->patchReport($adminCookie, $adminCsrf, (int) $report['id'], ['location' => 'Admin corrected location']);
        $this->assertSame(200, $res['status']);
    }

    public function testFinalizedReportLockedForNonAdmin(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $report = $this->createReport($officerCookie, $officerCsrf, ['narrative' => 'Narrative before finalize.']);
        $this->patchReport($officerCookie, $officerCsrf, (int) $report['id'], ['status' => 'finalized']);

        // Same (non-admin) user cannot edit it anymore.
        $res = $this->patchReport($officerCookie, $officerCsrf, (int) $report['id'], ['location' => 'Changed after finalize']);
        $this->assertSame(403, $res['status']);
        $this->assertStringContainsString('finalized and locked', $res['body']['error']);
    }

    public function testFinalizedReportEditableByAdmin(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $report = $this->createReport($officerCookie, $officerCsrf, ['narrative' => 'Narrative before finalize.']);
        $this->patchReport($officerCookie, $officerCsrf, (int) $report['id'], ['status' => 'finalized']);

        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $res = $this->patchReport($adminCookie, $adminCsrf, (int) $report['id'], ['location' => 'Admin correction']);
        $this->assertSame(200, $res['status']);
    }

    public function testLastAdminCannotBeDemotedOrSelfDeactivated(): void
    {
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        // t.admin is the only active admin in the fresh seed.

        // Demoting the last admin is blocked by the last-admin guard.
        $demote = $this->request('PATCH', '/users/1', ['role' => 'Officer'], $adminCookie, $adminCsrf);
        $this->assertSame(409, $demote['status']);
        $this->assertStringContainsString('last active administrator', $demote['body']['error']);

        // Deactivating your own signed-in account is blocked outright.
        $self = $this->request('DELETE', '/users/1', null, $adminCookie, $adminCsrf);
        $this->assertSame(409, $self['status']);
        $this->assertStringContainsString('your own account', $self['body']['error']);
    }

    public function testStaffCannotListUsers(): void
    {
        [$staffCookie] = $this->login('t.staff');
        $res = $this->request('GET', '/users', null, $staffCookie);
        $this->assertSame(403, $res['status']);
    }
}
