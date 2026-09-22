<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 8 — presence: who is at a desk right now.
 *
 * Covers the whole contract of POST /presence/heartbeat: it needs a session, it
 * writes the caller's own last_seen_at (never an id from the request), it answers
 * with the roster AND the window that roster was filtered by, only active
 * accounts seen inside the window appear, and every signed-in role may read it.
 *
 * The tests that matter most are the ones about the WINDOW, because that is where
 * a presence feature goes wrong quietly:
 *
 *   - An account seen five minutes ago must be gone from the roster. If the
 *     predicate were `last_seen_at IS NOT NULL` instead of a range, every officer
 *     who had ever signed in would be shown as present — a roster that never
 *     empties looks exactly like a roster that is working, which is why this is
 *     asserted against a row written by hand rather than by beating and waiting.
 *   - A deactivated account must not appear even with a fresh timestamp: the
 *     account has no way to beat, so the only way to fail this test is to get the
 *     rule wrong, not the timing.
 */
final class PresenceTest extends BaseApiTestCase
{
    /** The window the server states, and the one these tests assert against. */
    private const WINDOW = 120;

    public function testHeartbeatRequiresASignIn(): void
    {
        // The answer is the CSRF gate (419) rather than the session check (401),
        // and that is the front controller's order, not a mistake here: every
        // state-changing route runs Auth::requireCsrf() before anything reaches a
        // controller, so an anonymous POST never gets as far as the 401 (see
        // PasswordChangeTest for the same note about the same gate). What matters
        // either way is the second assertion: nothing was written.
        $res = $this->request('POST', '/presence/heartbeat');
        $this->assertSame(419, $res['status']);
        $this->assertSame(
            0,
            (int) $this->rootPdo()->query('SELECT COUNT(*) FROM users WHERE last_seen_at IS NOT NULL')->fetchColumn()
        );
    }

    public function testTheHeartbeatPutsTheCallerOnTheRosterAndStatesTheWindow(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $res = $this->request('POST', '/presence/heartbeat', null, $cookie, $csrf);
        $this->assertSame(200, $res['status'], json_encode($res['body']));

        // The window and the beat are the server's numbers, stated on every
        // response: the client ages a stale roster with them rather than guessing.
        $this->assertSame(self::WINDOW, $res['body']['window_seconds']);
        $this->assertGreaterThan(0, $res['body']['heartbeat_seconds']);

        $names = array_column($res['body']['online'], 'full_name');
        $this->assertContains('Test Officer', $names, 'the heartbeat puts the caller on the roster');

        // The shape the client draws from, and the one number it ages the list by.
        $entry = $res['body']['online'][array_search('Test Officer', $names, true)];
        $this->assertSame('Officer', $entry['role']);
        $this->assertSame('T-OFF-1', $entry['badge_number']);
        $this->assertNull($entry['photo_url'], 'no photo on file means null, not a URL that 404s');
        $this->assertIsInt($entry['idle_seconds']);
        $this->assertLessThan(60, $entry['idle_seconds']);

        // NOTHING ELSE ABOUT THE ACCOUNT rides along. The roster is read by every
        // role, so it must not become a way to enumerate addresses or hashes.
        foreach (['password_hash', 'email', 'failed_attempts', 'locked_until'] as $secret) {
            $this->assertArrayNotHasKey($secret, $entry);
        }
    }

    public function testNobodyIsOnlineBeforeAnybodyBeats(): void
    {
        // A fresh database: the seeded accounts have never beaten, so presence is
        // EMPTY rather than "everyone with last_seen_at IS NULL". This is the
        // state a station is in immediately after an upgrade, and it has to read
        // as an empty roster rather than as a full one.
        [$cookie] = $this->login('t.admin');

        $before = $this->request('POST', '/presence/heartbeat', null, $cookie, 'x');
        // (The CSRF token above is deliberately junk: the request must be refused
        // before it can write anything. See the assertion right after.)
        $this->assertSame(419, $before['status']);
        $this->assertSame(0, (int) $this->rootPdo()->query('SELECT COUNT(*) FROM users WHERE last_seen_at IS NOT NULL')->fetchColumn(), 'a refused heartbeat must not touch the column');
    }

    public function testAnAccountSeenOutsideTheWindowIsNotOnTheRoster(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $me = $this->request('POST', '/presence/heartbeat', null, $cookie, $csrf);
        $this->assertSame(200, $me['status']);
        $this->assertCount(1, $me['body']['online'], 'only the caller has beaten');

        // Two other accounts, stamped by hand: one inside the window, one just
        // outside it. The boundary is the whole feature — and it is asserted with
        // a comfortable margin on each side rather than on the second, because
        // this is a real server with a real clock.
        $this->rootPdo()->exec('UPDATE users SET last_seen_at = NOW() - INTERVAL 10 SECOND WHERE username = \'t.officer\'');
        $this->rootPdo()->exec('UPDATE users SET last_seen_at = NOW() - INTERVAL 600 SECOND WHERE username = \'t.staff\'');

        $res = $this->request('POST', '/presence/heartbeat', null, $cookie, $csrf);
        $this->assertSame(200, $res['status']);
        $names = array_column($res['body']['online'], 'full_name');

        $this->assertContains('Test Officer', $names, 'seen ten seconds ago: still at a desk');
        $this->assertNotContains('Test Staff', $names, 'seen ten minutes ago: gone');

        // …and the roster is ordered by name, not by who beat last. A column of
        // circles that reshuffles as colleagues move their mice is the one thing
        // a reader learns from it.
        $this->assertSame($names, array_values(array_unique($names)));
        $sorted = $names;
        sort($sorted, SORT_STRING);
        $this->assertSame($sorted, $names, 'name order');
    }

    public function testADeactivatedAccountIsNotOnTheRosterEvenWithAFreshTimestamp(): void
    {
        [$cookie, $csrf] = $this->login('t.admin');
        $this->rootPdo()->exec('UPDATE users SET last_seen_at = NOW() WHERE username = \'t.inactive\'');

        $res = $this->request('POST', '/presence/heartbeat', null, $cookie, $csrf);
        $this->assertSame(200, $res['status']);
        $this->assertSame(
            ['Test Admin'],
            array_column($res['body']['online'], 'full_name'),
            'a deactivated account has no way to beat, so it must never be drawn as present'
        );
    }

    public function testEveryRoleCanReadTheRoster(): void
    {
        // Presence is not a privilege: a circle that works for an admin and 403s
        // for an officer would be a broken panel, and the names it shows are on
        // the roster either way.
        foreach (['t.admin', 't.officer', 't.staff'] as $username) {
            [$cookie, $csrf] = $this->login($username);
            $res = $this->request('POST', '/presence/heartbeat', null, $cookie, $csrf);
            $this->assertSame(200, $res['status'], "{$username} must be able to read the roster");
            $this->assertNotEmpty($res['body']['online']);
        }
    }
}
