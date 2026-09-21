<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * The notification feed (GET /notifications) and its read watermark
 * (POST /notifications/seen).
 *
 * The feed is DERIVED — it reads report_verifications and the report_history
 * notes the server whitelists — so these tests are mostly about the rules that
 * decide what an officer is and is not told:
 *
 *   - only reports THEY wrote (another officer's review of somebody else's
 *     report is not news to them);
 *   - only acts OTHER people performed (a bell that reports your own work back
 *     to you is noise);
 *   - an archived report's reviews drop out, but the ARCHIVE itself does not
 *     (the officer has to be told a report left the working set);
 *   - the autosave note is not an event.
 *
 * The unread count is asserted against the DATABASE's own value for the
 * watermark, not against "everything", because the whole point of a watermark
 * is that it survives the panel being closed and read again.
 */
final class NotificationsTest extends BaseApiTestCase
{
    // ---- reading the feed ----------------------------------------------------

    public function testFeedIsEmptyForAnAccountWithNoReports(): void
    {
        [$cookie] = $this->login('t.officer');
        $res = $this->feed($cookie);
        $this->assertSame(200, $res['status']);
        $this->assertSame([], $res['body']['items']);
        $this->assertSame(0, $res['body']['unread']);
        // Never read: no watermark, so nothing has been marked seen — and with
        // no events there is nothing to be unread either.
        $this->assertNull($res['body']['seen_at']);
    }

    public function testVerificationIsReportedToTheAuthorNotTheVerifier(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($oc, $ocs);
        $this->verify($ac, $acs, $id, 'verified');

        $feed = $this->feed($oc)['body'];
        $this->assertSame(1, $feed['unread']);
        $this->assertCount(1, $feed['items']);
        $item = $feed['items'][0];
        $this->assertSame('verification', $item['kind']);
        $this->assertSame('verified', $item['outcome']);
        $this->assertSame('Test Admin', $item['actor_name'], 'the feed names who acted');
        $this->assertSame('Admin', $item['actor_role']);
        $this->assertSame($id, $item['report_id']);
        // The register's own numbering, built by the server so the feed and the
        // list cannot number the same report differently.
        $this->assertSame('BW-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT), $item['report_number']);
        $this->assertTrue($item['is_latest_act']);
        $this->assertFalse($item['report_archived']);
        $this->assertSame('Theft', $item['incident_type'], 'the row carries enough context to read');
        // The age comes from the server's clock, so the browser never has to
        // parse a timestamp in its own timezone.
        $this->assertIsInt($item['age_seconds']);
        $this->assertGreaterThanOrEqual(0, $item['age_seconds']);
        // ...and so does the absolute date, which the row falls back to for an
        // event too old for "3d ago". It is formatted here so the panel never
        // prints the database's own `Y-m-d H:i:s`, and single-digit days are
        // not left space-padded by `%e`.
        $this->assertMatchesRegularExpression('/^[A-Z][a-z]{2} \\d{1,2}, \\d{4}$/', $item['happened_label']);
        // The day heading is decided by the DATABASE's calendar: an act from
        // 23:00 yesterday must not be filed under Today.
        $this->assertSame('today', $item['day_group'], 'an act recorded moments ago is Today');

        // The verifier is NOT told about their own act: their feed is about
        // reports they wrote, and they wrote none.
        $adminFeed = $this->feed($ac)['body'];
        $this->assertSame([], $adminFeed['items']);
        $this->assertSame(0, $adminFeed['unread']);
    }

    public function testFeedCoversTheAuthorsOwnReportsOnly(): void
    {
        // The staff account writes the report; the officer must never see it.
        [$sc, $scs] = $this->login('t.staff');
        [$oc] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($sc, $scs);
        $this->verify($ac, $acs, $id, 'verified');

        $this->assertSame([], $this->feed($oc)['body']['items'], 'not the officer\'s report');
        $this->assertCount(1, $this->feed($sc)['body']['items'], 'the author is told');
    }

    public function testAnOfficersOwnActsAreNotNotifications(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        $report = $this->createReport($oc, $ocs);
        $id = (int) $report['id'];
        // Finalizing your own report writes a history row by you. It is not an
        // event this feed reports.
        $this->assertSame(200, $this->patchReport($oc, $ocs, $id, ['status' => 'finalized'])['status']);
        $this->assertSame([], $this->feed($oc)['body']['items']);
    }

    public function testDisputeCarriesItsNoteAndSupersedesTheEarlierAct(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($oc, $ocs);
        $this->verify($ac, $acs, $id, 'verified');

        // Editing the narrative after a review makes it stale; a dispute then
        // supersedes the verification (the latest act decides the report's
        // status — see ReportVerification::status).
        $this->patchReport($oc, $ocs, $id, ['narrative' => 'Juan reported the incident, corrected.']);
        $this->verify($ac, $acs, $id, 'disputed', 'The date differs from the original.');

        $feed = $this->feed($oc)['body'];
        $this->assertSame(2, $feed['unread'], 'both acts are news, none of them is dropped');
        $items = $feed['items'];
        // Newest first.
        $this->assertSame('disputed', $items[0]['outcome']);
        $this->assertSame('The date differs from the original.', $items[0]['note']);
        $this->assertTrue($items[0]['is_latest_act']);
        $this->assertSame('verified', $items[1]['outcome']);
        $this->assertFalse($items[1]['is_latest_act'], 'a later act overtook it');
        $this->assertSame('', $items[1]['note'], 'a verification carries no note');
    }

    // ---- lifecycle events ----------------------------------------------------

    public function testFinalizeByAnotherOfficerIsReported(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $id = (int) $this->createReport($oc, $ocs)['id'];

        // An ordinary save by somebody else is NOT an event: this is the
        // autosave note, and a feed built on it would be a wall of noise.
        $this->assertSame(200, $this->patchReport($ac, $acs, $id, ['location' => 'Elsewhere'])['status']);
        $this->assertSame([], $this->feed($oc)['body']['items'], 'an edit is not a notification');

        $this->assertSame(200, $this->patchReport($ac, $acs, $id, ['status' => 'finalized'])['status']);
        $feed = $this->feed($oc)['body'];
        $this->assertCount(1, $feed['items']);
        $this->assertSame('lifecycle', $feed['items'][0]['kind']);
        $this->assertSame('Test Admin', $feed['items'][0]['actor_name']);
        $this->assertStringStartsWith('Report finalized.', $feed['items'][0]['note']);
        $this->assertNull($feed['items'][0]['outcome']);
    }

    public function testArchiveIsReportedAndDropsTheReportsReviews(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($oc, $ocs);
        $this->verify($ac, $acs, $id, 'verified');
        $this->assertCount(1, $this->feed($oc)['body']['items']);

        $this->assertSame(200, $this->request('DELETE', "/reports/{$id}", null, $ac, $acs)['status']);

        $feed = $this->feed($oc)['body'];
        // The review drops out — the report can no longer be opened by anyone
        // but an admin, so an item pointing at it would be a dead link — but
        // the ARCHIVE itself stays, because a report must not leave the working
        // set in silence.
        $this->assertCount(1, $feed['items']);
        $this->assertSame('lifecycle', $feed['items'][0]['kind']);
        $this->assertStringStartsWith('Report archived', $feed['items'][0]['note']);
        $this->assertTrue($feed['items'][0]['report_archived'], 'the client renders it as a statement, not a link');
    }

    public function testRestoreIsReported(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $id = (int) $this->createReport($oc, $ocs)['id'];
        $this->request('DELETE', "/reports/{$id}", null, $ac, $acs);
        $this->assertSame(200, $this->request('PATCH', "/reports/{$id}/restore", null, $ac, $acs)['status']);

        $notes = array_map(static fn ($i) => $i['note'], $this->feed($oc)['body']['items']);
        $this->assertContains('Report restored from archive.', $notes);
    }

    // ---- the watermark -------------------------------------------------------

    public function testSeenClearsTheBadgeWithoutDroppingTheItems(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($oc, $ocs);
        $this->verify($ac, $acs, $id, 'verified');

        // Backdate the act, so "is the NEXT one unread?" is asked across a
        // boundary rather than inside one second. Event times are DATETIME
        // (whole seconds), so two acts in the same second as each other would
        // make this assertion a coin toss — see the granularity note on the
        // migration. Ten seconds is well outside that window.
        $this->db()->exec(
            'UPDATE bluewrite_test.report_verifications SET verified_at = DATE_SUB(NOW(), INTERVAL 10 SECOND)'
        );

        $before = $this->feed($oc)['body'];
        $this->assertSame(1, $before['unread']);
        $newest = $before['items'][0]['happened_at'];
        $this->assertGreaterThanOrEqual(10, $before['items'][0]['age_seconds'], 'age is measured from the act, not from the fetch');

        // The client sends what it was SHOWN, not "now" — so an event that
        // arrives during the round trip is not marked read without being seen.
        $seen = $this->request('POST', '/notifications/seen', ['seen_through' => $newest], $oc, $ocs);
        $this->assertSame(200, $seen['status']);
        $this->assertTrue($seen['body']['ok']);
        $this->assertSame($newest, $seen['body']['seen_at']);

        $after = $this->feed($oc)['body'];
        $this->assertSame(0, $after['unread']);
        $this->assertCount(1, $after['items'], 'reading the bell does not delete the news');
        $this->assertSame($newest, $after['seen_at']);

        // A later event is unread again.
        $this->patchReport($oc, $ocs, $id, ['narrative' => 'Juan reported the incident, corrected.']);
        $this->verify($ac, $acs, $id, 'disputed', 'The date differs.');
        $this->assertSame(1, $this->feed($oc)['body']['unread']);
    }

    public function testWatermarkOnlyMovesForwardAndNeverIntoTheFuture(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($oc, $ocs);
        $this->verify($ac, $acs, $id, 'verified');
        $newest = $this->feed($oc)['body']['items'][0]['happened_at'];

        $this->request('POST', '/notifications/seen', ['seen_through' => $newest], $oc, $ocs);

        // An older value cannot un-read anything: the watermark is a floor that
        // only advances, so a stale tab cannot bring the badge back.
        $older = $this->request('POST', '/notifications/seen', ['seen_through' => '2000-01-01 00:00:00'], $oc, $ocs);
        $this->assertSame(200, $older['status']);
        $this->assertSame($newest, $older['body']['seen_at']);

        // A value in the future would mute the badge until the server clock
        // caught up, so it is clamped to the server's own now.
        $future = $this->request('POST', '/notifications/seen', ['seen_through' => '2035-01-01 00:00:00'], $oc, $ocs);
        $this->assertSame(200, $future['status']);
        $stored = (string) $this->db()->query("SELECT notifications_seen_at FROM bluewrite_test.users WHERE username='t.officer'")->fetchColumn();
        $this->assertNotSame('2035-01-01 00:00:00', $stored);
        $this->assertSame($stored, $future['body']['seen_at'], 'the response states what the server wrote');

        // The watermark is per ACCOUNT, in the database — not per browser.
        $this->assertSame(0, $this->feed($oc)['body']['unread']);
        [$oc2] = $this->login('t.officer');
        $this->assertSame(0, $this->feed($oc2)['body']['unread'], 'a second session reads the same watermark');
    }

    public function testUnexpressibleSeenThroughFallsBackToTheServerClock(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $id = $this->translatedReport($oc, $ocs);
        $this->verify($ac, $acs, $id, 'verified');
        $this->assertSame(1, $this->feed($oc)['body']['unread']);

        $res = $this->request('POST', '/notifications/seen', ['seen_through' => 'the day before yesterday'], $oc, $ocs);
        $this->assertSame(200, $res['status']);
        $this->assertNotNull($res['body']['seen_at'], 'a caller that cannot say where it read up to still marks the bell read');

        // And it really clears the badge. "Now" has to come from the clock that
        // STAMPED the event — a PHP clock (gmdate() is UTC) would land hours
        // away from the database's own NOW() on any station that is not UTC,
        // and the event would stay unread forever.
        $this->assertSame(0, $this->feed($oc)['body']['unread'], 'the fallback must cover the events already in the feed');
    }

    // ---- access ---------------------------------------------------------------

    public function testFeedRequiresASession(): void
    {
        $anon = $this->request('GET', '/notifications');
        $this->assertSame(401, $anon['status']);

        // CSRF is checked before the session on a state-changing request.
        $post = $this->request('POST', '/notifications/seen', ['seen_through' => '2026-01-01 00:00:00']);
        $this->assertContains($post['status'], [401, 419]);
    }

    // ---- helpers --------------------------------------------------------------

    /** @return array{status:int, body:array} */
    private function feed(string $cookie): array
    {
        return $this->request('GET', '/notifications', null, $cookie, null);
    }

    /** A translated report authored by the given account, with a kept source. */
    private function translatedReport(string $cookie, string $csrf): int
    {
        $report = $this->createReport($cookie, $csrf, [
            'narrative_language' => 'ceb',
            'narrative' => 'Nagsumbong si Juan.',
            'action_taken' => 'For follow-up investigation.',
            'ioc_name' => 'PMSg Test Officer',
        ]);
        $id = (int) $report['id'];
        $res = $this->patchReport($cookie, $csrf, $id, [
            'narrative' => 'Juan reported the incident.',
            'narrative_language' => 'en',
            'narrative_source_text' => 'Nagsumbong si Juan.',
            'narrative_source_language' => 'ceb',
        ]);
        $this->assertSame(200, $res['status'], 'translated fixture failed: ' . json_encode($res['body']));
        return $id;
    }

    /** Record a review using the hashes the read returns (the D6 race guard). */
    private function verify(string $cookie, string $csrf, int $id, string $outcome, string $note = ''): void
    {
        $read = $this->request('GET', "/reports/{$id}/verifications", null, $cookie, null);
        $this->assertSame(200, $read['status']);
        $body = [
            'outcome' => $outcome,
            'narrative_hash' => $read['body']['current']['narrative_hash'],
            'source_hash' => $read['body']['current']['source_hash'],
        ];
        if ($note !== '') {
            $body['note'] = $note;
        }
        $res = $this->request('POST', "/reports/{$id}/verify", $body, $cookie, $csrf);
        $this->assertSame(201, $res['status'], 'verify failed: ' . json_encode($res['body']));
    }

    private function setLanguages(string $username, string $codes): void
    {
        $stmt = $this->db()->prepare('UPDATE bluewrite_test.users SET languages_read = ? WHERE username = ?');
        $stmt->execute([$codes, $username]);
    }
}
