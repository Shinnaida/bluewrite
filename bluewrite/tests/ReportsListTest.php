<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 2 — server-side list features (UC-012/013/014):
 * keyword search, type/status filters, date range, sort allowlist,
 * pagination metadata. The list response must include `pagination`.
 */
final class ReportsListTest extends BaseApiTestCase
{
    private function seedReports(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $this->createReport($officerCookie, $officerCsrf, [
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-03-02T21:30',
            'location' => 'Crossing Lutac, Naga City',
            'narrative' => 'Suspect took a mobile phone from the complainant.',
        ]);
        $this->createReport($officerCookie, $officerCsrf, [
            'incident_type' => 'Physical Injury',
            'incident_datetime' => '2026-03-05T06:45',
            'location' => 'National Highway, Naga City',
            'narrative' => 'Respondent punched complainant near a videoke bar.',
        ]);
        $this->createReport($officerCookie, $officerCsrf, [
            'incident_type' => 'Robbery',
            'incident_datetime' => '2026-04-10T18:15',
            'location' => 'Purok 3, West Poblacion',
            'narrative' => 'Hold-up incident along the highway.',
        ]);
    }

    public function testListReturnsPaginationMetadata(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        $res = $this->request('GET', '/reports', null, $cookie);
        $this->assertSame(200, $res['status']);
        $this->assertArrayHasKey('pagination', $res['body']);
        $this->assertSame(3, $res['body']['pagination']['total']);
        $this->assertSame(1, $res['body']['pagination']['page']);
    }

    public function testKeywordSearchMatchesLocationAndNarrative(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        // 'Lutac' appears only in a location.
        $res = $this->request('GET', '/reports?q=' . urlencode('Lutac'), null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);
        $this->assertSame('Crossing Lutac, Naga City', $res['body']['reports'][0]['location']);

        // 'videoke' appears only in a narrative.
        $res = $this->request('GET', '/reports?q=videoke', null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        // No match anywhere.
        $res = $this->request('GET', '/reports?q=zzznomatch', null, $cookie);
        $this->assertSame(0, $res['body']['pagination']['total']);
        $this->assertSame([], $res['body']['reports']);
    }

    public function testTypeFilter(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        $res = $this->request('GET', '/reports?type=Theft', null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);
        $this->assertSame('Theft', $res['body']['reports'][0]['incident_type']);

        // Unknown type is rejected, not silently ignored.
        $res = $this->request('GET', '/reports?type=' . urlencode('Alien Invasion'), null, $cookie);
        $this->assertSame(422, $res['status']);
    }

    public function testStatusFilter(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $this->seedReports();

        // Finalize one report so we have both statuses.
        $list = $this->request('GET', '/reports?type=Theft', null, $officerCookie);
        $id = (int) $list['body']['reports'][0]['id'];
        $this->patchReport($officerCookie, $officerCsrf, $id, ['status' => 'finalized']);

        $res = $this->request('GET', '/reports?status=finalized', null, $officerCookie);
        $this->assertSame(1, $res['body']['pagination']['total']);
        $this->assertSame('finalized', $res['body']['reports'][0]['status']);

        $res = $this->request('GET', '/reports?status=draft', null, $officerCookie);
        $this->assertSame(2, $res['body']['pagination']['total']);

        $res = $this->request('GET', '/reports?status=bogus', null, $officerCookie);
        $this->assertSame(422, $res['status']);
    }

    public function testDateRangeFilterIsInclusive(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        // March only (bounds inclusive).
        $res = $this->request('GET', '/reports?date_from=2026-03-01&date_to=2026-03-31', null, $cookie);
        $this->assertSame(2, $res['body']['pagination']['total']);

        // Single exact day.
        $res = $this->request('GET', '/reports?date_from=2026-04-10&date_to=2026-04-10', null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        $res = $this->request('GET', '/reports?date_from=not-a-date', null, $cookie);
        $this->assertSame(422, $res['status']);
    }

    public function testSortAllowlistRejectsUnknownFields(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        // Ascending by type puts "Physical Injury" first.
        $res = $this->request('GET', '/reports?sort=incident_type&dir=asc', null, $cookie);
        $this->assertSame('Physical Injury', $res['body']['reports'][0]['incident_type']);

        // SQL-injection-ish values must be rejected, never interpolated.
        $res = $this->request('GET', '/reports?sort=narrative;DROP%20TABLE%20users', null, $cookie);
        $this->assertSame(422, $res['status']);

        $res = $this->request('GET', '/reports?sort=(SELECT%201)', null, $cookie);
        $this->assertSame(422, $res['status']);
    }

    public function testPaginationSlicesResults(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        // per_page is clamped to [5, 100], so per_page=2 behaves as 5 and
        // all three seeds fit on one page.
        $res = $this->request('GET', '/reports?per_page=2&page=1', null, $cookie);
        $this->assertCount(3, $res['body']['reports']);
        $this->assertSame(1, $res['body']['pagination']['total_pages']);

        // A page beyond the last simply returns an empty slice.
        $res = $this->request('GET', '/reports?per_page=2&page=9', null, $cookie);
        $this->assertCount(0, $res['body']['reports']);
        $this->assertSame(3, $res['body']['pagination']['total']);
    }
}
