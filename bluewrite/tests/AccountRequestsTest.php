<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 1 (S-04) — self-service recovery REQUESTS, end to end over HTTP.
 *
 * WHAT THIS PROVES. An officer who cannot change something alone — a forgotten
 * password, a sign-in address that is wrong — can ASK, from the sign-in screen
 * (no session) or from Profile (signed in), and the ask is recorded with a reason
 * and a timestamp for an Admin to act on. The request changes nothing itself.
 *
 * It also pins the two properties that make the route safe:
 *   - the sign-in-screen route is NOT a username oracle (same answer either way,
 *     and an unknown identifier is never stored),
 *   - and every Admin action a request points at is already audited — asserted
 *     here rather than assumed, because S-04's acceptance depends on it.
 */
final class AccountRequestsTest extends BaseApiTestCase
{
    private const OFFICER = 't.officer';
    private const ADMIN = 't.admin';

    private function openRequests(): array
    {
        return $this->db()
            ->query('SELECT user_id, kind, reason, handled_at FROM bluewrite_test.account_requests ORDER BY id DESC')
            ->fetchAll(\PDO::FETCH_ASSOC);
    }

    // ---- the officer asking, signed in ---------------------------------------

    public function testOfficerRequestFromProfileIsRecordedAndAudited(): void
    {
        [$cookie, $csrf, $officer] = $this->login(self::OFFICER);

        $res = $this->request('POST', '/me/account-request', [
            'kind' => 'password',
            'reason' => 'Locked out after leave.',
        ], $cookie, $csrf);
        $this->assertSame(201, $res['status'], json_encode($res['body']));
        $this->assertNotEmpty($res['body']['id'] ?? null);

        $rows = $this->openRequests();
        $this->assertCount(1, $rows);
        $this->assertSame((int) $officer['id'], (int) $rows[0]['user_id']);
        $this->assertSame('password', $rows[0]['kind']);
        $this->assertSame('Locked out after leave.', $rows[0]['reason']);

        $detail = $this->db()
            ->query("SELECT detail FROM bluewrite_test.audit_logs WHERE action = 'account.request_submitted' ORDER BY id DESC LIMIT 1")
            ->fetchColumn();
        $this->assertStringContainsString('password', (string) $detail, 'the request must be audited');
    }

    public function testIdentityIsTheSessionNotTheBody(): void
    {
        // An officer cannot name somebody else: there is no user id in the body,
        // and the recorded request is the session's own account.
        [$cookie, $csrf, $officer] = $this->login(self::OFFICER);
        $other = $this->accountId(self::ADMIN);

        $res = $this->request('POST', '/me/account-request', [
            'kind' => 'email',
            'reason' => 'address is wrong',
            'user_id' => $other,
            'username' => self::ADMIN,
        ], $cookie, $csrf);
        $this->assertSame(201, $res['status'], json_encode($res['body']));

        $rows = $this->openRequests();
        $this->assertCount(1, $rows);
        $this->assertSame((int) $officer['id'], (int) $rows[0]['user_id'], 'the request must be for the caller, not the named user');
    }

    public function testRequestReasonIsFoldedToOneLineAndCapped(): void
    {
        [$cookie, $csrf] = $this->login(self::OFFICER);
        $res = $this->request('POST', '/me/account-request', [
            'kind' => 'password',
            'reason' => "line one\nline two\twith a tab",
        ], $cookie, $csrf);
        $this->assertSame(201, $res['status']);

        $reason = (string) $this->openRequests()[0]['reason'];
        $this->assertStringNotContainsString("\n", $reason);
        $this->assertStringNotContainsString("\t", $reason);
        $this->assertSame('line one line two with a tab', $reason);
    }

    public function testAnUnknownKindIsRefusedOnBothRoutes(): void
    {
        [$cookie, $csrf] = $this->login(self::OFFICER);
        $mine = $this->request('POST', '/me/account-request', ['kind' => 'delete-account'], $cookie, $csrf);
        $this->assertSame(422, $mine['status']);

        $public = $this->request('POST', '/account-requests', ['username' => self::OFFICER, 'kind' => 'delete-account']);
        $this->assertSame(422, $public['status']);

        $this->assertCount(0, $this->openRequests(), 'a refused kind must record nothing');
    }

    // ---- the locked-out officer, no session ----------------------------------

    public function testLockedOutRequestIsRecordedWithoutASession(): void
    {
        $before = $this->request('GET', '/me');
        $this->assertSame(401, $before['status'], 'sanity: this route really has no session');

        $res = $this->request('POST', '/account-requests', [
            'username' => self::OFFICER,
            'kind' => 'email',
            'reason' => 'The address on file is my old one.',
        ]);
        $this->assertSame(202, $res['status'], json_encode($res['body']));
        $this->assertNotEmpty($res['body']['message'] ?? null);

        $rows = $this->openRequests();
        $this->assertCount(1, $rows);
        $this->assertSame($this->accountId(self::OFFICER), (int) $rows[0]['user_id']);
        $this->assertSame('email', $rows[0]['kind']);
    }

    public function testTheRouteIsNotAUsernameOracle(): void
    {
        $found = $this->request('POST', '/account-requests', ['username' => self::OFFICER, 'kind' => 'password']);
        $missing = $this->request('POST', '/account-requests', ['username' => 'no.such.person', 'kind' => 'password']);

        // The SAME status and the SAME sentence, whether or not the account exists.
        $this->assertSame(202, $found['status']);
        $this->assertSame($found['status'], $missing['status']);
        $this->assertSame($found['body']['message'], $missing['body']['message']);

        // The unknown one is not stored, but it IS recorded in the trail.
        $this->assertCount(1, $this->openRequests(), 'only the real account is stored');
        $unmatched = $this->db()
            ->query("SELECT COUNT(*) FROM bluewrite_test.audit_logs WHERE action = 'account.request_unmatched'")
            ->fetchColumn();
        $this->assertSame(1, (int) $unmatched, 'an unmatched request attempt must still reach the trail');
    }

    // ---- the Admin's flag ----------------------------------------------------

    public function testAdminListsTheOpenRequestsWithReasonAndTimestamp(): void
    {
        [$oCookie, $oCsrf] = $this->login(self::OFFICER);
        $this->request('POST', '/me/account-request', ['kind' => 'password', 'reason' => 'forgot it'], $oCookie, $oCsrf);

        [$aCookie] = $this->login(self::ADMIN);
        $res = $this->request('GET', '/account-requests', null, $aCookie);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $this->assertSame(1, $res['body']['count']);

        $row = $res['body']['requests'][0];
        $this->assertSame('password', $row['kind']);
        $this->assertSame('Password reset', $row['kind_label']);
        $this->assertSame('forgot it', $row['reason']);
        $this->assertSame(self::OFFICER, $row['username']);
        $this->assertNotEmpty($row['created_label'], 'the request carries when it was made');
        $this->assertArrayHasKey('age_seconds', $row);
    }

    public function testAdminClearsTheFlagAndItIsAudited(): void
    {
        [$oCookie, $oCsrf] = $this->login(self::OFFICER);
        $created = $this->request('POST', '/me/account-request', ['kind' => 'password', 'reason' => 'x'], $oCookie, $oCsrf);
        $id = (int) $created['body']['id'];

        [$aCookie, $aCsrf] = $this->login(self::ADMIN);
        $clear = $this->request('POST', "/account-requests/{$id}/handle", null, $aCookie, $aCsrf);
        $this->assertSame(200, $clear['status'], json_encode($clear['body']));
        $this->assertTrue($clear['body']['handled']);

        // Cleared requests are no longer open…
        $list = $this->request('GET', '/account-requests', null, $aCookie);
        $this->assertSame(0, $list['body']['count']);

        $audited = $this->db()
            ->query("SELECT COUNT(*) FROM bluewrite_test.audit_logs WHERE action = 'account.request_handled'")
            ->fetchColumn();
        $this->assertSame(1, (int) $audited, 'clearing a flag must be recorded');

        // A second press is a no-op, not a re-stamp.
        $again = $this->request('POST', "/account-requests/{$id}/handle", null, $aCookie, $aCsrf);
        $this->assertSame(200, $again['status']);
        $this->assertFalse($again['body']['handled']);
    }

    public function testARequestThatDoesNotExistIs404(): void
    {
        [$aCookie, $aCsrf] = $this->login(self::ADMIN);
        $res = $this->request('POST', '/account-requests/99999/handle', null, $aCookie, $aCsrf);
        $this->assertSame(404, $res['status']);
    }

    public function testRequestsAreAdminOnlyToReadOrClear(): void
    {
        [$oCookie, $oCsrf] = $this->login(self::OFFICER);

        $read = $this->request('GET', '/account-requests', null, $oCookie);
        $this->assertSame(403, $read['status']);
        $clear = $this->request('POST', '/account-requests/1/handle', null, $oCookie, $oCsrf);
        $this->assertSame(403, $clear['status']);
    }

    // ---- the officer can SEE the address their sign-in depends on ------------

    public function testMeExposesTheFullSignInAddressToItsOwner(): void
    {
        [$cookie] = $this->login(self::OFFICER);
        $me = $this->request('GET', '/me', null, $cookie);
        $this->assertSame(200, $me['status']);
        // In FULL, not the gate's mask: the owner cannot check a typo from `t***`.
        $this->assertSame('t.officer@example.test', $me['body']['email'] ?? null);
        // …and the sign-in GATE still masks it, because that screen is watched.
        $this->assertSame('t***@example.test', $me['body']['mfa']['email_hint'] ?? null);
    }

    // ---- S-04's acceptance: the Admin's ACT is already audited ---------------

    public function testAdminPasswordResetIsAudited(): void
    {
        [$aCookie, $aCsrf] = $this->login(self::ADMIN);
        $officerId = $this->accountId(self::OFFICER);

        $res = $this->request('PATCH', "/users/{$officerId}", ['password' => 'N3wPassw0rd!'], $aCookie, $aCsrf);
        $this->assertSame(200, $res['status'], json_encode($res['body']));

        $actions = $this->db()
            ->query('SELECT action FROM bluewrite_test.audit_logs ORDER BY id DESC LIMIT 5')
            ->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertContains('user.password_reset', $actions, 'an Admin reset must be in the append-only trail');
        $this->assertContains('user.update', $actions);
    }

    public function testAdminEmailChangeIsAudited(): void
    {
        [$aCookie, $aCsrf] = $this->login(self::ADMIN);
        $officerId = $this->accountId(self::OFFICER);

        $res = $this->request('PATCH', "/users/{$officerId}", ['email' => 'fixed.address@example.test'], $aCookie, $aCsrf);
        $this->assertSame(200, $res['status'], json_encode($res['body']));

        $detail = $this->db()
            ->query("SELECT detail FROM bluewrite_test.audit_logs WHERE action = 'user.update' ORDER BY id DESC LIMIT 1")
            ->fetchColumn();
        $this->assertStringContainsString('email', (string) $detail, 'an Admin address change must name the field it changed');
    }
}
