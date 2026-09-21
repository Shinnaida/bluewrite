<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * `POST /me/password` — an officer changing their OWN password.
 *
 * End-to-end, against the real API and a scratch database, because the parts
 * that can be wrong here are exactly the parts a unit test cannot see: whether
 * the route sits BEHIND the CSRF gate, whether the session really ends, and
 * whether the new credential is the one that opens the door afterwards.
 *
 * The two tests that matter most are `testTheSessionIsGoneAfterwards` and
 * `testTheNewPasswordIsTheOneThatWorks` — everything else is a refusal, and
 * refusals are the easy half.
 */
final class PasswordChangeTest extends BaseApiTestCase
{
    private const NEW_PASSWORD = 'harbour-quiet-72';

    // --- the gate: a session, and a CSRF token -------------------------------

    public function testChangePasswordRequiresSession(): void
    {
        // No cookie at all. This must not be reachable by someone who is not
        // signed in, however they got the URL.
        //
        // The answer is the CSRF gate (419), not the session check, because
        // every state-changing route sits behind that gate first
        // (Auth::requireCsrf) — and its message, "Security token missing or
        // expired. Reload the page and try again", is the one a client can act
        // on. Asserted as it IS rather than as 401 would look: this endpoint is
        // registered after the gate deliberately, so that it is as guarded as
        // everything else rather than as special as /logout.
        $res = $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ]);
        $this->assertSame(419, $res['status']);

        // A CSRF TOKEN IS NOT A SESSION. /mfa/status hands a token to a browser
        // that has signed nothing in — it exists so a reloaded second-factor
        // screen can recover its place — so this request gets past the gate and
        // is refused by the session check. That is the assertion that matters:
        // no amount of token-holding changes a password without an account.
        $anon = $this->request('GET', '/mfa/status');
        $this->assertSame(200, $anon['status']);
        $cookie = '';
        foreach ($anon['setCookies'] as $c) {
            $pair = explode(';', $c)[0];
            $cookie = $cookie === '' ? $pair : $cookie . '; ' . $pair;
        }
        $res2 = $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ], $cookie, (string) $anon['body']['csrf_token']);
        $this->assertSame(401, $res2['status'], 'a token without an account must not change a password');

        // ...and nothing was written on either attempt.
        $hash = $this->db()->query(
            "SELECT password_hash FROM bluewrite_test.users WHERE username = 't.officer'"
        )->fetchColumn();
        $this->assertTrue(password_verify('Passw0rd!23', (string) $hash), 'the old password still works');
    }

    public function testChangePasswordWithoutCsrfIsRejected(): void
    {
        // Signed in but no token: the endpoint changes a CREDENTIAL, so it must
        // sit behind the CSRF gate rather than beside the routes that do not.
        [$cookie] = $this->login('t.officer');
        $res = $this->request(
            'POST',
            '/me/password',
            ['current_password' => 'Passw0rd!23', 'new_password' => self::NEW_PASSWORD],
            $cookie
        );
        $this->assertSame(419, $res['status']);
    }

    // --- re-authentication ---------------------------------------------------

    public function testTheCurrentPasswordIsRequired(): void
    {
        // The whole reason this endpoint is not merely "authenticated": on a
        // shared workstation an open session is a normal state of the world, and
        // without this check whoever walks past it owns the account.
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/me/password', [
            'current_password' => 'not-my-password',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ], $cookie, $csrf);

        $this->assertSame(422, $res['status']);
        // Named so the form can put it under the right field.
        $this->assertSame('current_password', $res['body']['field'] ?? null);
    }

    public function testAWrongCurrentPasswordDoesNotLockTheAccount(): void
    {
        // The login lockout is for guessing the password of an account you are
        // NOT in. This caller is already in it, so the counter must not move —
        // otherwise a mistyped form locks an officer out of the application.
        [$cookie, $csrf] = $this->login('t.officer');
        $this->request('POST', '/me/password', [
            'current_password' => 'wrong-one',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ], $cookie, $csrf);

        $row = $this->db()->query(
            "SELECT failed_attempts, locked_until FROM bluewrite_test.users WHERE username = 't.officer'"
        )->fetch();
        $this->assertSame(0, (int) $row['failed_attempts']);
        $this->assertNull($row['locked_until']);

        // ...and the failed attempt is on the record instead.
        $logged = $this->db()->query(
            "SELECT COUNT(*) FROM bluewrite_test.audit_logs WHERE action = 'user.password_change_failed'"
        )->fetchColumn();
        $this->assertSame(1, (int) $logged);
    }

    // --- the policy, applied by the server -----------------------------------

    public function testTheConfirmationMustMatch(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD . 'x',
        ], $cookie, $csrf);
        $this->assertSame(422, $res['status']);
        $this->assertSame('confirm_password', $res['body']['field'] ?? null);
    }

    public function testThePolicyIsEnforcedByTheServerNotJustTheForm(): void
    {
        // The client mirrors the rule for a good error before the round trip; the
        // server must refuse it regardless of what the client believed. Ten
        // characters used to be enough and is not any more.
        [$cookie, $csrf] = $this->login('t.officer');

        foreach (['tenchars!!', 'password1234', 't.officer-2026'] as $weak) {
            $res = $this->request('POST', '/me/password', [
                'current_password' => 'Passw0rd!23',
                'new_password' => $weak,
                'confirm_password' => $weak,
            ], $cookie, $csrf);
            $this->assertSame(422, $res['status'], "\"{$weak}\" should have been refused");
            $this->assertSame('new_password', $res['body']['field'] ?? null, "\"{$weak}\"");
        }
    }

    public function testReusingTheCurrentPasswordIsRefused(): void
    {
        // Otherwise "change your password" can be satisfied without changing
        // anything.
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => 'Passw0rd!23',
            'confirm_password' => 'Passw0rd!23',
        ], $cookie, $csrf);
        $this->assertSame(422, $res['status']);
        $this->assertSame('new_password', $res['body']['field'] ?? null);
    }

    // --- the two that matter -------------------------------------------------

    public function testTheSessionIsGoneAfterwards(): void
    {
        // The chosen posture: the change ends the session that made it. Asserted
        // by REUSING the cookie, because a client that merely forgot its token
        // would look identical from the outside.
        [$cookie, $csrf] = $this->login('t.officer');
        $ok = $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ], $cookie, $csrf);
        $this->assertSame(200, $ok['status']);
        $this->assertTrue($ok['body']['signed_out'] ?? false);

        $after = $this->request('GET', '/me', null, $cookie);
        $this->assertSame(401, $after['status'], 'the old session is still usable');
    }

    public function testTheNewPasswordIsTheOneThatWorks(): void
    {
        // The only proof that the new credential is real: sign in with it. And
        // the old one must be dead, or the change was cosmetic.
        [$cookie, $csrf] = $this->login('t.officer');
        $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ], $cookie, $csrf);

        $fresh = $this->request('POST', '/login', [
            'username' => 't.officer',
            'password' => self::NEW_PASSWORD,
        ]);
        $this->assertSame(200, $fresh['status'], 'the new password does not work');

        $old = $this->request('POST', '/login', [
            'username' => 't.officer',
            'password' => 'Passw0rd!23',
        ]);
        $this->assertSame(401, $old['status'], 'the old password still works');
    }

    public function testTheChangeIsOnTheRecordWithTheAccountHolderAsTheActor(): void
    {
        // `user.password_change` rather than `user.password_reset`: the trail has
        // to be able to answer "who set this credential" without reading a detail
        // column, and these two events have different actors.
        [$cookie, $csrf] = $this->login('t.officer');
        $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
        ], $cookie, $csrf);

        $row = $this->db()->query(
            "SELECT a.user_id, u.username
               FROM bluewrite_test.audit_logs a
               JOIN bluewrite_test.users u ON u.id = a.user_id
              WHERE a.action = 'user.password_change'"
        )->fetch();
        $this->assertNotFalse($row, 'the change was not audited');
        $this->assertSame('t.officer', $row['username']);
    }

    public function testChangingOneAccountLeavesTheOthersAlone(): void
    {
        // The endpoint takes no target: it can only ever change the session's own
        // account. Asserted on another user's row so a future version that
        // accepted an id would fail here rather than in production.
        $before = $this->db()->query(
            "SELECT password_hash FROM bluewrite_test.users WHERE username = 't.admin'"
        )->fetchColumn();

        [$cookie, $csrf] = $this->login('t.officer');
        $this->request('POST', '/me/password', [
            'current_password' => 'Passw0rd!23',
            'new_password' => self::NEW_PASSWORD,
            'confirm_password' => self::NEW_PASSWORD,
            'user_id' => 1,
        ], $cookie, $csrf);

        $after = $this->db()->query(
            "SELECT password_hash FROM bluewrite_test.users WHERE username = 't.admin'"
        )->fetchColumn();
        $this->assertSame($before, $after, "another account's password changed");
    }
}
