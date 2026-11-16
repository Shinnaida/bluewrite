<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * The measured server address (GET /server/address).
 *
 * Covers the desk-copy contract: any signed-in role reads it (the officer
 * showing a client in is often not an Admin), it answers primary + urls +
 * port with no database behind it, and a signed-out reader is refused. The
 * detection itself (ipconfig parsing, loopback/APIPA filtering) is a pure
 * function of the machine it runs on, so this asserts the shape — the JS
 * suite pins the detection rules against the source.
 */
final class ServerAddressTest extends BaseApiTestCase
{
    public function testAnySignedInRoleReadsIt(): void
    {
        [$officerCookie] = $this->login('t.officer');
        $res = $this->request('GET', '/server/address', null, $officerCookie);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $this->assertArrayHasKey('primary', $res['body']);
        $this->assertArrayHasKey('urls', $res['body']);
        $this->assertArrayHasKey('port', $res['body']);
        $this->assertIsArray($res['body']['urls']);
        $this->assertGreaterThan(0, $res['body']['port']);
    }

    public function testSignedOutIsRefused(): void
    {
        $res = $this->request('GET', '/server/address');
        $this->assertSame(401, $res['status'], json_encode($res['body']));
    }

    public function testUrlsAreClientTypable(): void
    {
        [$adminCookie] = $this->login('t.admin');
        $res = $this->request('GET', '/server/address', null, $adminCookie);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        foreach ((array) $res['body']['urls'] as $url) {
            $this->assertMatchesRegularExpression('#^https?://[^/]+:\d+$#', (string) $url, 'every URL is scheme://host:port with no path');
            $this->assertStringNotContainsString('127.', (string) $url, 'loopback is this machine only, never a client address');
            $this->assertStringNotContainsString('169.254.', (string) $url, 'link-local means DHCP failed, never a client address');
        }
    }
}
