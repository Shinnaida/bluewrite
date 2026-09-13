<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Item 4 — Auth tests: login success/failure, badge-number login,
 * lockout after 5 failed attempts, inactive account rejection.
 */
final class AuthTest extends BaseApiTestCase
{
    public function testLoginSuccessReturnsUserAndCsrf(): void
    {
        [$cookie, $csrf, $user] = $this->login('t.admin');
        $this->assertSame('Admin', $user['role']);
        $this->assertNotSame('', $csrf);
        $this->assertStringContainsString('BLUEWRITE_SESS', $cookie);
    }

    public function testLoginWithBadgeNumberWorks(): void
    {
        [$cookie, , $user] = $this->login('T-OFF-1'); // badge number, not username
        $this->assertSame('Test Officer', $user['full_name']);
    }

    public function testLoginWrongPasswordIs401WithGenericMessage(): void
    {
        $res = $this->request('POST', '/login', ['username' => 't.admin', 'password' => 'wrong-password']);
        $this->assertSame(401, $res['status']);
        // Identical message for wrong password vs unknown user (anti-enumeration).
        $this->assertSame(
            'Incorrect username or password. Try again or contact your administrator.',
            $res['body']['error']
        );
    }

    public function testLoginUnknownUserMatchesWrongPasswordMessage(): void
    {
        $res = $this->request('POST', '/login', ['username' => 'no.such.user', 'password' => 'whatever']);
        $this->assertSame(401, $res['status']);
        $this->assertSame(
            'Incorrect username or password. Try again or contact your administrator.',
            $res['body']['error']
        );
    }

    public function testAccountLocksAfterFiveFailedAttempts(): void
    {
        $last = null;
        for ($i = 0; $i < 5; $i++) {
            $last = $this->request('POST', '/login', ['username' => 't.officer', 'password' => 'nope-wrong']);
        }
        $this->assertSame(423, $last['status'], '5th failed attempt must lock the account');

        // Even the CORRECT password is now rejected while locked.
        $res = $this->request('POST', '/login', ['username' => 't.officer', 'password' => 'Passw0rd!23']);
        $this->assertSame(423, $res['status']);
        $this->assertStringContainsString('locked', $res['body']['error']);
    }

    public function testInactiveAccountIsRejected(): void
    {
        $res = $this->request('POST', '/login', ['username' => 't.inactive', 'password' => 'Passw0rd!23']);
        $this->assertSame(403, $res['status']);
        $this->assertStringContainsString('deactivated', $res['body']['error']);
    }

    public function testMeRequiresSession(): void
    {
        $res = $this->request('GET', '/me');
        $this->assertSame(401, $res['status']);
    }

    public function testStateChangeWithoutCsrfIsRejected(): void
    {
        [$cookie] = $this->login('t.admin');
        $res = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-09-01T08:30',
            'location' => 'X',
            'narrative' => 'n',
        ], $cookie, null); // no CSRF token
        $this->assertSame(419, $res['status']);
    }
}
