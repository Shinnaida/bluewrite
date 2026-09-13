<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 4 — Dashboard stats endpoint (UC-017).
 *
 * Covers: auth required, ADMIN-ONLY access (Officer/Staff → 403, product
 * decision Sep 2026), response shape, KPI math, zero-filled daily series,
 * incident-type filter, admin 'mine' scope, date validation, and the
 * 366-day range cap.
 */
final class DashboardTest extends BaseApiTestCase
{
    public function testStatsRequireAuthentication(): void
    {
        $res = $this->request('GET', '/dashboard/stats');
        $this->assertSame(401, $res['status']);
    }

    public function testAdminGetsStationWideStatsWithExpectedShape(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $this->createReport($cookie, $csrf, [
            'incident_type' => 'Theft',
            'incident_datetime' => date('Y-m-d\TH:i'),
        ]);

        $res = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(200, $res['status'], json_encode($res['body']));

        $b = $res['body'];
        foreach (['kpis', 'seriesOverTime', 'categoryBreakdown', 'statusBreakdown', 'recentActivity', 'meta'] as $key) {
            $this->assertArrayHasKey($key, $b);
        }
        $this->assertSame(['total', 'pending', 'finalized', 'periodDeltaPct'], array_keys($b['kpis']));
        $this->assertSame(1, $b['kpis']['total']);
        $this->assertSame(1, $b['kpis']['pending']);
        $this->assertSame(0, $b['kpis']['finalized']);
        $this->assertSame('all', $b['meta']['scope']);
        // Default window is 30 days → 30 zero-filled buckets.
        $this->assertCount(30, $b['seriesOverTime']);
        $this->assertSame(1, $b['seriesOverTime'][array_key_last($b['seriesOverTime'])]['count']);
    }

    public function testKpiMathCountsDraftsAndFinalizedSeparately(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $today = date('Y-m-d\TH:i');
        $this->createReport($cookie, $csrf, ['incident_datetime' => $today]);
        $this->createReport($cookie, $csrf, ['incident_datetime' => $today]);
        $report = $this->createReport($cookie, $csrf, ['incident_datetime' => $today]);
        // POST always creates drafts (by design) — finalize via the workflow.
        $this->patchReport($cookie, $csrf, (int) $report['id'], ['status' => 'finalized']);

        $res = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame(3, $res['body']['kpis']['total']);
        $this->assertSame(2, $res['body']['kpis']['pending']);
        $this->assertSame(1, $res['body']['kpis']['finalized']);
        $this->assertSame(['draft' => 2, 'final' => 1], $res['body']['statusBreakdown']);

        // Finalized reports must still appear in the totals (deleted_at is the
        // only thing excluded — archived reports never pollute the dashboard).
        $this->assertSame(3, $res['body']['seriesOverTime'][array_key_last($res['body']['seriesOverTime'])]['count']);

        // Trend vs. previous (empty) period: +100%.
        $this->assertSame(100, $res['body']['kpis']['periodDeltaPct']);
    }

    public function testTypeFilterNarrowsAllSections(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $today = date('Y-m-d\TH:i');
        $this->createReport($cookie, $csrf, ['incident_type' => 'Theft', 'incident_datetime' => $today]);
        $this->createReport($cookie, $csrf, ['incident_type' => 'Robbery', 'incident_datetime' => $today]);
        $this->createReport($cookie, $csrf, ['incident_type' => 'Robbery', 'incident_datetime' => $today]);

        $res = $this->request('GET', '/dashboard/stats?type=' . urlencode('Robbery'), null, $cookie);
        $this->assertSame(200, $res['status']);
        $b = $res['body'];
        $this->assertSame(2, $b['kpis']['total']);
        $this->assertCount(1, $b['categoryBreakdown']);
        $this->assertSame('Robbery', $b['categoryBreakdown'][0]['type']);
        $this->assertSame('Robbery', $b['meta']['type']);

        // Unknown type values are rejected (allowlist), never trusted raw.
        $res2 = $this->request('GET', '/dashboard/stats?type=' . urlencode("Robbery'; DROP TABLE reports;--"), null, $cookie);
        $this->assertSame(200, $res2['status']);
        $this->assertNull($res2['body']['meta']['type']);
        $this->assertSame(3, $res2['body']['kpis']['total'], 'injection attempt must be ignored, not executed');
    }

    public function testOfficerAndStaffAreForbidden(): void
    {
        [$offCookie] = $this->login('t.officer');
        [$staffCookie] = $this->login('t.staff');

        // The dashboard is Admin-only. Officers and staff are rejected
        // server-side — hiding the sidebar button alone is not enforcement.
        $resOff = $this->request('GET', '/dashboard/stats', null, $offCookie);
        $this->assertSame(403, $resOff['status']);

        $resStaff = $this->request('GET', '/dashboard/stats?scope=all', null, $staffCookie);
        $this->assertSame(403, $resStaff['status']);
    }

    public function testAdminCanUseMineScope(): void
    {
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        [$offCookie, $offCsrf] = $this->login('t.officer');
        $today = date('Y-m-d\TH:i');

        $this->createReport($offCookie, $offCsrf, ['incident_datetime' => $today]);
        $this->createReport($adminCookie, $adminCsrf, ['incident_datetime' => $today]);
        $this->createReport($adminCookie, $adminCsrf, ['incident_datetime' => $today]);

        $res = $this->request('GET', '/dashboard/stats?scope=mine', null, $adminCookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame('mine', $res['body']['meta']['scope']);
        $this->assertSame(2, $res['body']['kpis']['total'], 'mine scope counts only the admin\'s own reports');
    }

    public function testInvalidDatesAreRejected(): void
    {
        [$cookie] = $this->login('t.admin');
        $res = $this->request('GET', '/dashboard/stats?from=not-a-date', null, $cookie);
        $this->assertSame(200, $res['status'], 'invalid dates fall back to defaults');
        $this->assertSame(date('Y-m-d'), $res['body']['meta']['to']);
    }

    public function testRangeIsCappedAt366Days(): void
    {
        [$cookie] = $this->login('t.admin');
        $res = $this->request('GET', '/dashboard/stats?from=2020-01-01&to=' . date('Y-m-d'), null, $cookie);
        $this->assertSame(422, $res['status']);
    }

    public function testArchivedReportsAreExcluded(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $today = date('Y-m-d\TH:i');
        $this->createReport($cookie, $csrf, ['incident_datetime' => $today]);
        $gone = $this->createReport($cookie, $csrf, ['incident_datetime' => $today]);

        $this->request('DELETE', "/reports/{$gone['id']}", null, $cookie, $csrf);

        $res = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame(1, $res['body']['kpis']['total']);
        $this->assertSame(1, $res['body']['seriesOverTime'][array_key_last($res['body']['seriesOverTime'])]['count']);
    }
}
