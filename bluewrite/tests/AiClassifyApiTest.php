<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 7 — POST /ai/classify, the route and the guards in front of it.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: send a non-empty account.
 *
 * The station's own key is configured in app/config/ai.php, so a request that
 * carries an account reaches Google and is BILLED. A test suite must not spend
 * the station's budget, and it must not depend on a model's answer to pass. So
 * every request here stops at a guard that runs BEFORE the provider is
 * constructed — the session, the CSRF token, the account itself — and the
 * reading itself is covered offline in AiClassifyTest.php, where the provider
 * is a stub and nothing is called out.
 *
 * The guards are worth testing over HTTP even though they look trivial, because
 * that is where the cost decision actually lives: the 422 is what stops an
 * empty box from spending a request, and the CSRF guard is what stops an
 * unauthenticated caller from spending one at all.
 */
final class AiClassifyApiTest extends BaseApiTestCase
{
    /** An account long enough that only the guard under test can stop it. */
    private const ACCOUNT = 'Gikuha sa suspek ang bag sa tindahan sa Peña Street.';

    /**
     * A POST without the CSRF header is refused before the route is even
     * reached — with a session and without one alike.
     *
     * The refusal is 419 either way, and that is the front controller's order,
     * not this endpoint's: Auth::requireCsrf() runs on every state-changing
     * method before dispatch, so an unauthenticated caller meets the token
     * check first and identity is never consulted. What matters here is the
     * property both cases share — the account is never read and no request is
     * spent, which is what this test is really guarding.
     */
    public function testACallWithoutATokenIsRefusedBeforeAnythingElse(): void
    {
        [$cookie] = $this->login('t.officer');

        foreach ([null, $cookie] as $session) {
            $res = $this->request('POST', '/ai/classify', ['account' => self::ACCOUNT], $session);
            $this->assertSame(
                419,
                $res['status'],
                $session === null ? 'no session' : 'signed in, no token',
            );
        }
    }

    /**
     * An empty account is refused BEFORE the provider is constructed — this is
     * the guard that keeps an empty box from spending a request. Whitespace is
     * empty: a box the officer tabbed through is not an account.
     */
    public function testAnEmptyAccountIsRefusedBeforeAnyModelCall(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        foreach (['', '   ', "\n\t "] as $account) {
            $res = $this->request('POST', '/ai/classify', ['account' => $account], $cookie, $csrf);
            $this->assertSame(422, $res['status'], 'account: ' . json_encode($account));
            $this->assertStringContainsString('own words', (string) ($res['body']['error'] ?? ''));
        }
    }

    /** No account key at all is the same guard, not a 500. */
    public function testAMissingAccountKeyIsRefusedAsWell(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $res = $this->request('POST', '/ai/classify', [], $cookie, $csrf);

        $this->assertSame(422, $res['status']);
    }

    /**
     * The route exists at all, as a POST, and is not reachable as a GET — a
     * typo in the front controller would otherwise surface only as a 404 to the
     * officer, after the editor had already been rewritten to call it.
     */
    public function testTheRouteIsPostOnly(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $res = $this->request('GET', '/ai/classify', null, $cookie, $csrf);

        $this->assertSame(404, $res['status']);
    }

    // -----------------------------------------------------------------
    // Phase 7 — POST /ai/classify/details, the second half of the same read.
    //
    // Same rule as above, and the same reason: every request here stops at a
    // guard that runs before the provider is constructed, so the suite never
    // spends a model call. The reading itself is covered offline in
    // AiClassifyTest.php against a stub.
    //
    // The guard this route ADDS is the one that matters most in practice: the
    // reading is scoped to one incident type's field list, and the list is
    // assembled from ReportRules on the server, never from the request. A type
    // the app has no list for has to be refused HERE, because the alternative —
    // asking the model about fields that do not exist — would come back as an
    // answer about a form this station does not have.
    // -----------------------------------------------------------------

    /** No token, no read — the front controller's CSRF gate, before dispatch. */
    public function testTheDetailsCallWithoutATokenIsRefusedBeforeAnythingElse(): void
    {
        [$cookie] = $this->login('t.officer');

        foreach ([null, $cookie] as $session) {
            $res = $this->request(
                'POST',
                '/ai/classify/details',
                ['account' => self::ACCOUNT, 'type' => 'Theft'],
                $session,
            );
            $this->assertSame(
                419,
                $res['status'],
                $session === null ? 'no session' : 'signed in, no token',
            );
        }
    }

    /**
     * The account guard runs first: this is the same 422 the first read makes,
     * and it is checked before the type so an empty box can never be reported as
     * a type problem the officer cannot see.
     */
    public function testTheDetailsCallRefusesAnEmptyAccountBeforeItLooksAtTheType(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        foreach (['', '   '] as $account) {
            $res = $this->request(
                'POST',
                '/ai/classify/details',
                ['account' => $account, 'type' => 'Theft'],
                $cookie,
                $csrf,
            );
            $this->assertSame(422, $res['status'], 'account: ' . json_encode($account));
            $this->assertStringContainsString('own words', (string) ($res['body']['error'] ?? ''));
        }
    }

    /**
     * The type guard, which is this route's own. Three refusals, all 422:
     *
     *   * no type at all — the first read has not named one yet;
     *   * a type this station does not carry (not on ReportsController's
     *     allowlist);
     *   * 'Vehicular Accident' — a LEGACY Phase 1/2 spelling that the create
     *     still accepts but ReportRules has no field list for. It is exactly the
     *     case a client could reach by correcting an old report's type, and the
     *     reason the guard checks the field list instead of the allowlist alone.
     */
    public function testTheDetailsCallRefusesATypeItHasNoFieldListFor(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $bodies = [
            'missing' => ['account' => self::ACCOUNT],
            'empty' => ['account' => self::ACCOUNT, 'type' => '  '],
            'not on the allowlist' => ['account' => self::ACCOUNT, 'type' => 'Not A Real Type'],
            'legacy spelling with no field list' => ['account' => self::ACCOUNT, 'type' => 'Vehicular Accident'],
        ];

        foreach ($bodies as $case => $body) {
            $res = $this->request('POST', '/ai/classify/details', $body, $cookie, $csrf);
            $this->assertSame(422, $res['status'], $case);
            $this->assertStringContainsString(
                'incident type',
                (string) ($res['body']['error'] ?? ''),
                $case,
            );
        }
    }

    /** POST only, on the exact path — a GET must not reach the reader. */
    public function testTheDetailsRouteIsPostOnly(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $res = $this->request('GET', '/ai/classify/details', null, $cookie, $csrf);

        $this->assertSame(404, $res['status']);
    }
}
