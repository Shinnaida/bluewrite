<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * The second factor, end to end over HTTP: a six-digit code emailed to the
 * account's own address.
 *
 * WHAT THIS COVERS THAT A UNIT TEST CANNOT is the sign-in FLOW. Whether a code
 * is six digits is not the question — whether a correct password signs nothing
 * in, whether a pending sign-in can read a report, whether a code can be used
 * twice, and whether an admin reset actually clears what it claims to. Those are
 * statements about the server's state machine, and they are only true over the
 * wire.
 *
 * THE CODE ITSELF COMES FROM THE MAIL LOG (BaseApiTestCase::lastEmailedCode),
 * because the server keeps only a bcrypt hash of it and no endpoint can return
 * one. That is the officer's inbox standing in for a real one, and it is why the
 * TEST SERVER must be started with BLUEWRITE_MAIL_TRANSPORT=log — an override in
 * app/core/Config.php, beside BLUEWRITE_DB_NAME, so a machine whose
 * config/config.php sends real mail can still run this suite. See tests/README.md.
 */
final class EmailOtpTest extends BaseApiTestCase
{
    /** Sign in far enough to be holding a pending second factor. */
    private function pendingSignIn(string $username): array
    {
        $res = $this->request('POST', '/login', ['username' => $username, 'password' => 'Passw0rd!23']);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $this->assertTrue($res['body']['mfa']['required'] ?? false, 'Admin/Officer must owe a second factor');

        return [
            $this->cookieOf($res, ''),
            (string) $res['body']['csrf_token'],
            is_array($res['body']['mfa'] ?? null) ? $res['body']['mfa'] : [],
        ];
    }

    /** The session cookie a response re-issued, as a request header value. */
    private function cookieOf(array $res, string $fallback): string
    {
        if (empty($res['setCookies'])) {
            return $fallback;
        }
        $cookie = '';
        foreach ($res['setCookies'] as $c) {
            $pair = explode(';', $c)[0];
            $cookie = $cookie === '' ? $pair : $cookie . '; ' . $pair;
        }
        return $cookie;
    }

    /**
     * A six-digit code that is definitely NOT the one the server sent.
     *
     * Derived from the real code so the two can never collide, which a hardcoded
     * "000000" would do roughly once in a million runs.
     */
    private function wrongCode(): string
    {
        $real = $this->lastEmailedCode();
        $last = ((int) substr($real, -1) + 1) % 10;
        return substr($real, 0, 5) . (string) $last;
    }

    private function userId(string $username): int
    {
        return (int) $this->db()->query(
            'SELECT id FROM bluewrite_test.users WHERE username = ' . $this->db()->quote($username)
        )->fetchColumn();
    }

    // --- the password is not a session ---------------------------------------

    public function testAPasswordAloneDoesNotCreateASessionForAnAdmin(): void
    {
        [$cookie, , $mfa] = $this->pendingSignIn('t.admin');
        $this->assertSame('verify', $mfa['stage']);
        $this->assertSame('t***@example.test', $mfa['email_hint'], 'the screen is told where the code went');

        // THE POINT OF THE WHOLE DESIGN: a correct password, and no access.
        $this->assertSame(401, $this->request('GET', '/me', null, $cookie)['status']);
        $this->assertSame(401, $this->request('GET', '/reports', null, $cookie)['status']);
        $this->assertSame(401, $this->request('GET', '/users', null, $cookie)['status']);

        // ...and the pending state is visible to the gate itself, so a reloaded
        // page knows which step to show and gets its CSRF token back.
        $status = $this->request('GET', '/mfa/status', null, $cookie);
        $this->assertSame(200, $status['status']);
        $this->assertTrue($status['body']['mfa']['required']);
        $this->assertSame('verify', $status['body']['mfa']['stage']);
        $this->assertNotSame('', (string) $status['body']['csrf_token']);
    }

    public function testAStaffAccountSignsInWithAPasswordOnly(): void
    {
        [$cookie, , $user] = $this->login('t.staff');
        $this->assertSame('Staff', $user['role'], 'Staff are unchanged by this feature');

        $me = $this->request('GET', '/me', null, $cookie);
        $this->assertSame(200, $me['status']);
        $this->assertFalse($me['body']['mfa']['required']);
        $this->assertFalse($me['body']['mfa']['has_email'], 'a Staff account needs no address');
    }

    // --- the address is the factor -------------------------------------------

    public function testAnAccountWithoutAnAddressCannotSignInAndSaysWhy(): void
    {
        $this->db()->exec("UPDATE bluewrite_test.users SET email = NULL WHERE username = 't.officer'");

        $res = $this->request('POST', '/login', ['username' => 't.officer', 'password' => 'Passw0rd!23']);
        $this->assertSame(409, $res['status'], json_encode($res['body']));
        $this->assertSame('mfa_email_missing', $res['body']['code']);
        $this->assertStringContainsString('administrator', strtolower((string) $res['body']['error']));

        // ...and a session already open when the address is removed stops
        // working at the very next request (Auth::requireUser), rather than at
        // the officer's next sign-in.
        $this->db()->exec("UPDATE bluewrite_test.users SET email = 't.officer@example.test' WHERE username = 't.officer'");
        [$cookie] = $this->login('t.officer');
        $this->assertSame(200, $this->request('GET', '/me', null, $cookie)['status']);
        $this->db()->exec("UPDATE bluewrite_test.users SET email = NULL WHERE username = 't.officer'");

        $after = $this->request('GET', '/me', null, $cookie);
        $this->assertSame(401, $after['status']);
        $this->assertSame('mfa_email_required', $after['body']['code']);
    }

    // --- ordinary sign-in -----------------------------------------------------

    public function testTheEmailedCodeCompletesTheSignIn(): void
    {
        [$cookie, $csrf] = $this->pendingSignIn('t.officer');

        $ok = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrf);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));
        $this->assertSame('Test Officer', $ok['body']['user']['full_name']);

        $session = $this->cookieOf($ok, $cookie);
        $me = $this->request('GET', '/me', null, $session);
        $this->assertSame(200, $me['status']);
        $this->assertSame('t.officer', $me['body']['username']);
        $this->assertTrue($me['body']['mfa']['has_email']);
        $this->assertSame('t***@example.test', $me['body']['mfa']['email_hint']);
    }

    public function testACodeCannotBeUsedTwice(): void
    {
        [$cookie, $csrf] = $this->pendingSignIn('t.officer');
        $code = $this->lastEmailedCode();

        $first = $this->request('POST', '/mfa/verify', ['code' => $code], $cookie, $csrf);
        $this->assertSame(200, $first['status'], json_encode($first['body']));

        // ACCEPTING THE CODE DELETED IT. That is what single-use means here: the
        // six digits are not left sitting in a row waiting for a second use.
        $this->assertSame(
            0,
            (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.email_otp_codes')->fetchColumn()
        );

        // A fresh sign-in therefore issues a NEW code rather than re-arming the
        // one that was just spent.
        $this->pendingSignIn('t.officer');
        $this->assertNotSame($code, $this->lastEmailedCode());

        // ...and with nothing outstanding at all, a verify says "ask for another"
        // rather than blaming the officer's typing.
        [$cookie2, $csrf2] = $this->pendingSignIn('t.officer');
        $this->db()->exec('DELETE FROM bluewrite_test.email_otp_codes');
        $missing = $this->request('POST', '/mfa/verify', ['code' => $code], $cookie2, $csrf2);
        $this->assertSame(401, $missing['status']);
        $this->assertSame('mfa_code_missing', $missing['body']['code']);
    }

    // --- two signs-in in one browser --------------------------------------------

    /**
     * THE TRAP, REPRODUCED: two signs-in in one browser.
     *
     * One session cookie is shared by every tab of an origin, and `mfa_pending`
     * is one slot in it — so signing in a second time replaces the pending
     * sign-in for the WHOLE browser, while the first tab goes on drawing its own
     * screen: its own countdown, and above all its own "Sent to …" line and the
     * code that mailbox was emailed. The officer answers the first tab's code
     * screen with a real, unexpired, correctly typed code, and without the
     * sign-in id the server can only read that as a guess at the live sign-in's
     * code. Three times, in the case this test is written from: that is what the
     * station's own audit trail recorded on 2026-10-12 (a tab naming
     * k***@gmail.com, three `mfa.verify_failed` events charged to the account the
     * other sign-in belonged to), and it is why an id exists at all.
     */
    public function testACodeFromASupersededSignInIsRefusedWithoutSpendingATry(): void
    {
        // The first tab: an Admin, holding a code screen of its own.
        [, , $firstMfa] = $this->pendingSignIn('t.admin');
        $firstCode = $this->lastEmailedCode();

        // The second sign-in, anywhere in the same browser (a second tab here: it
        // is the cookie, not the tab, that the browser shares). Every request now
        // carries THIS session, whichever screen sent it.
        [$liveCookie, $liveCsrf, $liveMfa] = $this->pendingSignIn('t.officer');

        $this->assertNotSame('', (string) ($liveMfa['sign_in_id'] ?? ''), 'every payload names the sign-in it describes');
        $this->assertNotSame(
            $firstMfa['sign_in_id'] ?? null,
            $liveMfa['sign_in_id'] ?? null,
            'and two signs-in are told apart'
        );

        // The first tab's own code, submitted with the first tab's own id.
        $stale = $this->request(
            'POST',
            '/mfa/verify',
            ['code' => $firstCode, 'sign_in_id' => $firstMfa['sign_in_id']],
            $liveCookie,
            $liveCsrf
        );
        $this->assertSame(401, $stale['status'], json_encode($stale['body']));
        $this->assertSame('mfa_stale_sign_in', $stale['body']['code']);
        // It is NOT answered as a wrong code, and the answer names the mailbox the
        // live sign-in will accept a code from — which is what lets the screen
        // correct itself instead of inviting four more tries at the wrong inbox.
        $this->assertNotSame('mfa_wrong_code', $stale['body']['code']);
        $this->assertSame('t***@example.test', $stale['body']['mfa']['email_hint']);
        // AND NOTHING WAS CHARGED: all five tries are still there for the code
        // that is actually waiting.
        $this->assertSame(5, $stale['body']['mfa']['attempts']);

        // AND THE ID IS WHAT MADE THE DIFFERENCE. The same request without one is
        // the request the endpoint could not tell apart before an id existed — it
        // is read as a guess at the live sign-in's code (which it is not), and it
        // spends a try. That is the behaviour a client that cannot send an id
        // still gets, on purpose: this check is a way to tell two screens apart,
        // never a credential.
        $unnamed = $this->request(
            'POST',
            '/mfa/verify',
            ['code' => $firstCode],
            $liveCookie,
            $liveCsrf
        );
        $this->assertSame(401, $unnamed['status'], json_encode($unnamed['body']));
        $this->assertSame('mfa_wrong_code', $unnamed['body']['code']);
        $this->assertSame(4, $unnamed['body']['attempts_remaining']);

        // The live sign-in's own code completes it over the same cookie, which is
        // the proof that the refusal above cost nothing that matters.
        $ok = $this->request(
            'POST',
            '/mfa/verify',
            ['code' => $this->lastEmailedCode(), 'sign_in_id' => $liveMfa['sign_in_id']],
            $liveCookie,
            $liveCsrf
        );
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));
        $this->assertSame('t.officer', $ok['body']['user']['username']);

        // ...and the superseded submission is in the trail as itself, with no code
        // in it. (A client that sends NO id is unaffected — every other test in
        // this file submits exactly that way, which is the backwards compatibility
        // this endpoint keeps on purpose.)
        $detail = (string) $this->db()->query(
            "SELECT detail FROM bluewrite_test.audit_logs WHERE action = 'mfa.stale_sign_in' LIMIT 1"
        )->fetchColumn();
        $this->assertStringContainsString('superseded', $detail);
        $this->assertSame(0, preg_match('/\b\d{6}\b/', $detail), 'the six digits are never written down');
    }

    public function testAMalformedCodeIsAFieldProblemNotAFailedGuess(): void
    {
        [$cookie, $csrf] = $this->pendingSignIn('t.officer');

        $short = $this->request('POST', '/mfa/verify', ['code' => '12345'], $cookie, $csrf);
        $this->assertSame(422, $short['status']);
        $this->assertSame('code', $short['body']['field']);

        // The real code still works, so the keystroke above spent nothing.
        $ok = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrf);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));
    }

    public function testCancellingAPendingSignInEndsIt(): void
    {
        [$cookie, $csrf] = $this->pendingSignIn('t.admin');
        $this->assertSame(200, $this->request('POST', '/mfa/cancel', null, $cookie, $csrf)['status']);

        $status = $this->request('GET', '/mfa/status', null, $cookie);
        $this->assertSame(200, $status['status']);
        $this->assertFalse($status['body']['mfa']['required']);
    }

    // --- resend ---------------------------------------------------------------

    public function testResendIsThrottledAndANewCodeReplacesTheOldOne(): void
    {
        [$cookie, $csrf] = $this->pendingSignIn('t.officer');
        $firstCode = $this->lastEmailedCode();

        // Immediately: too soon, and the server says how long to wait.
        $tooSoon = $this->request('POST', '/mfa/send', null, $cookie, $csrf);
        $this->assertSame(429, $tooSoon['status']);
        $this->assertSame('mfa_resend_too_soon', $tooSoon['body']['code']);
        $this->assertArrayHasKey('retry_in', $tooSoon['body']);

        // Stand in for the wait rather than sleeping a minute: move the recorded
        // send into the past by more than the throttle window.
        $this->db()->exec(
            'UPDATE bluewrite_test.email_otp_codes SET sent_at = DATE_SUB(NOW(), INTERVAL 61 SECOND)'
        );

        $sent = $this->request('POST', '/mfa/send', null, $cookie, $csrf);
        $this->assertSame(200, $sent['status'], json_encode($sent['body']));

        // THE OLD CODE IS DEAD the moment a new one exists — two live codes would
        // be two chances to guess.
        $stale = $this->request('POST', '/mfa/verify', ['code' => $firstCode], $cookie, $csrf);
        $this->assertSame(401, $stale['status']);
        $this->assertSame('mfa_wrong_code', $stale['body']['code']);

        $fresh = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrf);
        $this->assertSame(200, $fresh['status'], json_encode($fresh['body']));
    }

    // --- the attempt counter ---------------------------------------------------

    public function testFiveWrongCodesLockTheFactorAndTheWaitIsAnnouncedAtSignIn(): void
    {
        [$cookie, $csrf] = $this->pendingSignIn('t.officer');

        $last = null;
        for ($i = 0; $i < 5; $i++) {
            $last = $this->request('POST', '/mfa/verify', ['code' => $this->wrongCode()], $cookie, $csrf);
        }
        $this->assertSame(423, $last['status'], 'the fifth wrong code must lock the factor');
        $this->assertSame('mfa_locked', $last['body']['code']);

        // THE LOCK IS ANNOUNCED AT SIGN-IN, before a code screen is shown: this
        // sign-in has the right password and is still refused, so nobody spends
        // the wait retyping codes they cannot get past.
        $login = $this->request('POST', '/login', ['username' => 't.officer', 'password' => 'Passw0rd!23']);
        $this->assertSame(423, $login['status']);
        $this->assertSame('mfa_locked', $login['body']['code']);
        $this->assertStringContainsString('15 minute', (string) $login['body']['error']);

        // A RESEND DOES NOT CLEAR IT — otherwise waiting out the throttle would
        // be a way past the lock, and the lock would only be worth its five
        // tries for as long as nobody was patient.
        $this->db()->exec('UPDATE bluewrite_test.email_otp_codes SET sent_at = DATE_SUB(NOW(), INTERVAL 61 SECOND)');
        $resend = $this->request('POST', '/mfa/send', null, $cookie, $csrf);
        $this->assertSame(423, $resend['status']);
        $this->assertSame('mfa_locked', $resend['body']['code']);
    }

    // --- administration --------------------------------------------------------

    public function testAnAdminCanResetAndAnOfficerCannot(): void
    {
        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $adminId = $this->userId('t.admin');
        $officerId = $this->userId('t.officer');

        $refused = $this->request('POST', "/users/{$adminId}/mfa-reset", null, $officerCookie, $officerCsrf);
        $this->assertSame(403, $refused['status'], "resetting somebody else's factor is an Admin action");

        // An outstanding code, so the reset has something real to clear.
        $this->request('POST', '/login', ['username' => 't.officer', 'password' => 'Passw0rd!23']);
        $this->assertSame(
            1,
            (int) $this->db()->query("SELECT COUNT(*) FROM bluewrite_test.email_otp_codes WHERE user_id = {$officerId}")->fetchColumn(),
            'a sign-in in progress leaves one outstanding code'
        );

        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $reset = $this->request('POST', "/users/{$officerId}/mfa-reset", null, $adminCookie, $adminCsrf);
        $this->assertSame(200, $reset['status'], json_encode($reset['body']));
        $this->assertTrue($reset['body']['removed']);
        $this->assertSame(
            0,
            (int) $this->db()->query("SELECT COUNT(*) FROM bluewrite_test.email_otp_codes WHERE user_id = {$officerId}")->fetchColumn()
        );

        // The address is untouched: this clears a code, it does not unenrol the
        // account.
        $this->assertSame(
            't.officer@example.test',
            (string) $this->db()->query("SELECT email FROM bluewrite_test.users WHERE id = {$officerId}")->fetchColumn()
        );

        $logged = (int) $this->db()->query(
            "SELECT COUNT(*) FROM bluewrite_test.audit_logs WHERE action = 'mfa.reset_by_admin'"
        )->fetchColumn();
        $this->assertSame(1, $logged);
    }

    // --- the trail -------------------------------------------------------------

    public function testTheTrailRecordsTheSequenceWithoutTheCode(): void
    {
        // A sign-in that STOPS at the code screen leaves one outstanding row, so
        // there is a stored value to look at before anything completes.
        $this->request('POST', '/login', ['username' => 't.officer', 'password' => 'Passw0rd!23']);
        $hash = (string) $this->db()->query(
            'SELECT code_hash FROM bluewrite_test.email_otp_codes LIMIT 1'
        )->fetchColumn();
        $this->assertStringStartsWith('$2y$', $hash, 'the outstanding code is stored as a bcrypt hash');
        $this->assertStringNotContainsString($this->lastEmailedCode(), $hash);

        // ...and then completing it records the sequence.
        $this->login('t.officer');

        $actions = array_column(
            $this->db()->query('SELECT action FROM bluewrite_test.audit_logs ORDER BY id')->fetchAll(\PDO::FETCH_ASSOC),
            'action'
        );
        $this->assertContains('login.password_ok', $actions, 'a password with nothing signed in is its own event');
        $this->assertContains('mfa.verified', $actions);
        $this->assertContains('login.success', $actions);

        // NO CODE, ANYWHERE — not the six digits, not the message body.
        $stored = (string) $this->db()->query(
            "SELECT GROUP_CONCAT(CONCAT(action, '|', IFNULL(detail, ''))) FROM bluewrite_test.audit_logs"
        )->fetchColumn();
        $this->assertSame(0, preg_match('/\b\d{6}\b/', $stored), 'no six-digit code was written to the trail');
        $this->assertStringNotContainsString('sign-in code is', $stored);
    }
}
