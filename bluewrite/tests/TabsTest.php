<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * TWO ACCOUNTS, TWO TABS, ONE BROWSER.
 *
 * The station asked for this in as many words — "allow me to log in different
 * accounts in different tabs" — after a sign-in that could not be finished. The
 * cause was that a PHP session is per BROWSER: one cookie, one `$_SESSION`, one
 * `mfa_pending` slot, so a second sign-in anywhere replaced the first sign-in's
 * pending state while the first tab went on drawing its own screen — and the
 * code emailed to the mailbox that screen named was refused, three times, as if
 * it were a guess (the audit trail of 2026-10-12 is where this test file comes
 * from; see AuthController::beginSecondFactor).
 *
 * The fix is a context PER TAB inside the one session (app/core/Session.php),
 * named by the `X-BlueWrite-Tab` header the app sends from `sessionStorage`. So
 * these tests are written the way a browser behaves: ONE COOKIE JAR, carried by
 * every request, with the tab header doing the distinguishing, and the newest
 * cookie always adopted (a sign-in regenerates the session id, and a browser
 * takes the cookie it is handed). A test that kept two cookies would prove
 * nothing — a browser has only one.
 *
 * WHAT IS DELIBERATELY UNCHANGED, and asserted here: the code still arrives by
 * email (nothing about the mailer, the ten-minute window, the resend throttle or
 * the attempt counter moved), and a client that names no tab at all — curl, and
 * most of this suite — still signs in exactly as it did before.
 */
final class TabsTest extends BaseApiTestCase
{
    private const TAB_A = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';
    private const TAB_B = 'b1c2d3e4f5061728b1c2d3e4f5061728';

    private function tab(string $id): array
    {
        return ['X-BlueWrite-Tab: ' . $id];
    }

    // The jar is `cookieFrom` (BaseApiTestCase): ONE cookie, and the newest one
    // the browser was handed. A sign-in regenerates the session id, so every
    // request that finishes one must adopt the Set-Cookie that came back — the
    // tabs beside it send the new cookie too, because a cookie is not scoped to a
    // tab. Ignoring it would be testing a browser nobody has.

    /** Sign in far enough to owe a second factor, from one tab. */
    private function beginInTab(string $username, string $tabId, string $cookie = ''): array
    {
        $res = $this->request('POST', '/login', ['username' => $username, 'password' => 'Passw0rd!23'], $cookie, null, $this->tab($tabId));
        $this->assertSame(200, $res['status'], "login as {$username} failed: " . json_encode($res['body']));
        $this->assertTrue($res['body']['mfa']['required'] ?? false, 'Admin/Officer owe a second factor');

        return [$this->cookieFrom($res, $cookie), (string) $res['body']['csrf_token'], $res['body']['mfa']];
    }

    /** The account a tab is holding, or null when it is holding none. */
    private function whoami(string $cookie, string $tabId): ?string
    {
        $res = $this->request('GET', '/me', null, $cookie, null, $this->tab($tabId));
        if ($res['status'] !== 200) {
            return null;
        }
        return (string) $res['body']['username'];
    }

    // --- the request ---------------------------------------------------------

    public function testTwoAccountsStaySignedInSideBySideInOneBrowser(): void
    {
        // Tab A: an Admin signs in and is owed a code.
        [$cookie, $csrfA, $mfaA] = $this->beginInTab('t.admin', self::TAB_A);
        $codeA = $this->lastEmailedCode();

        // Tab B: an Officer signs in, in the SAME browser. This is the request
        // that used to overwrite tab A's pending sign-in; the jar is now B's.
        [$cookie, $csrfB] = $this->beginInTab('t.officer', self::TAB_B, $cookie);
        $codeB = $this->lastEmailedCode();

        // EACH TAB IS ITS OWN SIGN-IN, not two views of the last one. The two
        // seeded addresses mask to the SAME hint ('t***@example.test'), so the id
        // is what proves it — and so is asking the second tab who it is waiting
        // for, which is its own account and not the one just signed in above.
        $statusB = $this->request('GET', '/mfa/status', null, $cookie, null, $this->tab(self::TAB_B));
        $this->assertNotSame($mfaA['sign_in_id'], $statusB['body']['mfa']['sign_in_id'], 'two tabs, two sign-ins');
        $this->assertTrue($statusB['body']['mfa']['required'], 'and the second tab is still owed its own code');

        // ---- TAB A finishes its OWN sign-in, with its OWN code ----------------
        $doneA = $this->request('POST', '/mfa/verify', ['code' => $codeA, 'sign_in_id' => $mfaA['sign_in_id']], $cookie, $csrfA, $this->tab(self::TAB_A));
        $this->assertSame(200, $doneA['status'], 'tab A\'s own code must complete tab A\'s sign-in: ' . json_encode($doneA['body']));
        $this->assertSame('t.admin', $doneA['body']['user']['username']);
        $cookie = $this->cookieFrom($doneA, $cookie);

        // ...and tab B is untouched: it is still mid-sign-in, holding its own.
        $this->assertNull($this->whoami($cookie, self::TAB_B), 'finishing in one tab must not sign another one in');
        $this->assertSame('t.admin', $this->whoami($cookie, self::TAB_A));

        // ---- TAB B finishes too ----------------------------------------------
        $doneB = $this->request('POST', '/mfa/verify', ['code' => $codeB], $cookie, $csrfB, $this->tab(self::TAB_B));
        $this->assertSame(200, $doneB['status'], json_encode($doneB['body']));
        $this->assertSame('t.officer', $doneB['body']['user']['username']);
        $cookie = $this->cookieFrom($doneB, $cookie);

        // ---- BOTH, at once, over the same cookie -----------------------------
        $a = $this->request('GET', '/me', null, $cookie, null, $this->tab(self::TAB_A));
        $b = $this->request('GET', '/me', null, $cookie, null, $this->tab(self::TAB_B));
        $this->assertSame('t.admin', $a['body']['username']);
        $this->assertSame('t.officer', $b['body']['username']);
        // Two accounts, not one account with two views of it: the roles differ.
        $this->assertSame('Admin', $a['body']['role']);
        $this->assertSame('Officer', $b['body']['role']);
    }

    public function testACodeFromOneTabCannotFinishTheOtherTabsSignIn(): void
    {
        [$cookie, , $mfaA] = $this->beginInTab('t.admin', self::TAB_A);
        $codeA = $this->lastEmailedCode();
        [$cookie, $csrfB] = $this->beginInTab('t.officer', self::TAB_B, $cookie);

        // Tab A's real, unexpired code, submitted AS tab B. This is the shape of
        // the original bug — and it is refused as a SUPERSEDED SIGN-IN rather than
        // as a wrong guess, because the screen it came from is not this tab's
        // sign-in. Nothing is charged for it.
        $wrongTab = $this->request('POST', '/mfa/verify', ['code' => $codeA, 'sign_in_id' => $mfaA['sign_in_id']], $cookie, $csrfB, $this->tab(self::TAB_B));
        $this->assertSame(401, $wrongTab['status'], json_encode($wrongTab['body']));
        $this->assertSame('mfa_stale_sign_in', $wrongTab['body']['code']);
        $this->assertSame('t***@example.test', $wrongTab['body']['mfa']['email_hint'], 'and it names the mailbox THIS tab is waiting on');
        $this->assertSame(5, $wrongTab['body']['mfa']['attempts'], 'a code from another tab costs nothing');

        // Tab B's own code still works...
        $doneB = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrfB, $this->tab(self::TAB_B));
        $this->assertSame(200, $doneB['status'], json_encode($doneB['body']));
        $cookie = $this->cookieFrom($doneB, $cookie);

        // ...tab A is unaffected: still mid-sign-in, not signed in, and its own
        // code still waiting for it.
        $this->assertNull($this->whoami($cookie, self::TAB_A));
        $doneA = $this->request('POST', '/mfa/verify', ['code' => $codeA], $cookie, $csrfB, $this->tab(self::TAB_A));
        $this->assertSame(200, $doneA['status'], json_encode($doneA['body']));
        $cookie = $this->cookieFrom($doneA, $cookie);
        $this->assertSame('t.admin', $this->whoami($cookie, self::TAB_A));
    }

    public function testSigningOutOfOneTabLeavesTheOtherSignedIn(): void
    {
        [$cookie, $csrfA, $mfaA] = $this->beginInTab('t.admin', self::TAB_A);
        $done = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrfA, $this->tab(self::TAB_A));
        $this->assertSame(200, $done['status'], json_encode($done['body']));
        $cookie = $this->cookieFrom($done, $cookie);

        [$cookie, $csrfB] = $this->beginInTab('t.officer', self::TAB_B, $cookie);
        $doneB = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrfB, $this->tab(self::TAB_B));
        $this->assertSame(200, $doneB['status']);
        $cookie = $this->cookieFrom($doneB, $cookie);

        $this->assertSame('t.admin', $this->whoami($cookie, self::TAB_A));
        $this->assertSame('t.officer', $this->whoami($cookie, self::TAB_B));

        // A SIGN-OUT IS A TAB'S, not the browser's.
        $out = $this->request('POST', '/logout', null, $cookie, $csrfA, $this->tab(self::TAB_A));
        $this->assertSame(200, $out['status'], json_encode($out['body']));

        $this->assertNull($this->whoami($cookie, self::TAB_A), 'the tab that asked is signed out');
        $this->assertSame('t.officer', $this->whoami($cookie, self::TAB_B), 'the tab beside it is not');

        // ...and the Officer's session is not merely still marked signed in: it
        // still works.
        $reports = $this->request('GET', '/reports', null, $cookie, null, $this->tab(self::TAB_B));
        $this->assertSame(200, $reports['status']);
        $this->assertSame($mfaA['sign_in_id'] !== '', true, 'tab A really had a pending sign-in of its own to lose');
    }

    public function testATabThatLeavesItsOwnScreenBehindIsStillToldWhy(): void
    {
        // ONE TAB, TWO SIGN-INS. Nothing about the per-tab change stops a screen
        // outliving its own sign-in inside a single tab — Start over, a
        // resubmitted form, a duplicated tab — so the id that tells two screens
        // apart still has to do its job here, and still without charging a try.
        [$cookie, , $first] = $this->beginInTab('t.admin', self::TAB_A);
        $firstCode = $this->lastEmailedCode();

        [$cookie, $csrf] = $this->beginInTab('t.officer', self::TAB_A, $cookie);

        $stale = $this->request('POST', '/mfa/verify', ['code' => $firstCode, 'sign_in_id' => $first['sign_in_id']], $cookie, $csrf, $this->tab(self::TAB_A));
        $this->assertSame(401, $stale['status'], json_encode($stale['body']));
        $this->assertSame('mfa_stale_sign_in', $stale['body']['code']);
        $this->assertSame(5, $stale['body']['mfa']['attempts'], 'and it cost nothing');

        $this->assertSame(200, $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrf, $this->tab(self::TAB_A))['status']);
    }

    // --- what did NOT change -------------------------------------------------

    public function testAClientThatNamesNoTabIsStillOneBrowserOneSignIn(): void
    {
        // curl, and most of this suite. No header means no tab: ONE context, and
        // the behaviour this API had before tabs existed.
        [$cookie, , $user] = $this->login('t.officer');
        $me = $this->request('GET', '/me', null, $cookie);
        $this->assertSame(200, $me['status']);
        $this->assertSame('t.officer', $me['body']['username']);

        // A second sign-in with no tab named replaces the first, exactly as it did
        // before: there is one context, and it holds one account.
        [$cookie2] = $this->login('t.admin');
        $this->assertSame('t.admin', $this->whoami($cookie2, ''));
    }

    public function testTwoTabsShareOneCookieAndThereforeOneCsrfToken(): void
    {
        // THE DESIGN, STATED AS A TEST. The tab id says WHICH SLOT a request
        // reads; it does not give a tab its own cookie, its own session or its
        // own security token. Two tabs of one browser are one session with two
        // accounts in it, which is what makes "sign out of one" different from
        // "sign both out" — and what keeps the CSRF check as strong as it was.
        [$cookie, $csrfA] = $this->login('t.admin', 'Passw0rd!23', $this->tab(self::TAB_A));
        [$cookie, $csrfB] = $this->login('t.officer', 'Passw0rd!23', $this->tab(self::TAB_B), $cookie);

        $this->assertSame($csrfA, $csrfB, 'one session, one token, whichever tab asks');

        // A token is not a tab either: either tab's token is accepted, because
        // both are the same session's.
        $this->assertSame(200, $this->request('GET', '/me', null, $cookie, null, $this->tab(self::TAB_A))['status']);
        $this->assertSame('t.officer', $this->whoami($cookie, self::TAB_B));

        // WHAT IS NOT TESTED HERE, and cannot be from the API: the idle sweep
        // itself (each context expires on its own last_seen — see Session::start,
        // which also covers the tabs that are not being asked about). The clock
        // lives in the PHP session file, not the database, so a test that reached
        // it would be testing PHP's session storage rather than this behaviour.
    }
}
