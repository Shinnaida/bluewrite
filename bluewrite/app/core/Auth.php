<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Request guard helpers: require a signed-in user and/or a specific role.
 * Role checks are enforced server-side on every endpoint.
 */
final class Auth
{
    public static function requireUser(): array
    {
        // THE PHONE'S CREDENTIAL FIRST (migration 024): a presented bearer
        // resolves to its account before any session is consulted, and then
        // meets every check below that a session meets. A bearer that is
        // PRESENT but resolves to nothing — revoked, expired, or never
        // issued, indistinguishable by design (see DeviceTokens) — is
        // answered as ITSELF rather than as a missing session, so the phone
        // knows to run setup again instead of showing a sign-in page.
        $tokenUserId = DeviceTokens::authenticateRequest();
        if ($tokenUserId !== null) {
            $user = self::fetchUser($tokenUserId);
            if ($user === null || $user['status'] !== 'active') {
                Response::json(401, [
                    'error' => 'This device sign-in is no longer valid. Set up the app again.',
                    'code' => 'device_token_invalid',
                ]);
            }
        } else {
            if (DeviceTokens::bearerToken() !== null) {
                Response::json(401, [
                    'error' => 'This device sign-in is no longer valid. Set up the app again.',
                    'code' => 'device_token_invalid',
                ]);
            }
            Session::start();
            $id = Session::userId();
            if ($id === null) {
            // A tab that is mid-second-factor lands here, which is exactly
            // right: its own context holds no account yet, so every endpoint
            // behind this gate is out of reach until a factor is proved. The one
            // thing it needs is GET /mfa/status, which is registered before this
            // gate for that reason. (So does a tab whose 30-minute idle clock
            // has run out, or one that never signed in at all — three states,
            // one honest answer, and the client's job is the same for each.)
            Response::json(401, ['error' => 'Your session has expired. Sign in again to continue.']);
        }
            $user = self::fetchUser($id);
            if ($user === null || $user['status'] !== 'active') {
                self::logout();
                Response::json(401, ['error' => 'Your session is no longer valid. Sign in again to continue.']);
            }
        }

        // THE SECOND FACTOR IS ENFORCED ON EVERY REQUEST, not only at sign-in.
        //
        // What the factor rests on is now EITHER the account's email address OR
        // an enrolled set of offline recovery codes (migration 018) — so the
        // session is refused only when the account has NEITHER. An Admin or an
        // Officer with no address but unspent recovery codes can sign in (and
        // hold a session) entirely offline; an account with neither cannot
        // complete a sign-in, and a session that was already open when both were
        // removed must not keep working under a requirement it no longer meets.
        // The session is destroyed rather than parked, and the response carries a
        // code the client turns into a sentence — the officer is told an
        // administrator has to record an address or issue recovery codes.
        if (EmailOtp::isRequired((string) $user['role'])
            && trim((string) ($user['email'] ?? '')) === ''
            && !RecoveryCodes::hasAny((int) $user['id'])) {
            self::logout();
            Response::json(401, [
                'error' => 'This account has no email address on file, so it cannot receive a sign-in code. Ask an administrator to add one.',
                'code' => 'mfa_email_required',
            ]);
        }

        return $user;
    }

    public static function requireRole(string ...$roles): array
    {
        $user = self::requireUser();
        if (!in_array($user['role'], $roles, true)) {
            // THE ROLE GATE, MARKED AS ONE. This is the refusal that means "the
            // request never reached the data at all" — the account's ROLE, not
            // its ownership of a row, is what the server rejected. The client
            // needs to tell that apart from the data refusals every screen has
            // its own reading for (a finalized report, somebody else's draft),
            // because a role refusal is also what a STALE ACCOUNT looks like:
            // an account whose role changed under a live workspace, which keeps
            // drawing menus the server now refuses. (Tabs hold their own
            // accounts since the per-tab change — see Session — so this is no
            // longer the two-tabs story it once was, but a role revoked in the
            // directory still reads exactly like this.) `code` is
            // what lets the workspace recognise that and reconcile itself (see
            // lib/api.js's session-mismatch listener). The message itself is
            // unchanged; the code is for the client, not the officer.
            Response::json(403, [
                'error' => 'Your account does not have permission to perform this action.',
                'code' => 'forbidden',
            ]);
        }
        return $user;
    }

    public static function fetchUser(int $id): ?array
    {
        $stmt = Database::pdo()->prepare(
            // `created_at` rides along for the profile panel's "member since"
            // line: it is the account's own age, which nothing else on this row
            // can stand in for. Read-only everywhere it is used.
            //
            // `email` is read here because this row is what the gate's second
            // factor check is made against (see requireUser): the factor is a
            // code sent to this address, so whether the address exists IS
            // whether the account can sign in. It is a plain column on the row
            // rather than a join, which keeps the gate at one round trip.
            // photo_path and photo_updated_at ride every request for the same
            // reason email does: /me answers with the session's own face, and the
            // cache key for it lives in the row. Two more columns on a row this
            // process was already reading.
            'SELECT u.id, u.role_id, u.full_name, u.badge_number, u.username, u.email, u.status, u.last_login_at,
                    u.created_at, u.languages_read, u.photo_path, u.photo_updated_at, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Sign in THIS TAB — see Session::signIn.
     *
     * The id is regenerated first, which is a defense against fixation and costs
     * the tabs beside this one nothing: `session_regenerate_id(true)` moves the
     * session's DATA to the new id rather than emptying it, so every other tab's
     * context travels with the cookie the browser hands them next.
     */
    public static function login(array $user): void
    {
        Session::start();
        session_regenerate_id(true);
        Session::signIn((int) $user['id'], (string) $user['role']);
    }

    /**
     * Sign this tab out, which ends the session only when it was the last one
     * holding anything — see Session::signOut.
     */
    public static function logout(): void
    {
        Session::signOut();
    }

    /** Require a valid CSRF token header for state-changing requests. */
    public static function requireCsrf(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return;
        }
        // THE PHONE SKIPS CSRF (migration 024): the bearer is a header
        // credential — a forged cross-site request cannot set one, so there
        // is no cookie to protect and nothing to forge. Presence is enough:
        // even a dead token skips, so signing out on one answers 401
        // downstream (set up again) instead of 419 here.
        if (DeviceTokens::bearerToken() !== null) {
            return;
        }
        if (!Csrf::validateHeader()) {
            Response::json(419, ['error' => 'Security token missing or expired. Reload the page and try again.']);
        }
    }
}
