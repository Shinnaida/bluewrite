<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 1 (S-01) — the OFFLINE second factor, end to end over HTTP.
 *
 * WHAT THIS PROVES that a unit test cannot: an Admin or Officer can finish a
 * sign-in with NO email involved, using only a recovery code. The mail transport
 * is 'log' in the test server, but the two cases below remove mail from the
 * picture entirely — one by removing the account's address, one by making the
 * address undeliverable — and then complete the sign-in anyway.
 *
 * It also pins the parts that make the codes safe: they are issued by an Admin,
 * shown once, stored only as hashes, single-use, counted when wrong, and locked
 * after five. See app/core/RecoveryCodes.php and docs/RECOVERY_CODES.md.
 */
final class RecoveryCodesTest extends BaseApiTestCase
{
    private const OFFICER = 't.officer';
    private const ADMIN = 't.admin';

    /** A code that is well-formed (so it is a real guess) but certainly not issued. */
    private const WRONG_BUT_WELL_FORMED = 'ZZZZZZZZZZ';

    /** Sign in as far as the pending second factor, returning cookie, csrf and the mfa block. */
    private function pendingSignIn(string $username, string $password = 'Passw0rd!23'): array
    {
        $res = $this->request('POST', '/login', ['username' => $username, 'password' => $password]);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $this->assertTrue($res['body']['mfa']['required'] ?? false, 'Admin/Officer must owe a second factor');

        return [
            $this->cookieOf($res, ''),
            (string) $res['body']['csrf_token'],
            is_array($res['body']['mfa'] ?? null) ? $res['body']['mfa'] : [],
        ];
    }

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

    /** The Admin issues a fresh set for the officer and returns the plaintext codes. */
    private function adminIssuesCodes(string $username = self::OFFICER): array
    {
        [$cookie, $csrf] = $this->login(self::ADMIN);
        $id = $this->accountId($username);
        $res = $this->request('POST', "/users/{$id}/recovery-codes", null, $cookie, $csrf);
        $this->assertSame(201, $res['status'], json_encode($res['body']));
        $this->assertCount(10, $res['body']['codes']);

        return $res['body']['codes'];
    }

    // ---- the offline sign-in -------------------------------------------------

    public function testOfficerSignsInWithRecoveryCodeAndNoEmailAtAll(): void
    {
        $codes = $this->adminIssuesCodes();

        // No internet needed for a code that goes to no inbox: remove the address.
        $this->db()->exec("UPDATE bluewrite_test.users SET email = NULL WHERE username = '" . self::OFFICER . "'");

        [$cookie, $csrf, $mfa] = $this->pendingSignIn(self::OFFICER);
        $this->assertFalse($mfa['has_email'], 'the payload must say there is no address');
        $this->assertTrue($mfa['recovery']['available'], 'the payload must offer the offline route');

        $verify = $this->request('POST', '/mfa/recovery', ['code' => $codes[0]], $cookie, $csrf);
        $this->assertSame(200, $verify['status'], json_encode($verify['body']));
        $this->assertSame(self::OFFICER, $verify['body']['user']['username'] ?? null);

        // The Auth::requireUser gate must accept a session whose account has no
        // email — an unspent recovery code is a second factor too.
        $me = $this->request('GET', '/me', null, $this->cookieOf($verify, $cookie));
        $this->assertSame(200, $me['status'], json_encode($me['body']));
    }

    public function testMailFailureStillOffersTheRecoveryRoute(): void
    {
        $codes = $this->adminIssuesCodes();

        // The address exists but is undeliverable, so Mailer::send() refuses it
        // exactly as it would refuse a real outage — the 503 the client already
        // knows as `mfa_mail_failed`.
        $this->db()->exec("UPDATE bluewrite_test.users SET email = 'not-an-address' WHERE username = '" . self::OFFICER . "'");

        $res = $this->request('POST', '/login', ['username' => self::OFFICER, 'password' => 'Passw0rd!23']);
        $this->assertSame(503, $res['status'], json_encode($res['body']));
        $this->assertSame('mfa_mail_failed', $res['body']['code'] ?? null);
        $this->assertTrue($res['body']['mfa']['recovery']['available'] ?? false, 'the mail failure must carry the fallback');
        $this->assertNotEmpty($res['body']['csrf_token'] ?? null, 'the pending sign-in must be usable');

        $verify = $this->request(
            'POST',
            '/mfa/recovery',
            ['code' => $codes[0]],
            $this->cookieOf($res, ''),
            (string) $res['body']['csrf_token']
        );
        $this->assertSame(200, $verify['status'], json_encode($verify['body']));
        $this->assertSame(self::OFFICER, $verify['body']['user']['username'] ?? null);
    }

    public function testRecoveryCodeIsSingleUse(): void
    {
        $codes = $this->adminIssuesCodes();

        // First use succeeds.
        [$c1, $s1] = $this->pendingSignIn(self::OFFICER);
        $first = $this->request('POST', '/mfa/recovery', ['code' => $codes[0]], $c1, $s1);
        $this->assertSame(200, $first['status'], json_encode($first['body']));

        // The same code cannot open a second sign-in.
        [$c2, $s2] = $this->pendingSignIn(self::OFFICER);
        $second = $this->request('POST', '/mfa/recovery', ['code' => $codes[0]], $c2, $s2);
        $this->assertSame(401, $second['status'], json_encode($second['body']));
        $this->assertSame('mfa_recovery_wrong', $second['body']['code'] ?? null);

        // …and a different code still works.
        [$c3, $s3] = $this->pendingSignIn(self::OFFICER);
        $third = $this->request('POST', '/mfa/recovery', ['code' => $codes[1]], $c3, $s3);
        $this->assertSame(200, $third['status'], json_encode($third['body']));
    }

    public function testMalformedCodeIsNotAnAttempt(): void
    {
        $codes = $this->adminIssuesCodes();
        [$cookie, $csrf] = $this->pendingSignIn(self::OFFICER);

        $res = $this->request('POST', '/mfa/recovery', ['code' => 'ABC'], $cookie, $csrf);
        $this->assertSame(422, $res['status'], json_encode($res['body']));

        // A malformed entry charged nothing, so a real code still works.
        $ok = $this->request('POST', '/mfa/recovery', ['code' => $codes[0]], $cookie, $csrf);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));
    }

    public function testFiveWrongCodesLockTheOfflineFactor(): void
    {
        // Keep the real codes: after the lock, one of them must still be refused
        // (a regeneration would clear the lock, so it cannot be used here).
        $codes = $this->adminIssuesCodes();

        $last = null;
        for ($i = 0; $i < 5; $i++) {
            [$cookie, $csrf] = $this->pendingSignIn(self::OFFICER);
            $last = $this->request('POST', '/mfa/recovery', ['code' => self::WRONG_BUT_WELL_FORMED], $cookie, $csrf);
        }
        $this->assertSame(423, $last['status'], json_encode($last['body']));
        $this->assertSame('mfa_recovery_locked', $last['body']['code'] ?? null);

        // A CORRECT code is refused while the offline factor is locked — the lock
        // is a property of the factor, not of the guessing.
        [$cookie, $csrf] = $this->pendingSignIn(self::OFFICER);
        $res = $this->request('POST', '/mfa/recovery', ['code' => $codes[0]], $cookie, $csrf);
        $this->assertSame(423, $res['status'], json_encode($res['body']));
        $this->assertSame('mfa_recovery_locked', $res['body']['code'] ?? null);
    }

    // ---- the rules around it -------------------------------------------------

    public function testCodesAreStoredOnlyAsHashes(): void
    {
        $codes = $this->adminIssuesCodes();
        $id = $this->accountId(self::OFFICER);

        $stmt = $this->db()->prepare('SELECT code_hash FROM bluewrite_test.mfa_recovery_codes WHERE user_id = :id');
        $stmt->execute([':id' => $id]);
        $hashes = $stmt->fetchAll(\PDO::FETCH_COLUMN);

        $this->assertCount(10, $hashes);
        foreach ($codes as $code) {
            $this->assertNotContains($code, $hashes, 'a plaintext code must never be stored');
        }
        // The hash really does verify one of the codes (bcrypt), so hashing is
        // not merely different — it is the check that will be run at sign-in.
        $normalised = str_replace('-', '', $codes[0]);
        $this->assertTrue(
            (bool) array_filter($hashes, static fn (string $h): bool => password_verify($normalised, $h)),
            'at least one stored hash must verify the issued code'
        );
    }

    public function testGeneratingReplacesThePreviousSet(): void
    {
        $first = $this->adminIssuesCodes();
        $second = $this->adminIssuesCodes();

        // The first set is dead: no code from it verifies against the stored hashes.
        $id = $this->accountId(self::OFFICER);
        $stmt = $this->db()->prepare('SELECT code_hash FROM bluewrite_test.mfa_recovery_codes WHERE user_id = :id');
        $stmt->execute([':id' => $id]);
        $hashes = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertCount(10, $hashes, 'a regeneration must replace, not add');

        foreach ($first as $code) {
            $normalised = str_replace('-', '', $code);
            foreach ($hashes as $hash) {
                $this->assertFalse(password_verify($normalised, $hash), 'an old code must not survive a regeneration');
            }
        }
        // …and the new set works.
        [$cookie, $csrf] = $this->pendingSignIn(self::OFFICER);
        $ok = $this->request('POST', '/mfa/recovery', ['code' => $second[0]], $cookie, $csrf);
        $this->assertSame(200, $ok['status'], json_encode($ok['body']));
    }

    public function testAdminRouteIsAdminOnly(): void
    {
        [$cookie, $csrf] = $this->login(self::OFFICER);
        $id = $this->accountId(self::ADMIN);
        $res = $this->request('POST', "/users/{$id}/recovery-codes", null, $cookie, $csrf);
        $this->assertSame(403, $res['status'], json_encode($res['body']));
    }

    public function testAccountWithNoEmailAndNoCodesIsStillRefused(): void
    {
        // No address, no offline route: there is no second factor to offer.
        $this->db()->exec("UPDATE bluewrite_test.users SET email = NULL WHERE username = '" . self::OFFICER . "'");
        $res = $this->request('POST', '/login', ['username' => self::OFFICER, 'password' => 'Passw0rd!23']);
        $this->assertSame(409, $res['status'], json_encode($res['body']));
        $this->assertSame('mfa_email_missing', $res['body']['code'] ?? null);
    }

    public function testRecoverySignInIsAuditedAndCodeIsNot(): void
    {
        $codes = $this->adminIssuesCodes();
        $this->db()->exec("UPDATE bluewrite_test.users SET email = NULL WHERE username = '" . self::OFFICER . "'");

        [$cookie, $csrf] = $this->pendingSignIn(self::OFFICER);
        $verify = $this->request('POST', '/mfa/recovery', ['code' => $codes[0]], $cookie, $csrf);
        $this->assertSame(200, $verify['status'], json_encode($verify['body']));

        $rows = $this->db()->query(
            "SELECT detail FROM bluewrite_test.audit_logs WHERE action = 'mfa.recovery_used'"
        )->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertNotEmpty($rows, 'the offline sign-in must be recorded');

        // No code value may appear anywhere in the trail.
        $all = $this->db()->query('SELECT detail FROM bluewrite_test.audit_logs')->fetchAll(\PDO::FETCH_COLUMN);
        foreach ($all as $detail) {
            foreach ([$codes[0], str_replace('-', '', $codes[0])] as $needle) {
                $this->assertStringNotContainsString((string) $needle, (string) $detail, 'a code must never reach the trail');
            }
        }
    }
}
