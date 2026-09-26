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

    /**
     * The incident's OWN kind has to be recorded before it can be submitted.
     * ReportRules::TYPE_RULES mirrors `required` on TYPE_FIELDS in
     * src/lib/incidentTypes.js — the shape of the list is pinned there by
     * tests/rules/reportRules.test.mjs, and this proves the API enforces it too:
     * the form is only the first gate.
     */
    public function testFinalizeRequiresTheIncidentTypesOwnFields(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'type_specific' => ['complainant' => [['name' => 'Ana Cruz']]],
        ]);
        $id = (int) $report['id'];

        // Gate 1 is untouched: the same half-written blob saves without complaint.
        $saved = $this->patchReport($cookie, $csrf, $id, ['location' => 'Somewhere else']);
        $this->assertSame(200, $saved['status'], json_encode($saved['body']));

        $res = $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized']);
        $this->assertSame(422, $res['status']);
        $details = implode(' | ', (array) ($res['body']['details'] ?? []));
        $this->assertStringContainsString('item_stolen', $details, $details);
        $this->assertStringContainsString('how_property_was_taken', $details, $details);
        // Owner of Property is NOT one of the things demanded here: the Victims
        // row the officer already recorded carries it (it is derived from
        // complainant[0].name — see ReportRules::MIRRORS), so the report cannot
        // be told to say the same thing twice.
        $this->assertStringNotContainsString('owner_of_property', $details, $details);

        // Supplying them in the same PATCH finalizes cleanly — and the owner is
        // still on the record, because the victim's name fills it in.
        $ok = $this->patchReport($cookie, $csrf, $id, [
            'status' => 'finalized',
            'type_specific' => [
                'item_stolen' => 'One shoulder bag containing cash',
                'how_property_was_taken' => 'Snatched by a passer-by on a motorcycle',
                'complainant' => [['name' => 'Ana Cruz']],
            ],
        ]);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));

        $raw = $this->db()->query("SELECT type_specific FROM bluewrite_test.reports WHERE id = {$id}")->fetchColumn();
        $stored = json_decode((string) $raw, true);
        $this->assertSame('Ana Cruz', $stored['owner_of_property'] ?? null, 'the victim fills Owner of Property');
    }

    /**
     * The flat scalars the v3 groups superseded are DERIVED on write, so a
     * client that sends only the group rows still produces a report the printed
     * sheet can read — and the officer is never asked the same question twice.
     * Mirrors `mirrorOf` in src/lib/incidentTypes.js and ReportRules::MIRRORS.
     */
    public function testGroupRowsFillTheFlatScalarsTheSheetReads(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'type_specific' => [
                'how_property_was_taken' => 'The padlock was cut at the bicycle rack',
                'complainant' => [['name' => 'Ana Cruz']],
                'stolen_items' => [
                    ['item_description' => 'Copper wire', 'quantity' => '128m', 'estimated_value' => '8500'],
                    ['item_description' => 'Assorted tools'],
                ],
            ],
        ]);
        $id = (int) $report['id'];

        $raw = $this->db()->query("SELECT type_specific FROM bluewrite_test.reports WHERE id = {$id}")->fetchColumn();
        $ts = json_decode((string) $raw, true);

        $this->assertSame('Copper wire', $ts['item_stolen'] ?? null, 'Item mirrors the first Stolen Items row');
        $this->assertSame('Copper wire', $ts['item_description'] ?? null);
        $this->assertSame('128m', $ts['quantity'] ?? null);
        $this->assertSame('8500', $ts['estimated_value'] ?? null);
        $this->assertSame('Ana Cruz', $ts['owner_of_property'] ?? null);
        // The rows themselves are untouched: the mirror is an addition.
        $this->assertCount(2, $ts['stolen_items']);

        // A report with NO item rows keeps whatever it was filed with — an
        // empty group must never blank a scalar.
        $legacy = $this->createReport($cookie, $csrf, [
            'type_specific' => [
                'item_stolen' => 'One shoulder bag',
                'owner_of_property' => 'Ana Lopez',
                'how_property_was_taken' => 'Snatched on the street',
                'complainant' => [['name' => 'Ana Lopez']],
            ],
        ]);
        $legacyRaw = $this->db()->query(
            "SELECT type_specific FROM bluewrite_test.reports WHERE id = " . (int) $legacy['id']
        )->fetchColumn();
        $legacyTs = json_decode((string) $legacyRaw, true);
        $this->assertSame('One shoulder bag', $legacyTs['item_stolen'] ?? null);
        $this->assertSame('Ana Lopez', $legacyTs['owner_of_property'] ?? null);

        // And it still finalizes cleanly: the Item field, not a row, is the
        // record when nothing was taken.
        $finalized = $this->patchReport($cookie, $csrf, (int) $legacy['id'], ['status' => 'finalized']);
        $this->assertSame(200, $finalized['status'], json_encode($finalized['body']));
    }

    /**
     * A row in a group is a record, not a placeholder: a victim with no name is
     * caught (and an UNIDENTIFIED suspect stays recordable by description —
     * covered on the JS side, where the shapes are pinned).
     */
    public function testARecordedGroupRowMustBeARecord(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'type_specific' => [
                'item_stolen' => 'One shoulder bag',
                'owner_of_property' => 'Ana Cruz',
                'how_property_was_taken' => 'Snatched on the street',
                'complainant' => [['address' => 'Poblacion, City of Naga']],
            ],
        ]);

        $res = $this->patchReport($cookie, $csrf, (int) $report['id'], ['status' => 'finalized']);
        $this->assertSame(422, $res['status']);
        $details = implode(' | ', (array) ($res['body']['details'] ?? []));
        $this->assertStringContainsStringIgnoringCase('name required', $details, $details);
    }

    /**
     * A suspect nobody can name is still a person the report has to DESCRIBE.
     *
     * Once the identity is Unknown the name is not on the form, so the server
     * cannot accept a name as the row's content either — and must refuse a row
     * that answered "Unknown" and stopped there. Mirrors
     * GROUP_ROW_RULES.requireAnyWhen in src/lib/incidentTypes.js.
     */
    public function testAnUnidentifiedSuspectMustBeDescribedNotNamed(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $base = [
            'item_stolen' => 'One shoulder bag',
            'owner_of_property' => 'Ana Cruz',
            'how_property_was_taken' => 'Snatched on the street at the crossing',
            'complainant' => [['name' => 'Ana Cruz']],
        ];

        // Unknown, and nothing else: a status is not a description.
        $bare = $this->createReport($cookie, $csrf, [
            'type_specific' => $base + ['respondent' => [['suspect_status' => 'Unidentified']]],
        ]);
        $bareRes = $this->patchReport($cookie, $csrf, (int) $bare['id'], ['status' => 'finalized']);
        $this->assertSame(422, $bareRes['status']);
        $details = implode(' | ', (array) ($bareRes['body']['details'] ?? []));
        $this->assertStringContainsStringIgnoringCase('description of the person', $details, $details);

        // Unknown WITH one descriptive detail is a record — and the name it
        // arrived with is not stored beside it.
        $described = $this->createReport($cookie, $csrf, [
            'type_specific' => $base + ['respondent' => [[
                'suspect_status' => 'Unidentified',
                'name' => 'Pedro Reyes',
                'height' => "5'7\"",
                'clothing' => 'Dark jacket, dark jeans, black cap',
            ]]],
        ]);
        $stored = json_decode((string) self::db()->query(
            'SELECT type_specific FROM bluewrite_test.reports WHERE id = ' . (int) $described['id']
        )->fetchColumn(), true);
        $this->assertArrayNotHasKey(
            'name',
            $stored['respondent'][0] ?? [],
            'an unidentified row must not keep a name the form never asked for',
        );
        $this->assertSame('Dark jacket, dark jeans, black cap', $stored['respondent'][0]['clothing'] ?? null);
        $ok = $this->patchReport($cookie, $csrf, (int) $described['id'], ['status' => 'finalized']);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));

        // A name alone, while the identity is Unknown, is not a way out: the
        // field is not on screen for that row.
        $named = $this->createReport($cookie, $csrf, [
            'type_specific' => $base + ['respondent' => [[
                'suspect_status' => 'Unidentified',
                'name' => 'Pedro Reyes',
            ]]],
        ]);
        $namedRes = $this->patchReport($cookie, $csrf, (int) $named['id'], ['status' => 'finalized']);
        $this->assertSame(422, $namedRes['status']);

        // Known, with a name: the ordinary case, unchanged.
        $known = $this->createReport($cookie, $csrf, [
            'type_specific' => $base + ['respondent' => [[
                'suspect_status' => 'Identified',
                'name' => 'Pedro Reyes',
            ]]],
        ]);
        $knownRes = $this->patchReport($cookie, $csrf, (int) $known['id'], ['status' => 'finalized']);
        $this->assertSame(200, $knownRes['status'], json_encode($knownRes['body']));
    }

    /** The folder tally keyed `status|type`, for readable assertions. */
    private function folderTally(array $folders): array
    {
        $out = [];
        foreach ($folders as $row) {
            $out[$row['status'] . '|' . $row['incident_type']] = (int) $row['count'];
        }
        return $out;
    }

    /**
     * The folder shelf, and the `bucket` it shares with the list.
     *
     * Two rules are pinned here, and they are the two that would break the
     * register silently:
     *   - SUBMITTED IS EVERYTHING THAT HAS GONE FORWARD. A finalized report sits
     *     on the Submitted shelf, because that shelf asks "is this still the
     *     officer's to finish?" rather than "what is its exact status?";
     *   - the count on a folder face and the rows inside it are the SAME SET,
     *     because both ride the one filter pipeline. A folder promising three
     *     and opening onto two is a register lying about itself.
     */
    public function testTheFolderShelfCountsWhatTheListShows(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $this->createReport($cookie, $csrf);
        $this->createReport($cookie, $csrf);
        $finalized = $this->createReport($cookie, $csrf);
        $fin = $this->patchReport($cookie, $csrf, (int) $finalized['id'], ['status' => 'finalized']);
        $this->assertSame(200, $fin['status'], json_encode($fin['body']));
        $this->createReport($cookie, $csrf, [
            'incident_type' => 'Robbery',
            'type_specific' => [
                'property_taken' => 'One shoulder bag',
                'method_used' => 'Snatched on the street at the crossing',
                'weapon_involved' => 'No',
                'complainant' => [['name' => 'Ana Cruz']],
            ],
        ]);

        $folders = $this->request('GET', '/reports/folders', null, $cookie);
        $this->assertSame(200, $folders['status'], json_encode($folders['body']));
        // The endpoint returns the RAW status tally — which statuses share a
        // shelf is the register's own decision (statusBucket in
        // src/lib/reportFolder.js), stated once on the client rather than twice.
        $tally = $this->folderTally($folders['body']['folders']);
        $this->assertSame(2, $tally['draft|Theft'] ?? null, json_encode($tally));
        $this->assertSame(1, $tally['finalized|Theft'] ?? null, json_encode($tally));
        $this->assertSame(1, $tally['draft|Robbery'] ?? null, json_encode($tally));
        $this->assertSame(4, (int) $folders['body']['total']);

        // A DRAFT folder shows only what is still being written...
        $drafts = $this->request('GET', '/reports/folders?bucket=draft&type=Theft', null, $cookie);
        $this->assertSame(200, $drafts['status']);
        $this->assertSame(2, (int) $drafts['body']['total']);
        // ...and SUBMITTED holds the finalized report, which is the whole point
        // of the bucket: a finalized report is the locked end state of submitted.
        $submitted = $this->request('GET', '/reports/folders?bucket=submitted&type=Theft', null, $cookie);
        $this->assertSame(200, $submitted['status']);
        $this->assertSame(1, (int) $submitted['body']['total']);

        // The LIST honours the same bucket, which is what makes a folder's face
        // and its contents the same set of reports.
        $list = $this->request('GET', '/reports?bucket=draft&type=Theft', null, $cookie);
        $this->assertSame(200, $list['status']);
        $this->assertSame(2, (int) $list['body']['pagination']['total']);
        foreach ($list['body']['reports'] as $row) {
            $this->assertSame('draft', $row['status']);
        }

        // An unknown shelf is refused rather than silently ignored — a typo must
        // not read as "a shelf with nothing on it".
        $bad = $this->request('GET', '/reports/folders?bucket=archived', null, $cookie);
        $this->assertSame(422, $bad['status']);
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
