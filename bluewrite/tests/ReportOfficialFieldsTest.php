<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Part 1 of the PNP Police Report specification — data model.
 *
 * Covers the specification's §1.1 station settings, §1.2 per-report fields,
 * §1.3–§1.5 victim / suspect / stolen-item storage, §1.9 personnel-backed
 * Noted By, and §1.10 the updated_by audit column.
 */
final class ReportOfficialFieldsTest extends BaseApiTestCase
{
    // ---- §1.1 station settings ------------------------------------------

    public function testStationSettingsExposeHeaderTypesAndPersonnel(): void
    {
        [$cookie] = $this->login('t.officer');
        $res = $this->request('GET', '/station', null, $cookie);

        $this->assertSame(200, $res['status']);
        $header = $res['body']['header'];
        // Seeded from what the sheet printed before this migration, so an
        // existing install's letterhead is unchanged.
        $this->assertSame('Republic of the Philippines', $header['agency']);
        $this->assertStringContainsString('POLICE REGIONAL OFFICE', $header['regional_office']);
        $this->assertSame('NCPS – INVEST', $header['office_code']);

        $this->assertContains('Theft', $res['body']['incident_types']);
        $this->assertCount(14, $res['body']['incident_types']);

        // Personnel for the IOC / Noted By pickers: active Officers and
        // Admins only — never Staff, never a deactivated account.
        $names = array_column($res['body']['personnel'], 'full_name');
        $this->assertContains('Test Officer', $names);
        $this->assertContains('Test Admin', $names);
        $this->assertNotContains('Test Staff', $names);
        $this->assertNotContains('Inactive Officer', $names);
    }

    public function testOnlyAdminMayChangeStationSettings(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $denied = $this->request('PATCH', '/station', ['station_name' => 'RENAMED STATION'], $officerCookie, $officerCsrf);
        $this->assertSame(403, $denied['status']);

        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $ok = $this->request('PATCH', '/station', ['station_name' => 'RENAMED STATION'], $adminCookie, $adminCsrf);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));
        $this->assertSame('RENAMED STATION', $ok['body']['header']['station_name']);

        $after = $this->request('GET', '/station', null, $adminCookie);
        $this->assertSame('RENAMED STATION', $after['body']['header']['station_name']);

        // The change is audited like any other administrative act.
        $row = $this->db()->query("SELECT action FROM bluewrite_test.audit_logs ORDER BY id DESC LIMIT 1")->fetchColumn();
        $this->assertSame('station.update', $row);
    }

    public function testConfiguredIncidentTypesReplaceTheBuiltInList(): void
    {
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $types = ['Theft', 'Robbery', 'Other'];
        $res = $this->request('PATCH', '/station', ['incident_types' => $types], $adminCookie, $adminCsrf);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $this->assertSame($types, $res['body']['incident_types']);

        // A configured type is accepted...
        $this->assertSame(201, $this->request('POST', '/reports', [
            'incident_type' => 'Other',
            'incident_date' => '2026-09-01',
            'incident_time' => '08:30',
            'location' => 'Station front',
            'narrative' => 'n',
        ], $adminCookie, $adminCsrf)['status']);

        // ...and a type outside the station's list is refused.
        $rejected = $this->request('POST', '/reports', [
            'incident_type' => 'Fire Incident',
            'incident_date' => '2026-09-01',
            'location' => 'Station front',
            'narrative' => 'n',
        ], $adminCookie, $adminCsrf);
        $this->assertSame(422, $rejected['status']);
    }

    // ---- §1.2 official per-report fields --------------------------------

    public function testOfficialDateAndBlotterFieldsRoundTrip(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'report_date' => '2026-09-10',
            'blotter_no' => 'BL-2026-0098',
            'blotter_date' => '2026-09-09',
            'incident_date' => '2026-09-08',
            'incident_time' => '13:45',
            'incident_time_approximate' => true,
            'discovery_date' => '2026-09-08',
            'discovery_time' => '14:30',
            'location' => 'Public market, Naga City',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $row = $this->db()->query("SELECT * FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertSame('2026-09-10', $row['report_date']);
        $this->assertSame('BL-2026-0098', $row['blotter_no']);
        $this->assertSame('2026-09-09', $row['blotter_date']);
        $this->assertSame('2026-09-08', $row['incident_date']);
        $this->assertSame('13:45:00', $row['incident_time']);
        $this->assertSame(1, (int) $row['incident_time_approximate'], 'approximate qualifier persisted');
        $this->assertSame('2026-09-08', $row['discovery_date']);
        $this->assertSame('14:30:00', $row['discovery_time']);
        // The date and the time stay two fields; incident_datetime is only the
        // derived key the list/dashboard sort on.
        $this->assertSame('2026-09-08 13:45:00', $row['incident_datetime']);
    }

    public function testLegacyCombinedDatetimeStillWorksAndDerivesTheDateFields(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->createReport($cookie, $csrf, ['incident_datetime' => '2026-09-02T21:15']);
        $id = (int) $created['id'];

        $row = $this->db()->query("SELECT * FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertSame('2026-09-02', $row['incident_date']);
        $this->assertSame('21:15:00', $row['incident_time']);
        $this->assertSame(0, (int) $row['incident_time_approximate'], 'a legacy exact time is not flagged approximate');
        $this->assertSame(date('Y-m-d'), $row['report_date'], 'report date defaults to the day of encoding');
    }

    public function testUnknownTimeStaysEmptyInsteadOfAssumingMidnight(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-05',
            'incident_time_approximate' => true,
            'location' => 'Somewhere',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $row = $this->db()->query("SELECT * FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertNull($row['incident_time'], 'no time was recorded, so none is stored');
        $this->assertSame(1, (int) $row['incident_time_approximate']);
    }

    public function testFutureIncidentDateIsRejectedAndBlotterOrderWarns(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $future = date('Y-m-d', strtotime('+3 days'));
        $rejected = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => $future,
            'location' => 'Somewhere',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(422, $rejected['status']);

        // Blotter date after report date: flagged, not blocked (spec §5.10).
        $warned = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'report_date' => '2026-09-01',
            'blotter_date' => '2026-09-04',
            'blotter_no' => 'BL-77',
            'incident_date' => '2026-08-30',
            'location' => 'Somewhere',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(201, $warned['status'], json_encode($warned['body']));
        $this->assertNotEmpty($warned['body']['warnings']);
        $this->assertStringContainsString('blotter date', strtolower($warned['body']['warnings'][0]));
    }

    public function testRecordedByCannotBeOverriddenByThePayload(): void
    {
        [$cookie, $csrf, $user] = $this->login('t.officer');
        $created = $this->createReport($cookie, $csrf, [
            'created_by' => 1,
            'recorded_by' => 'Someone Else',
        ]);
        $row = $this->db()->query(
            "SELECT created_by FROM bluewrite_test.reports WHERE id = " . (int) $created['id']
        )->fetch();
        $this->assertSame((int) $user['id'], (int) $row['created_by'], 'creator is the session user');
    }

    // ---- §1.3–§1.5 victims, suspects, stolen items -----------------------

    public function testOrganizationVictimWithRepresentativeAndTwoSuspects(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-03',
            'location' => 'Warehouse, Naga City',
            'narrative' => 'n',
            'type_specific' => [
                'complainant' => [[
                    'name' => 'Juan Dela Cruz',
                    'victim_type' => 'Organization',
                    'representative_name' => 'Maria Santos',
                    'representative_position' => 'Store Manager',
                ]],
                'respondent' => [
                    ['suspect_status' => 'Identified', 'name' => 'Pedro Reyes', 'suspect_description' => 'Wearing a blue jacket'],
                    ['suspect_status' => 'Unidentified', 'suspect_description' => 'Rode a black motorcycle without a plate'],
                ],
            ],
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $raw = $this->db()->query("SELECT type_specific FROM bluewrite_test.reports WHERE id = {$id}")->fetchColumn();
        $ts = json_decode((string) $raw, true);
        $this->assertCount(2, $ts['respondent'], 'two suspects are stored as two items');
        $this->assertSame('Unidentified', $ts['respondent'][1]['suspect_status']);
        $this->assertSame('Organization', $ts['complainant'][0]['victim_type']);
        $this->assertSame('Store Manager', $ts['complainant'][0]['representative_position']);
    }

    public function testIndividualVictimWithoutRepresentativeIsAccepted(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-03',
            'location' => 'Somewhere',
            'narrative' => 'n',
            'type_specific' => [
                'complainant' => [['name' => 'Ana Cruz', 'victim_type' => 'Individual']],
            ],
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
    }

    public function testStolenItemsAreRepeatableAndAllowNoItemsAtAll(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        // Attempted incident: nothing was taken, so the group is simply absent.
        $attempted = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-03',
            'location' => 'Somewhere',
            'narrative' => 'n',
            'type_specific' => ['complainant' => [['name' => 'Ana Cruz']]],
        ], $cookie, $csrf);
        $this->assertSame(201, $attempted['status'], json_encode($attempted['body']));

        // Multiple rows, with the free-text quantities the spec requires and
        // one row whose value is unknown.
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-03',
            'location' => 'Somewhere',
            'narrative' => 'n',
            'type_specific' => [
                'complainant' => [['name' => 'Ana Cruz']],
                'stolen_items' => [
                    ['item_description' => 'Copper wire', 'quantity' => '128m', 'unit' => 'meters', 'estimated_value' => '8,500'],
                    ['item_description' => 'Assorted tools', 'quantity' => 'several, exact count unknown', 'estimated_value' => ''],
                ],
            ],
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $raw = $this->db()->query("SELECT type_specific FROM bluewrite_test.reports WHERE id = {$id}")->fetchColumn();
        $ts = json_decode((string) $raw, true);
        $this->assertCount(2, $ts['stolen_items']);
        $this->assertSame('128m', $ts['stolen_items'][0]['quantity'], 'quantity stays text, not a number');
        $this->assertSame('several, exact count unknown', $ts['stolen_items'][1]['quantity']);
    }

    public function testNonNumericEstimatedValueIsRejectedAtFinalize(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'report_date' => '2026-09-10',
            'incident_date' => '2026-09-09',
            'incident_time' => '10:00',
            'location' => 'Somewhere',
            'narrative' => 'A sufficiently long narrative describing what happened at the scene for the report.',
            'action_taken' => 'Subject turned over to the station for proper disposition.',
            'ioc_name' => 'Sgt. Test Investigator',
            'type_specific' => [
                'complainant' => [['name' => 'Ana Cruz']],
                'stolen_items' => [['item_description' => 'Wallet', 'estimated_value' => 'value pending']],
            ],
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $finalized = $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized']);
        $this->assertSame(422, $finalized['status'], 'a non-numeric amount cannot be finalized as-is');
    }

    // ---- §1.9 Noted By, §1.10 updated_by --------------------------------

    public function testNotedByIsStoredFromTheStationPersonnelList(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->createReport($cookie, $csrf);
        $id = (int) $created['id'];

        $personnel = $this->request('GET', '/station', null, $cookie)['body']['personnel'];
        $noter = null;
        foreach ($personnel as $p) {
            if ($p['full_name'] === 'Test Admin') {
                $noter = $p;
            }
        }
        $this->assertNotNull($noter, 'admin is offered as a noting officer');

        $ok = $this->patchReport($cookie, $csrf, $id, ['noted_by_id' => $noter['id']]);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));

        $row = $this->db()->query("SELECT * FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertSame('Test Admin', $row['noted_by_name']);
        $this->assertNotNull($row['noted_at']);

        // An id outside the personnel list is refused rather than stored.
        $bad = $this->patchReport($cookie, $csrf, $id, ['noted_by_id' => 999999]);
        $this->assertSame(422, $bad['status']);
    }

    public function testStaffCannotDesignateTheNotingOfficer(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $created = $this->createReport($officerCookie, $officerCsrf);

        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $denied = $this->patchReport($staffCookie, $staffCsrf, (int) $created['id'], ['noted_by_id' => 1]);
        $this->assertSame(403, $denied['status']);
    }

    public function testUpdatedByRecordsTheLastEditor(): void
    {
        [$cookie, $csrf, $user] = $this->login('t.officer');
        $created = $this->createReport($cookie, $csrf);
        $id = (int) $created['id'];

        $row = $this->db()->query("SELECT updated_by FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertNull($row['updated_by'], 'a fresh report has no editor yet');

        $this->assertSame(200, $this->patchReport($cookie, $csrf, $id, ['location' => 'Corrected location'])['status']);
        $row = $this->db()->query("SELECT updated_by FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertSame((int) $user['id'], (int) $row['updated_by']);
    }

    public function testFinalizeKeepsWorkingThroughTheDocumentDateFields(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'report_date' => '2026-09-10',
            'blotter_no' => 'BL-2026-0100',
            'blotter_date' => '2026-09-10',
            'incident_date' => '2026-09-09',
            'incident_time' => '09:00',
            'location' => 'Somewhere',
            'narrative' => 'A sufficiently long narrative describing what happened at the scene for the report.',            'action_taken' => 'Subject turned over to the station for proper disposition.',
            'ioc_name' => 'Sgt. Test Investigator',
            // Required at finalize (migration 006): who filed it and how to
            // reach them. Both of these tests finalize the report.
            'reporter_name' => 'Nita B. Ramos',
            'reporter_contact' => '(032) 555-1234',
            // Complete for the incident's OWN type too (ReportRules::TYPE_RULES),
            // since both of these tests finalize the report.
            'type_specific' => [
                'item_stolen' => 'One shoulder bag containing cash',
                'owner_of_property' => 'Ana Cruz',
                'how_property_was_taken' => 'Snatched by a passer-by on a motorcycle',
                'complainant' => [['name' => 'Ana Cruz', 'victim_type' => 'Individual']],
            ],
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $finalized = $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized']);
        $this->assertSame(200, $finalized['status'], json_encode($finalized['body']));

        $row = $this->db()->query("SELECT status, finalized_by FROM bluewrite_test.reports WHERE id = {$id}")->fetch();

        $this->assertSame('finalized', $row['status']);
        $this->assertNotNull($row['finalized_by']);
    }

    // ---- Write Report screen: the reporting party (migration 006) -------

    public function testReportingPartySurvivesASaveAndReload(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-14',
            'incident_time' => '21:15',
            'location' => 'Mercado Street',
            'narrative' => 'A sufficiently long narrative describing what happened at the scene for the report.',
            'reporter_name' => 'Nita B. Ramos',
            'reporter_contact' => '(032) 555-1234',
            'reporter_address' => 'Poblacion, City of Naga, Cebu',
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $loaded = $this->request('GET', "/reports/{$id}/print", null, $cookie);
        $this->assertSame(200, $loaded['status']);
        $report = $loaded['body']['report'];
        $this->assertSame('Nita B. Ramos', $report['reporter_name']);
        $this->assertSame('(032) 555-1234', $report['reporter_contact']);
        $this->assertSame('Poblacion, City of Naga, Cebu', $report['reporter_address']);
        // Nothing has been signed yet — the signature timestamp is set by the
        // submit transition, not by the draft.
        $this->assertNull($report['party_signed_at']);

        // The email address and the officer initials are NO LONGER collected: the
        // form does not draw either box. A body that still sends them is not an
        // error — an older client must keep working — it is simply ignored, and
        // the row is left as it was.
        $this->assertSame(200, $this->patchReport($cookie, $csrf, $id, [
            'reporter_email' => 'nita.ramos@example.gov.ph',
            'officer_initials' => 'J.D.C.',
        ])['status']);
        $row = $this->db()->query(
            "SELECT reporter_email, officer_initials FROM bluewrite_test.reports WHERE id = {$id}"
        )->fetch();
        $this->assertNull($row['reporter_email']);
        $this->assertNull($row['officer_initials']);
    }

    public function testADraftCanBeStartedBeforeTheReportingPartyIsKnown(): void
    {
        // The reporter is a FINALIZE requirement, not a create one: an officer
        // opens the report while the complainant is still at the desk and has
        // not yet given a callback number. Nothing about the party is needed to
        // save the draft.
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-14',
            'location' => 'Mercado Street',
            'narrative' => 'n',
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
    }

    public function testAReportCannotBeFinalizedWithoutTheReportingParty(): void
    {
        // WHO FILED IT is the report's minimum: a submission with no reporting
        // party and no contact number is refused, field by field, so the editor
        // can point at the two boxes that are missing.
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->createReport($cookie, $csrf, [
            'reporter_name' => '',
            'reporter_contact' => '',
        ]);
        $id = (int) $created['id'];

        $finalized = $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized']);
        $this->assertSame(422, $finalized['status']);
        $this->assertArrayHasKey('reporter_name', $finalized['body']['fields']);
        $this->assertArrayHasKey('reporter_contact', $finalized['body']['fields']);

        // Supplying both is the whole fix.
        $this->assertSame(200, $this->patchReport($cookie, $csrf, $id, [
            'reporter_name' => 'Nita B. Ramos',
            'reporter_contact' => '(032) 555-1234',
        ])['status']);
        $this->assertSame(200, $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized'])['status']);
    }

    public function testMalformedPartyDetailsAreRejectedOnSave(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $base = [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-14',
            'location' => 'Mercado Street',
            'narrative' => 'n',
        ];

        $badContact = $this->request('POST', '/reports', $base + ['reporter_contact' => 'call the station'], $cookie, $csrf);
        $this->assertSame(422, $badContact['status']);
        $this->assertArrayHasKey('reporter_contact', $badContact['body']['fields']);
    }

    public function testSubmittingTheReportStampsTheSignatureTimestamp(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-14',
            'location' => 'Mercado Street',
            'narrative' => 'A sufficiently long narrative describing what happened at the scene for the report.',
            'action_taken' => 'Subject turned over to the station for proper disposition.',
            'ioc_name' => 'Sgt. Test Investigator',
            'reporter_name' => 'Nita B. Ramos',
            'reporter_contact' => '(032) 555-1234',
            // Complete for the incident's OWN type too (ReportRules::TYPE_RULES),
            // since both of these tests finalize the report.
            'type_specific' => [
                'item_stolen' => 'One shoulder bag containing cash',
                'owner_of_property' => 'Ana Cruz',
                'how_property_was_taken' => 'Snatched by a passer-by on a motorcycle',
                'complainant' => [['name' => 'Ana Cruz', 'victim_type' => 'Individual']],
            ],
        ], $cookie, $csrf);
        $this->assertSame(201, $created['status'], json_encode($created['body']));
        $id = (int) $created['body']['report']['id'];

        $finalized = $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized']);
        $this->assertSame(200, $finalized['status'], json_encode($finalized['body']));

        $row = $this->db()->query("SELECT party_signed_at FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertNotNull($row['party_signed_at'], 'submitting the document dates the reporting party signature');

        // An edit that does NOT re-submit must not move the timestamp.
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $stamp = $row['party_signed_at'];
        $this->assertSame(200, $this->patchReport($adminCookie, $adminCsrf, $id, ['location' => 'Corrected place'])['status']);
        $after = $this->db()->query("SELECT party_signed_at FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertSame($stamp, $after['party_signed_at']);
    }

    public function testReportingPartyCanBeClearedWithAnExplicitBlank(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $created = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_date' => '2026-09-14',
            'location' => 'Mercado Street',
            'narrative' => 'n',
            'reporter_name' => 'Wrong Name',
        ], $cookie, $csrf);
        $id = (int) $created['body']['report']['id'];

        $this->assertSame(200, $this->patchReport($cookie, $csrf, $id, ['reporter_name' => ''])['status']);
        $row = $this->db()->query("SELECT reporter_name FROM bluewrite_test.reports WHERE id = {$id}")->fetch();
        $this->assertNull($row['reporter_name'], 'a blank input clears the field instead of storing an empty string');
    }
}
