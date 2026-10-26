<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Device tokens for the blotter-capture phone app (migration 024).
 *
 * The contract: a token is minted ONLY off a fully signed-in cookie session
 * (password plus the second factor — BaseApiTestCase::login completes it),
 * authenticates later calls as `Authorization: Bearer`, carries exactly the
 * account's own permissions, and dies by revoke. Tokens can never mint
 * tokens, and the server keeps hashes only.
 */
final class DevicesTest extends BaseApiTestCase
{
    /** Mint a token for the officer, returning [token, cookie, csrf]. */
    private function issueToken(string $user = 't.officer'): array
    {
        [$cookie, $csrf] = $this->login($user);
        $res = $this->request('POST', '/devices/issue', ['device_name' => 'Test Phone'], $cookie, $csrf);
        $this->assertSame(201, $res['status'], 'issue failed: ' . json_encode($res['body']));
        $this->assertArrayHasKey('token', $res['body']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', (string) $res['body']['token']);
        return [(string) $res['body']['token'], $cookie, $csrf];
    }

    private function bearer(string $token): string
    {
        return 'Authorization: Bearer ' . $token;
    }

    public function testIssueRequiresASession(): void
    {
        // No cookie at all: the gate's own answer, not the devices answer.
        $res = $this->request('POST', '/devices/issue', ['device_name' => 'Test Phone']);
        $this->assertSame(401, $res['status']);
    }

    public function testBearerCannotMintTokens(): void
    {
        [$token] = $this->issueToken();
        $res = $this->request('POST', '/devices/issue', ['device_name' => 'Second Phone'], '', null, [$this->bearer($token)]);
        $this->assertSame(403, $res['status']);
    }

    public function testTokenAuthenticatesAsItsAccount(): void
    {
        [$token] = $this->issueToken();
        $res = $this->request('GET', '/me', null, '', null, [$this->bearer($token)]);
        $this->assertSame(200, $res['status']);
        $this->assertSame('t.officer', $res['body']['username']);
    }

    public function testUnknownTokenIsRefusedAsItself(): void
    {
        $res = $this->request('GET', '/me', null, '', null, [$this->bearer(str_repeat('a', 64))]);
        $this->assertSame(401, $res['status']);
        $this->assertSame('device_token_invalid', $res['body']['code'] ?? null);
    }

    public function testBearerCreatesADraftWithoutCsrf(): void
    {
        // THE PHONE'S WHOLE PATH: no cookie, no CSRF token — the bearer is
        // the credential, and CSRF forges cookies, not headers.
        [$token] = $this->issueToken();
        $res = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-09-01T08:30',
            'location' => 'Phone-filed location',
            'narrative' => 'Filed from the device token.',
        ], '', null, [$this->bearer($token)]);
        $this->assertSame(201, $res['status'], 'bearer create failed: ' . json_encode($res['body']));
    }

    public function testBearerCannotReachAnothersDraft(): void
    {
        [$officerToken] = $this->issueToken('t.officer');
        [$cookie2, $csrf2] = $this->login('t.officer2');
        $report = $this->createReport($cookie2, $csrf2);
        // Officers may VIEW every report (station-wide register), but only
        // edit their own — so the cross-account refusal is asserted on a
        // PATCH, exactly as RbacTest does for sessions.
        $res = $this->request('PATCH', "/reports/{$report['id']}", ['location' => 'Elsewhere'], '', null, [$this->bearer($officerToken)]);
        $this->assertSame(403, $res['status']);
    }

    public function testInventoryListsAndRevokes(): void
    {
        [$token, $cookie, $csrf] = $this->issueToken();
        $list = $this->request('GET', '/devices', null, $cookie, null);
        $this->assertSame(200, $list['status']);
        $this->assertCount(1, $list['body']['devices']);
        $id = (int) $list['body']['devices'][0]['id'];

        // The token is never returned again — hashes only, after issue.
        $this->assertArrayNotHasKey('token', $list['body']['devices'][0]);

        $revoke = $this->request('POST', "/devices/{$id}/revoke", [], $cookie, $csrf);
        $this->assertSame(200, $revoke['status']);

        $dead = $this->request('GET', '/me', null, '', null, [$this->bearer($token)]);
        $this->assertSame(401, $dead['status']);
        $this->assertSame('device_token_invalid', $dead['body']['code'] ?? null);
    }

    public function testRevokeUnknownIs404(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('POST', '/devices/999999/revoke', [], $cookie, $csrf);
        $this->assertSame(404, $res['status']);
    }

    public function testPhoneSignsItselfOut(): void
    {
        [$token, $cookie] = $this->issueToken();
        $bye = $this->request('DELETE', '/devices/current', null, '', null, [$this->bearer($token)]);
        $this->assertSame(200, $bye['status']);

        // Twice is an honest 401, not a 500: the token is already gone.
        $again = $this->request('GET', '/me', null, '', null, [$this->bearer($token)]);
        $this->assertSame(401, $again['status']);

        // And the portal inventory shows it ended.
        $list = $this->request('GET', '/devices', null, $cookie, null);
        $this->assertSame('ended', $this->deviceState($list['body']['devices']));
    }

    public function testCurrentWithoutBearerIs401(): void
    {
        // A session IS signed in here (with its CSRF token), but there is no
        // device token on the request — nothing to sign out.
        [$cookie, $csrf] = $this->login('t.officer');
        $res = $this->request('DELETE', '/devices/current', null, $cookie, $csrf);
        $this->assertSame(401, $res['status']);
    }

    private function deviceState(array $devices): string
    {
        if (count($devices) !== 1) {
            return 'count:' . count($devices);
        }
        return $devices[0]['revoked_at'] !== null ? 'ended' : 'live';
    }
}
