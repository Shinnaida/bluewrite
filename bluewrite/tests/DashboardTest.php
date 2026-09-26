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
        $this->assertSame(['total', 'pending', 'submitted', 'finalized', 'periodDeltaPct'], array_keys($b['kpis']));
        $this->assertSame(1, $b['kpis']['total']);
        $this->assertSame(1, $b['kpis']['pending']);
        $this->assertSame(0, $b['kpis']['submitted']);
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
        $this->assertSame(['draft' => 2, 'submitted' => 0, 'final' => 1], $res['body']['statusBreakdown']);

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

        // The hour strip carries the same filter: two Robbery reports today means the
        // strip totals two, whichever hours they landed in.
        $this->assertSame(2, array_sum(array_column($b['hourHistogram'], 'count')));
        $this->assertSame(['Robbery'], array_column($b['categoryBreakdown'], 'type'));

        // Unknown type values are rejected (allowlist), never trusted raw.
        $res2 = $this->request('GET', '/dashboard/stats?type=' . urlencode("Robbery'; DROP TABLE reports;--"), null, $cookie);
        $this->assertSame(200, $res2['status']);
        $this->assertNull($res2['body']['meta']['type']);
        $this->assertSame(3, $res2['body']['kpis']['total'], 'injection attempt must be ignored, not executed');
    }

    /**
     * The hour panel draws the range's own shape: every day in the range summed into the
     * same 24 buckets, so the strip reads as "a day in this range" rather than as any one
     * day — and so a single busy night cannot move a bar on its own.
     *
     * Two things fail quietly on their own. The buckets must be ZERO-FILLED and in clock
     * order: the client indexes the strip by hour, so a gap or a reordering would draw
     * every number under the wrong axis while looking fine. And the hours must come from
     * the INCIDENT time rather than the filing time, or the chart answers a different
     * question that happens to have the same shape.
     */
    public function testHourHistogramIsZeroFilledAndCountsIncidentHours(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $today = date('Y-m-d');
        // Two in one incident hour, one in another — and filed in a third, which is the
        // hour a created_at version of this query would have counted them in.
        $this->createReport($cookie, $csrf, ['incident_datetime' => $today . 'T10:30']);
        $this->createReport($cookie, $csrf, ['incident_datetime' => $today . 'T10:45']);
        $this->createReport($cookie, $csrf, ['incident_datetime' => $today . 'T23:05']);

        $res = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $hours = $res['body']['hourHistogram'];

        $this->assertSame(range(0, 23), array_column($hours, 'hour'), 'every hour of the day, in clock order');
        $this->assertSame(3, array_sum(array_column($hours, 'count')));
        $this->assertSame(2, $hours[10]['count'], 'both 10:xx incidents land in the same bucket');
        $this->assertSame(1, $hours[23]['count']);
        for ($h = 0; $h <= 23; $h++) {
            if ($h !== 10 && $h !== 23) {
                $this->assertSame(0, $hours[$h]['count'], "hour {$h} must be a real 0, not a missing row");
            }
        }

        // The strip totals the range, not a window of it: the same three reports are in
        // the KPI, because both read the same WHERE.
        $this->assertSame(3, $res['body']['kpis']['total']);
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

    /**
     * S-01 preflight: the second factor's health rides the dashboard so a station
     * can see a mail problem BEFORE a shift, not when an officer is already locked
     * out. The block names no credential — only whether mail can send, over which
     * transport, and how many active Admin/Officer accounts hold a route.
     */
    public function testSignInHealthPreflightsTheSecondFactor(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $officerId = $this->accountId('t.officer');

        $res = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $signIn = $res['body']['signIn'] ?? null;
        $this->assertIsArray($signIn, 'the dashboard must carry the sign-in preflight');
        foreach (['mailConfigured', 'mailTransport', 'accountsWithEmail', 'accountsWithRecovery', 'accountsWithoutFactor'] as $key) {
            $this->assertArrayHasKey($key, $signIn);
        }
        $this->assertIsBool($signIn['mailConfigured']);
        $this->assertContains($signIn['mailTransport'], ['smtp', 'log'], 'the transport is reported as one of the two the mailer has');
        // Every seeded Admin/Officer that owes a factor has an address, so nobody
        // is the count that must be zero.
        $this->assertGreaterThanOrEqual(2, $signIn['accountsWithEmail']);
        $this->assertSame(0, $signIn['accountsWithoutFactor']);
        $this->assertSame(0, $signIn['accountsWithRecovery'], 'no set is issued in the seed');

        // Issuing an offline set moves the recovery count — the preflight reads
        // the same table the sign-in does.
        $issued = $this->request('POST', "/users/{$officerId}/recovery-codes", null, $cookie, $csrf);
        $this->assertSame(201, $issued['status'], json_encode($issued['body']));
        $after = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(1, $after['body']['signIn']['accountsWithRecovery']);

        // Removing BOTH routes puts the account in the count that must be zero.
        $this->db()->exec("UPDATE bluewrite_test.users SET email = NULL WHERE id = {$officerId}");
        $this->db()->exec("DELETE FROM bluewrite_test.mfa_recovery_codes WHERE user_id = {$officerId}");
        $worse = $this->request('GET', '/dashboard/stats', null, $cookie);
        $this->assertSame(1, $worse['body']['signIn']['accountsWithoutFactor'], 'an account with no route at all must be counted');
    }
}
