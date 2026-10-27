<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\DeviceTokens;
use App\Core\Response;
use App\Core\Session;

/**
 * Device tokens for the blotter-capture phone app (migration 024).
 *
 * TWO CREDENTIALS, TWO JOBS. The officer signs in on the phone ONCE with the
 * full portal sign-in — password plus the second factor, through the cookie
 * session the browser uses — and that session mints a device token
 * (POST /devices/issue). From then on the phone presents the token as
 * `Authorization: Bearer`, and the officer's daily unlock is a local app PIN
 * that only opens the phone's own secure storage: the PIN never reaches the
 * server, and the password is never stored on the phone.
 *
 * TOKENS CANNOT MINT TOKENS. issue, index and revoke-by-id demand the cookie
 * session (requireSession below refuses any bearer); only DELETE
 * /devices/current accepts the token itself, which is the phone's own
 * sign-out. A stolen phone can therefore sign itself out and nothing else.
 */
final class DevicesController
{
    /**
     * The cookie session's account — never a bearer.
     *
     * requireUser would accept either credential, which is exactly wrong for
     * the routes here: minting and inventory are the session's job. A bearer
     * on these routes is refused rather than honoured, so a token cannot mint
     * or enumerate its own kin.
     */
    private function requireSession(): array
    {
        // Registered BEFORE the gate in api/index.php, so the CSRF check the
        // gate would have run is enforced here instead — strictly, because
        // these routes mint and inventory credentials.
        Session::start();
        if (DeviceTokens::bearerToken() !== null) {
            Response::json(403, ['error' => 'Device tokens cannot manage device tokens. Sign in on this browser to continue.']);
        }
        // Signed in first, CSRF second: a caller with no session at all hears
        // 401 (sign in), while a session without its token hears the usual 419.
        $user = Auth::requireUser();
        Auth::requireCsrf();
        return $user;
    }

    /** POST /devices/issue — mint a token off the fully signed-in session. */
    public function issue(): void
    {
        $user = $this->requireSession();

        $body = $this->jsonBody();
        $name = trim((string) ($body['device_name'] ?? ''));
        if ($name === '') {
            $name = 'Android phone';
        }
        if (mb_strlen($name) > 120) {
            Response::json(422, ['error' => 'Give that phone a shorter name (120 characters at most).', 'field' => 'device_name']);
        }

        $issued = DeviceTokens::issue((int) $user['id'], $name);
        Audit::log((int) $user['id'], 'device.issue', 'user', (string) $user['id'], $name);

        // THE PLAINTEXT TOKEN IS IN THIS RESPONSE AND NOWHERE ELSE. The server
        // keeps the hash only — there is no route that returns it again, so a
        // phone that loses it runs setup again.
        Response::json(201, [
            'token' => $issued['token'],
            'expires_at' => $issued['expires_at'],
            'device_name' => $name,
        ]);
    }

    /** GET /devices — this account's phones, newest first. */
    public function index(): void
    {
        $user = $this->requireSession();
        Response::json(200, ['devices' => DeviceTokens::listFor((int) $user['id'])]);
    }

    /** POST /devices/:id/revoke — end one of this account's phones. */
    public function revoke(string $id): void
    {
        $user = $this->requireSession();
        if (!DeviceTokens::revoke((int) $user['id'], (int) $id)) {
            Response::json(404, ['error' => 'That device sign-in was not found, or is already ended.']);
        }
        Audit::log((int) $user['id'], 'device.revoke', 'user', (string) $user['id'], 'device token ' . (int) $id);
        Response::json(200, ['ok' => true]);
    }

    /**
     * DELETE /devices/current — the phone's own sign-out.
     *
     * The ONLY route a bearer may call here, and it revokes exactly the token
     * the request arrived on: the phone signs itself out without ever being
     * told an id it was never given.
     */
    public function revokeCurrent(): void
    {
        // Before the gate like the rest of this controller: a phone signing
        // out on a DEAD token must hear 401 (set up again), not the gate's
        // 419 for a missing CSRF header. The bearer-skipping check is a no-op
        // for the token and a real check for a session caller.
        Session::start();
        Auth::requireCsrf();
        $tokenId = DeviceTokens::currentTokenId();
        if ($tokenId === null) {
            Response::json(401, ['error' => 'This device sign-in is no longer valid. Set up the app again.']);
        }
        $user = Auth::requireUser();
        DeviceTokens::revoke((int) $user['id'], $tokenId);
        Audit::log((int) $user['id'], 'device.revoke', 'user', (string) $user['id'], 'device token ' . $tokenId . ' (own sign-out)');
        Response::json(200, ['ok' => true]);
    }

    /** @return array<string,mixed> */
    private function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
