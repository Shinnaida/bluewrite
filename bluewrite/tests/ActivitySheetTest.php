<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * The account page's year sheet — `GET /users/:id/activity`.
 *
 * WHAT THIS ENDPOINT IS. One account's own year, per day: TIME AT A DESK (measured by the
 * workspace's own heartbeat in `presence_days`, and estimated from the trail's sign-ins for
 * the days before that tally existed) and how many things were recorded for them. See
 * UsersController::activity.
 *
 * THE SEEDED ROWS ARE WRITTEN BY HAND, and that is deliberate rather than convenient. Every
 * route in this API writes what happens NOW, and no number of logins produces a year of
 * tallies or a trail spread across weeks — so the FIXTURE is written directly, while the
 * endpoint under test is still hit over HTTP and its answer read as JSON.
 *
 * THE INPUTS ARE THE SEAM. A row in `presence_days` is what the heartbeat writes (see
 * testARealHeartbeatIsWhatTheSheetReads, which produces one the honest way); a row in
 * `audit_logs` is what the trail writes. Both are shaped exactly as the real writer shapes
 * them, which is what makes an assertion about minutes an assertion about the feature.
 */
final class ActivitySheetTest extends BaseApiTestCase
{
    /** One audit row at a chosen moment: the clock is the one thing an API cannot control. */
    private function writeLog(int $userId, string $action, string $at): void
    {
        $stmt = $this->db()->prepare(
            'INSERT INTO bluewrite_test.audit_logs (user_id, action, entity_type, created_at)
             VALUES (:uid, :action, :type, :at)'
        );
        $stmt->execute([':uid' => $userId, ':action' => $action, ':type' => 'user', ':at' => $at]);
    }

    /** One day of measured presence, in the shape `PresenceController::tally` writes. */
    private function writePresence(int $userId, string $day, int $seconds, int $beats, ?string $first = null, ?string $last = null): void
    {
        $stmt = $this->db()->prepare(
            'INSERT INTO bluewrite_test.presence_days (user_id, day, first_seen, last_seen, seconds, beats)
             VALUES (:uid, :day, :first, :last, :seconds, :beats)'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':day' => $day,
            ':first' => $first ?? $day . ' 08:00:00',
            ':last' => $last ?? $day . ' 17:00:00',
            ':seconds' => $seconds,
            ':beats' => $beats,
        ]);
    }

    /** The account, with its trail and its tally cleared so the arithmetic below is exact. */
    private function blank(int $userId): void
    {
        $this->db()->exec("DELETE FROM bluewrite_test.audit_logs WHERE user_id = {$userId}");
        $this->db()->exec("DELETE FROM bluewrite_test.presence_days WHERE user_id = {$userId}");
    }

    private function userId(string $username): int
    {
        return (int) $this->db()->query(
            'SELECT id FROM bluewrite_test.users WHERE username = ' . $this->db()->quote($username)
        )->fetchColumn();
    }

    /** One day of the answer, by date. */
    private function day(array $body, string $date): ?array
    {
        foreach ($body['days'] as $d) {
            if ($d['date'] === $date) {
                return $d;
            }
        }
        return null;
    }

    public function testRequiresAuthentication(): void
    {
        $officerId = $this->userId('t.officer');
        $res = $this->request('GET', "/users/{$officerId}/activity", null, '');
        $this->assertSame(401, $res['status']);
    }

    public function testOfficerAndStaffAreForbidden(): void
    {
        $officerId = $this->userId('t.officer');
        $staffId = $this->userId('t.staff');

        // Refused rather than quietly answered: this is another account's record, and the page
        // it feeds is an administrative view.
        [$officerCookie] = $this->login('t.officer');
        $res = $this->request('GET', "/users/{$staffId}/activity", null, $officerCookie);
        $this->assertSame(403, $res['status']);

        [$staffCookie] = $this->login('t.staff');
        $res = $this->request('GET', "/users/{$officerId}/activity", null, $staffCookie);
        $this->assertSame(403, $res['status']);
    }

    public function testUnknownAccountIs404(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $res = $this->request('GET', '/users/99999/activity', null, $adminCookie);
        $this->assertSame(404, $res['status']);
    }

    /**
     * The window: whole weeks, Sunday first, ending on the Saturday of the current week.
     *
     * The whole sheet depends on this. Seven days to a column only reads as a calendar if the
     * first day is a Sunday, and the last column always contains today — otherwise the year is
     * drawn a day out and looks perfectly fine doing it.
     */
    public function testTheWindowIsWholeWeeksStartingOnASunday(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $this->assertSame(200, $res['status']);

        $window = $res['body']['window'];
        $this->assertSame(53, $window['weeks']);
        $this->assertSame('Sunday', date('l', strtotime($window['from'])));
        $this->assertSame('Saturday', date('l', strtotime($window['to'])));

        // 53 weeks of seven days, exactly — the series the client chunks into columns.
        $this->assertCount(53 * 7, $res['body']['days']);
        $this->assertSame($window['from'], $res['body']['days'][0]['date']);
        $this->assertSame($window['to'], $res['body']['days'][53 * 7 - 1]['date']);

        // TODAY IS SENT, because the last column runs past it: the days after today are not
        // squares with nothing in them, they are days that have not happened, and only the
        // server's clock can tell the two apart.
        $this->assertSame(gmdate('Y-m-d'), $window['today']);
        $this->assertTrue($window['today'] >= $window['from'], 'the window must reach back past today');
        $this->assertTrue($window['today'] <= $window['to'], 'today must fall inside the window');
    }

    /** `weeks` is clamped, and a short window is still whole weeks. */
    public function testTheWindowIsClamped(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');

        $res = $this->request('GET', "/users/{$officerId}/activity?weeks=2", null, $adminCookie);
        $this->assertSame(4, $res['body']['window']['weeks'], 'two weeks is below the floor');
        $this->assertCount(28, $res['body']['days']);

        $res = $this->request('GET', "/users/{$officerId}/activity?weeks=999", null, $adminCookie);
        $this->assertSame(53, $res['body']['window']['weeks'], 'a century of weeks is above the ceiling');
    }

    /**
     * TIME IS MEASURED, and the numbers are the tally's own.
     *
     * The failure this exists to catch is a sheet that shades by how many times somebody signed
     * in: three sign-ins in a morning is not three times the attendance of one, and a station
     * asking "was he here on the 14th" is asking about time.
     */
    public function testATimeAtADeskIsMeasuredFromTheTally(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $this->blank($officerId);

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $window = $res['body']['window'];
        $day = gmdate('Y-m-d', strtotime($window['from'] . ' +8 days'));

        // Seven hours and thirty-five minutes at the desk, in one sitting, with the span the
        // wall clock would have shown.
        $this->writePresence($officerId, $day, 7 * 3600 + 35 * 60, 912, $day . ' 08:02:00', $day . ' 16:41:00');
        // AND TWO SIGN-INS, which must NOT become the measure: the day is worth one duration,
        // not two of anything.
        $this->writeLog($officerId, 'login.success', $day . ' 08:02:00');
        $this->writeLog($officerId, 'login.success', $day . ' 13:00:00');

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $row = $this->day($res['body'], $day);

        $this->assertNotNull($row);
        $this->assertSame(455, $row['minutes'], 'the tally is the measure, in minutes');
        $this->assertSame('presence', $row['basis']);
        $this->assertSame(2, $row['sign_ins'], 'the sign-ins ride along as context');
        $this->assertStringContainsString('08:02:00', (string) $row['first_seen']);
        $this->assertStringContainsString('16:41:00', (string) $row['last_seen']);

        $this->assertSame(455, $res['body']['summary']['attendance']['total_minutes']);
        $this->assertSame(1, $res['body']['summary']['attendance']['active_days']);
        $this->assertSame(455, $res['body']['summary']['attendance']['busiest_minutes']);
    }

    /** A day with a single beat is a day somebody was there, not a zero. */
    public function testADayWithOneBeatIsOneMinuteNotZero(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $this->blank($officerId);

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $window = $res['body']['window'];
        $day = gmdate('Y-m-d', strtotime($window['from'] . ' +8 days'));

        // One beat: the workspace was open once and nothing was measured between two beats. A
        // sum of intervals would call this zero seconds, and the square would read as a day the
        // officer was not there at all.
        $this->writePresence($officerId, $day, 0, 1);

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $row = $this->day($res['body'], $day);
        $this->assertSame(1, $row['minutes']);
        $this->assertSame('presence', $row['basis']);
        $this->assertSame(1, $res['body']['summary']['attendance']['active_days'], 'the day counts as worked');
    }

    /**
     * The estimate, for the days the tally cannot cover — and the boundary between the two.
     *
     * Both halves are asserted here because they are the same feature seen from two sides: the
     * `basis` on every day, and `presence_from` telling the client where the measurement starts.
     * A sheet that draws an inference exactly like a measurement is the one failure this
     * reading must not have.
     */
    public function testTheDaysBeforeTheTallyAreEstimatedFromSignIns(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $this->blank($officerId);

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $window = $res['body']['window'];
        $from = $window['from'];

        // The tally starts on the ninth day of the window, so the eight before it are inferred.
        $tallyFrom = gmdate('Y-m-d', strtotime($from . ' +8 days'));
        $this->writePresence($officerId, $tallyFrom, 4 * 3600, 480);

        // AN EXACT SESSION, on the third day: in at 09:00, out at noon. Measured by the trail
        // itself, so no idle rule is involved.
        $exact = gmdate('Y-m-d', strtotime($from . ' +2 days'));
        $this->writeLog($officerId, 'login.success', $exact . ' 09:00:00');
        $this->writeLog($officerId, 'report.create', $exact . ' 10:15:00');
        $this->writeLog($officerId, 'logout', $exact . ' 12:00:00');

        // AND AN UNSIGNED-OUT SESSION on the fourth day: in at 13:00, last act at 15:30, and no
        // sign-out at all. It ends where the session really did — the last request plus the idle
        // timeout the server enforces (30 minutes by default).
        $open = gmdate('Y-m-d', strtotime($from . ' +3 days'));
        $this->writeLog($officerId, 'login.success', $open . ' 13:00:00');
        $this->writeLog($officerId, 'report.update', $open . ' 15:30:00');

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $this->assertSame($tallyFrom, $res['body']['window']['presence_from']);

        // THE EXACT SESSION: three hours.
        $row = $this->day($res['body'], $exact);
        $this->assertSame(180, $row['minutes']);
        $this->assertSame('sessions', $row['basis'], 'an estimated day must say so');

        // THE UNSIGNED-OUT ONE: two and a half hours of evidence plus the idle window.
        $row = $this->day($res['body'], $open);
        $this->assertSame(180, $row['minutes'], '15:30 + 30 minutes of idle window, minus 13:00');
        $this->assertSame('sessions', $row['basis']);

        // THE MEASURED DAY IS NOT ESTIMATED, and carries the tally's own span.
        $row = $this->day($res['body'], $tallyFrom);
        $this->assertSame(240, $row['minutes']);
        $this->assertSame('presence', $row['basis']);

        // THE BOUNDARY COUNTS, so the page can say how much of the year is which.
        $summary = $res['body']['summary']['attendance'];
        $this->assertSame(8, $summary['estimated_days'], 'the eight days before the tally');
        $this->assertSame(53 * 7 - 8, $summary['measured_days'], 'and every day from the tally onwards');
        $this->assertSame(180 + 180 + 240, $summary['total_minutes']);
        $this->assertSame(3, $summary['active_days']);
        $this->assertSame(240, $summary['busiest_minutes']);
    }

    /** A session that is still open can never run into the next one. */
    public function testASessionCannotSwallowTheNextSignIn(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $this->blank($officerId);

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $day = gmdate('Y-m-d', strtotime($res['body']['window']['from'] . ' +5 days'));

        // Nothing is signed out at all: in at 08:00, last act at 18:00 (long past the idle
        // window), and a second sign-in at 18:30. The first session's tail would otherwise reach
        // into the second one and the same half hour would be counted twice.
        $this->writeLog($officerId, 'login.success', $day . ' 08:00:00');
        $this->writeLog($officerId, 'report.create', $day . ' 18:00:00');
        $this->writeLog($officerId, 'login.success', $day . ' 18:30:00');

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $row = $this->day($res['body'], $day);

        // 08:00 → 18:30 (bounded by the next sign-in) + 18:30 → 18:30 + the idle window = 11h.
        $this->assertSame(11 * 60, $row['minutes']);
    }

    /**
     * The tally is the heartbeat, kept — proven end to end rather than by writing a row.
     *
     * A real beat on a real session must leave a day behind, and that day must be what the sheet
     * reads. Anything else would mean the sheet is measuring something the workspace never
     * recorded.
     */
    public function testARealHeartbeatIsWhatTheSheetReads(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $officerId = $this->userId('t.officer');
        $today = gmdate('Y-m-d');

        $before = (int) $this->db()->query(
            "SELECT COUNT(*) FROM bluewrite_test.presence_days WHERE user_id = {$officerId} AND day = '{$today}'"
        )->fetchColumn();

        $res = $this->request('POST', '/presence/heartbeat', [], $officerCookie, $officerCsrf);
        $this->assertSame(200, $res['status'], 'the heartbeat must still answer');

        $row = $this->db()->query(
            "SELECT first_seen, last_seen, seconds, beats FROM bluewrite_test.presence_days
              WHERE user_id = {$officerId} AND day = '{$today}'"
        )->fetch(\PDO::FETCH_ASSOC);
        $this->assertNotFalse($row, 'a beat must leave a day behind');
        $this->assertSame($before + 1, (int) $row['beats'], 'this beat was counted');
        $this->assertSame(0, (int) $row['seconds'], 'a first beat has no interval to add');
        $this->assertSame($row['first_seen'], $row['last_seen'], 'and no span beyond itself');

        // A SECOND BEAT IS AN INTERVAL. Two beats inside the same second of wall-clock time add
        // nothing (there is no interval to add), so the previous beat is moved back thirty
        // seconds first — the client's own beat — which is the case the arithmetic exists for.
        $this->db()->exec(
            "UPDATE bluewrite_test.presence_days SET last_seen = last_seen - INTERVAL 30 SECOND
              WHERE user_id = {$officerId} AND day = '{$today}'"
        );
        $res = $this->request('POST', '/presence/heartbeat', [], $officerCookie, $officerCsrf);
        $this->assertSame(200, $res['status']);
        $row = $this->db()->query(
            "SELECT seconds, beats FROM bluewrite_test.presence_days WHERE user_id = {$officerId} AND day = '{$today}'"
        )->fetch(\PDO::FETCH_ASSOC);
        $this->assertSame($before + 2, (int) $row['beats']);
        $this->assertGreaterThanOrEqual(29, (int) $row['seconds'], 'two beats inside the window are one sitting');

        // AND A BREAK IS A BREAK: with the previous beat moved back past the window that decides
        // one sitting, only `last_seen` moves — nothing is added, which is what stops a laptop
        // left closed over lunch becoming time at a desk.
        $this->db()->exec(
            "UPDATE bluewrite_test.presence_days
                SET last_seen = last_seen - INTERVAL 5 MINUTE,
                    seconds = 0
              WHERE user_id = {$officerId} AND day = '{$today}'"
        );
        $res = $this->request('POST', '/presence/heartbeat', [], $officerCookie, $officerCsrf);
        $this->assertSame(200, $res['status']);
        $row = $this->db()->query(
            "SELECT seconds, beats FROM bluewrite_test.presence_days WHERE user_id = {$officerId} AND day = '{$today}'"
        )->fetch(\PDO::FETCH_ASSOC);
        $this->assertSame($before + 3, (int) $row['beats']);
        $this->assertSame(0, (int) $row['seconds'], 'a five-minute gap is not time at the desk');

        // AND THE SHEET READS IT: today is measured, and worth at least the minute it rounds to.
        [$adminCookie] = $this->login('t.admin');
        $sheet = $this->request('GET', "/users/{$officerId}/activity?weeks=4", null, $adminCookie);
        $this->assertSame(200, $sheet['status']);
        $row = $this->day($sheet['body'], $today);
        $this->assertSame('presence', $row['basis']);
        $this->assertGreaterThanOrEqual(1, $row['minutes']);
    }

    /**
     * A BREAK IS A BREAK: beats far apart are two sittings, not one long one.
     *
     * The threshold is the same window the chathead rail uses to decide somebody is still
     * online, which is why a closed laptop lid ends the sitting and a slow minute does not.
     */
    public function testAGapWiderThanTheOnlineWindowIsNotTimeAtTheDesk(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $this->blank($officerId);

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $day = gmdate('Y-m-d', strtotime($res['body']['window']['from'] . ' +10 days'));

        // Written the way the tally writes it: a morning sitting of 40 minutes, then a beat
        // after a four-hour gap. The gap is NOT added — `seconds` is the two sittings only —
        // while the span keeps the whole day, because that is what the wall clock showed.
        $this->writePresence($officerId, $day, 40 * 60, 80, $day . ' 08:00:00', $day . ' 12:40:00');

        $res = $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);
        $row = $this->day($res['body'], $day);
        $this->assertSame(40, $row['minutes'], 'the break is excluded from the time at the desk');
        $this->assertStringContainsString('08:00:00', (string) $row['first_seen']);
        $this->assertStringContainsString('12:40:00', (string) $row['last_seen'], 'the span still shows the whole day');
    }

    /** Every day is present, including the ones with nothing in them. */
    public function testEveryDayOfTheWindowIsDrawn(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $this->blank($officerId);

        $res = $this->request('GET', "/users/{$officerId}/activity?weeks=4", null, $adminCookie);
        $this->assertCount(28, $res['body']['days'], 'the client is not asked to fill holes');

        $empty = 0;
        foreach ($res['body']['days'] as $d) {
            $this->assertArrayHasKey('minutes', $d);
            $this->assertArrayHasKey('basis', $d);
            $this->assertArrayHasKey('events', $d);
            if ($d['minutes'] === 0 && $d['events'] === 0) {
                $empty++;
            }
        }
        $this->assertSame(28, $empty, 'no tally, no trail, no time');

        // With no tally anywhere the whole window is estimated — and the client is told so by
        // `presence_from` being null rather than by having to guess.
        $this->assertNull($res['body']['window']['presence_from']);
        $this->assertSame(28, $res['body']['summary']['attendance']['estimated_days']);
        $this->assertSame(0, $res['body']['summary']['attendance']['measured_days']);
    }

    /** Reading a page is not an act this trail records, and neither is this endpoint. */
    public function testTheReadIsNotAudited(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $officerId = $this->userId('t.officer');
        $before = (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.audit_logs')->fetchColumn();

        $this->request('GET', "/users/{$officerId}/activity", null, $adminCookie);

        $after = (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.audit_logs')->fetchColumn();
        $this->assertSame($before, $after, 'the activity read must not write to the trail');
    }
}
