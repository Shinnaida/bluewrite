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
    /** The scratch DB's own id for a seeded account (see the base case's seed). */
    private function userId(string $username): int
    {
        return (int) $this->db()->query(
            'SELECT id FROM bluewrite_test.users WHERE username = ' . $this->db()->quote($username)
        )->fetchColumn();
    }

    private function seedReports(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $this->createReport($officerCookie, $officerCsrf, [
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-03-02T21:30',
            'location' => 'Crossing Lutac, Naga City',
            'narrative' => 'Suspect took a mobile phone from the complainant.',
        ]);
        // Canonical type name, not the legacy 'Physical Injury' alias: the
        // fixture carries v3 party GROUPS, and ReportRules::groupsFor() is
        // keyed by canonical name, so a legacy name with groups is rejected
        // ("type_specific.complainant must be a scalar value"). A real legacy
        // client sends flat scalars, never groups — this is only a fixture.
        $this->createReport($officerCookie, $officerCsrf, [
            'incident_type' => 'Assault / Physical Injury',
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

    /**
     * A REPORT NUMBER is what an officer most often arrives with, and the
     * register's own field says so in as many words — "Search by report number,
     * location, or type…" (owner request, 2026-10-07). The number is not a
     * column: it is the record's id, spelled the way the app spells it
     * (BW-0319, see reportNumber() in the register), so every spelling an
     * officer might type has to find the report — and a number nobody carries is
     * still no match.
     */
    public function testKeywordSearchFindsAReportByItsNumber(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'narrative' => 'Nothing numeric in here.',
        ]);
        $id = (int) $report['id'];
        $padded = str_pad((string) $id, 4, '0', STR_PAD_LEFT);

        // What is printed on the sheet, and what an officer who remembers it
        // types: the number with and without its prefix, padded and bare — and
        // with the prefix standing apart from the digits, which is two words.
        foreach (["BW-{$padded}", "bw{$id}", $padded, (string) $id, "BW {$padded}", "bw {$id}"] as $typed) {
            $res = $this->request('GET', '/reports?q=' . urlencode($typed), null, $cookie);
            $this->assertSame(
                1,
                $res['body']['pagination']['total'],
                "searching \"{$typed}\" should find report {$id}"
            );
            $this->assertSame($id, $res['body']['reports'][0]['id']);
        }

        // A number no report carries is not a match.
        $res = $this->request('GET', '/reports?q=' . ($id + 5000), null, $cookie);
        $this->assertSame(0, $res['body']['pagination']['total']);
    }

    /**
     * The number is an ALTERNATIVE, not a filter: a word that happens to be a
     * number still finds the report whose narrative carries it, and finding by
     * number never takes a report away from the rest of the search.
     */
    public function testANumericWordStillSearchesTheReportItself(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->createReport($cookie, $csrf, [
            'narrative' => 'Recovered 7 mobile phones beside the videoke bar.',
        ]);

        $res = $this->request('GET', '/reports?q=7', null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        // The word it belongs to still narrows that report further.
        $res = $this->request('GET', '/reports?q=' . urlencode('7 videoke'), null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);
        $res = $this->request('GET', '/reports?q=' . urlencode('7 motorcycle'), null, $cookie);
        $this->assertSame(0, $res['body']['pagination']['total']);
    }

    /**
     * Every person a report names has to be findable — the party groups, the
     * representative who files for an organization, and the reporting party
     * that lives on the report row itself. A name that is on the report but
     * not in the search is a report the officer cannot find.
     */
    public function testKeywordSearchFindsEveryPersonNamedOnAReport(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->createReport($cookie, $csrf, [
            'reporter_name' => 'Bituin, Clara',
            'type_specific' => [
                'item_stolen' => 'One shoulder bag containing cash',
                'owner_of_property' => 'Reyes, Ana M.',
                'complainant' => [[
                    'name' => 'Reyes, Ana M.',
                    'victim_type' => 'Organization',
                    'representative_name' => 'Villamor, Nestor',
                ]],
                'respondent' => [['name' => 'Bautista, Lito', 'suspect_status' => 'Identified']],
                'witness' => [['name' => 'Marasigan, Fely']],
            ],
        ]);

        // Victim, suspect and witness live only in the type_specific groups.
        foreach (['Reyes', 'Bautista', 'Marasigan'] as $party) {
            $res = $this->request('GET', '/reports?q=' . urlencode($party), null, $cookie);
            $this->assertSame(1, $res['body']['pagination']['total'], "{$party} should be findable");
        }

        // The representative who reports for an organization is a person too.
        $res = $this->request('GET', '/reports?q=Villamor', null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        // …and the reporting party is named on the report ROW, not in a group.
        $res = $this->request('GET', '/reports?q=Bituin', null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        // A name nobody carries is still no match.
        $res = $this->request('GET', '/reports?q=Zzzznobody', null, $cookie);
        $this->assertSame(0, $res['body']['pagination']['total']);
    }

    /**
     * The search takes the words an officer types, not the stored spelling.
     * Parties are recorded "Last Name, First Name, M.I." (the form placeholders
     * say so), so "Ana Reyes" — how the name is said — used to match nothing
     * while "Reyes, Ana" did.
     */
    public function testKeywordSearchMatchesANameInNaturalOrder(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->createReport($cookie, $csrf, [
            'type_specific' => [
                'item_stolen' => 'One shoulder bag containing cash',
                'complainant' => [['name' => 'Reyes, Ana M.']],
            ],
        ]);

        $res = $this->request('GET', '/reports?q=' . urlencode('Ana Reyes'), null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        // The stored order keeps working, phrase included.
        $res = $this->request('GET', '/reports?q=' . urlencode('Reyes, Ana'), null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);

        // Every word still has to match: one word nothing carries is no match.
        $res = $this->request('GET', '/reports?q=' . urlencode('Ana Zzzznobody'), null, $cookie);
        $this->assertSame(0, $res['body']['pagination']['total']);

        // …including a word that belongs to a DIFFERENT report.
        $this->createReport($cookie, $csrf, [
            'type_specific' => [
                'item_stolen' => 'One bicycle',
                'complainant' => [['name' => 'Bautista, Ana']],
            ],
        ]);
        $res = $this->request('GET', '/reports?q=' . urlencode('Ana Reyes'), null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);
        $res = $this->request('GET', '/reports?q=' . urlencode('Ana Bautista'), null, $cookie);
        $this->assertSame(1, $res['body']['pagination']['total']);
    }

    /** A pasted paragraph must not compile a statement with hundreds of terms. */
    public function testKeywordSearchRejectsAnAbsurdNumberOfWords(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->seedReports();

        $res = $this->request('GET', '/reports?q=' . urlencode(implode(' ', array_fill(0, 13, 'word'))), null, $cookie);
        $this->assertSame(422, $res['status']);

        // Twelve is still a search, and still answers (nothing carries them).
        $res = $this->request('GET', '/reports?q=' . urlencode(implode(' ', array_fill(0, 12, 'zzword'))), null, $cookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame(0, $res['body']['pagination']['total']);
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

        // `filed` is the officer's own filter (owner request, 2026-10-13): the
        // officer's screens offer no `submitted`, so their FINALIZED option asks
        // for everything that has left their hands — submitted AND finalized,
        // the same set the `submitted` bucketed shelf holds, and never a draft.
        // Asserted against the two statuses it folds, not against a number, so
        // this keeps testing the union if the seed ever grows a submitted row.
        $submitted = $this->request('GET', '/reports?status=submitted', null, $officerCookie);
        $filed = $this->request('GET', '/reports?status=filed', null, $officerCookie);
        $this->assertSame(
            $submitted['body']['pagination']['total'] + 1,
            $filed['body']['pagination']['total'],
        );
        $this->assertSame(1, $filed['body']['pagination']['total']);
        $this->assertSame('finalized', $filed['body']['reports'][0]['status']);

        // ...and the bucket the officer's own shelf counts carries that set too,
        // so the tab and the filter can never disagree about a report.
        $bucketed = $this->request('GET', '/reports?bucket=submitted', null, $officerCookie);
        $this->assertSame($filed['body']['pagination']['total'], $bucketed['body']['pagination']['total']);

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

        // Ascending by type puts "Assault / Physical Injury" first.
        $res = $this->request('GET', '/reports?sort=incident_type&dir=asc', null, $cookie);
        $this->assertSame('Assault / Physical Injury', $res['body']['reports'][0]['incident_type']);

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

    /**
     * The Admin-only `created_by` filter: one officer's own blotter.
     *
     * This is the query behind the account page in User Management (an administrator
     * opening a colleague reads what they have recorded). It is deliberately the SAME
     * list query with one more clause rather than a second summary endpoint, so the
     * count, the statuses and the derived verification state on that page are the
     * numbers All Reports shows — which is why `pagination.total` here is asserted
     * rather than just the rows.
     */
    public function testCreatedByFilterIsAdminOnlyAndScopesTheTotal(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $this->seedReports();
        $officerId = $this->userId('t.officer');

        // THE ADMIN, asking about the officer: the same three seeds, and a total that is
        // THAT OFFICER'S rather than the station's.
        [$adminCookie] = $this->login('t.admin');
        $res = $this->request('GET', '/reports?created_by=' . $officerId, null, $adminCookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame(3, $res['body']['pagination']['total']);
        foreach ($res['body']['reports'] as $row) {
            $this->assertSame($officerId, (int) $row['created_by']);
        }

        // An account that has recorded nothing is an EMPTY LIST, not an error: that is a
        // real answer to the question the account page asks.
        $staffId = $this->userId('t.staff');
        $res = $this->request('GET', '/reports?created_by=' . $staffId, null, $adminCookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame(0, $res['body']['pagination']['total']);

        // REFUSED RATHER THAN IGNORED for everyone else. A Staff account is already scoped
        // to its own reports, so intersecting the two clauses would answer 200 with an
        // empty blotter — which reads as "that colleague has never recorded anything"
        // rather than as "you may not ask that".
        $res = $this->request('GET', '/reports?created_by=' . $staffId, null, $officerCookie);
        $this->assertSame(403, $res['status']);

        [$staffCookie] = $this->login('t.staff');
        $res = $this->request('GET', '/reports?created_by=' . $officerId, null, $staffCookie);
        $this->assertSame(403, $res['status']);

        // Absent (0) is not a filter at all, so every existing caller of this list is
        // unaffected — the Admin's own view is still the whole station.
        $res = $this->request('GET', '/reports', null, $adminCookie);
        $this->assertSame(3, $res['body']['pagination']['total']);
    }
}
