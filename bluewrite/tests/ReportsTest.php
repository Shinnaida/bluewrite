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
