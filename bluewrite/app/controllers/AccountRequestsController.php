<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AccountRequests;
use App\Core\Audit;
use App\Core\Auth;
use App\Core\Response;

/**
 * Self-service recovery REQUESTS (Phase 1, S-04).
 *
 * An officer who has forgotten their password, or whose sign-in email address is
 * wrong, cannot fix either alone — every password is set by an Admin, and the
 * address is an administrative fact. What they CAN do is ask, in a way the
 * station records:
 *
 *   POST /account-requests              the LOCKED-OUT case, from the sign-in screen
 *   POST /me/account-request            the working case, from Profile
 *   GET  /account-requests              Admin: the open flags (dashboard card)
 *   POST /account-requests/:id/handle   Admin: clear a flag after acting
 *
 * WHAT A REQUEST DOES NOT DO: change anything. It records who asked, what for,
 * why and when, and raises a flag. The Admin acts with the tools User Management
 * already has — Reset password, the account edit, Reset verification, Issue
 * recovery codes — and every one of those is already append-only audited. This
 * controller never touches a password or an address.
 *
 * THE LOCKED-OUT ROUTE IS NOT AN ORACLE. The sign-in screen has no session, so a
 * request carries a username or badge number. Whether or not that account
 * exists, the answer is the same, and only a FOUND account's request is stored —
 * an attacker cannot use the form to enumerate usernames. An unmatched attempt is
 * still audited, exactly as an unknown login is (AuthController::login).
 */
final class AccountRequestsController
{
    /** The status every public submit answers with, found or not. */
    private const RECEIVED = 'Your request has been recorded. An administrator can see it and will act on it. '
        . 'If you cannot sign in, speak to an administrator as well — do not wait for this alone.';

    /**
     * POST /account-requests — the locked-out officer's request.
     *
     * No session and no CSRF token exist yet (the officer cannot sign in), so
     * this is registered before the gate, like /login and /mfa. It changes
     * nothing an attacker could exploit: at most it records a flag an Admin
     * reads, and every submission is audited.
     */
    public function store(): void
    {
        $body = $this->jsonBody();
        $identifier = trim((string) ($body['username'] ?? ''));
        $kind = trim((string) ($body['kind'] ?? ''));
        $reason = (string) ($body['reason'] ?? '');

        if ($identifier === '' || !AccountRequests::isValidKind($kind)) {
            Response::json(422, [
                'error' => 'Enter your username or badge number and choose what you need.',
                'field' => $identifier === '' ? 'username' : 'kind',
            ]);
        }

        $account = AccountRequests::findAccount($identifier);
        if ($account !== null) {
            AccountRequests::create($account['id'], $kind, $reason);
            Audit::log(
                $account['id'],
                'account.request_submitted',
                'user',
                (string) $account['id'],
                'kind: ' . $kind . ', via: sign-in screen'
            );
        } else {
            // Not stored (there is no account to be about) and NOT reported
            // differently: the sentence above is the same either way. The attempt
            // still reaches the trail, with no actor, as an unknown login does.
            Audit::log(null, 'account.request_unmatched', 'user', null, "unknown identifier: {$identifier}");
        }

        // 202 Accepted: the request is recorded for a human to act on, not a
        // resource the caller can now fetch. Same answer found or not.
        Response::json(202, ['ok' => true, 'message' => self::RECEIVED]);
    }

    /**
     * POST /me/account-request — the working officer's request, from Profile.
     *
     * Identity is the SESSION, never the body: an officer asks about their own
     * account and only their own. Registered after the gate, so the CSRF token
     * is required like every other state-changing call.
     */
    public function storeMine(): void
    {
        $user = Auth::requireUser();
        $body = $this->jsonBody();
        $kind = trim((string) ($body['kind'] ?? ''));
        $reason = (string) ($body['reason'] ?? '');

        if (!AccountRequests::isValidKind($kind)) {
            Response::json(422, ['error' => 'Choose what you need: a password reset or an email change.', 'field' => 'kind']);
        }

        $id = AccountRequests::create((int) $user['id'], $kind, $reason);
        Audit::log(
            (int) $user['id'],
            'account.request_submitted',
            'user',
            (string) $user['id'],
            'kind: ' . $kind . ', via: profile, request #' . $id
        );

        Response::json(201, ['ok' => true, 'id' => $id, 'message' => self::RECEIVED]);
    }

    /**
     * GET /account-requests — the open flags, for the Admin dashboard.
     *
     * Admin-only, and read-only. It carries the reason and the timestamp the
     * request was made, so an Admin can tell what happened without asking, which
     * is the whole point of S-04's acceptance.
     */
    public function index(): void
    {
        Auth::requireRole('Admin');
        $requests = AccountRequests::open();
        Response::json(200, [
            'requests' => $requests,
            'count' => count($requests),
        ]);
    }

    /**
     * POST /account-requests/:id/handle — clear a flag after the Admin has acted.
     *
     * Closing a flag is NOT the same as acting on it, and the response says only
     * that the flag is cleared. Acting is the Admin's job in User Management,
     * where it is audited as its own event (user.password_reset, user.update,
     * mfa.reset_by_admin, mfa.recovery_regenerated).
     */
    public function handle(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $requestId = (int) $id;
        if ($requestId <= 0) {
            Response::json(404, ['error' => 'Request not found.']);
        }

        $row = AccountRequests::find($requestId);
        if ($row === null) {
            Response::json(404, ['error' => 'Request not found.']);
        }

        $closed = AccountRequests::handle($requestId, (int) $admin['id']);
        if ($closed) {
            Audit::log(
                (int) $admin['id'],
                'account.request_handled',
                'user',
                (string) $row['user_id'],
                'request #' . $requestId . ' (' . $row['kind'] . ') for username: ' . $row['username']
            );
        }

        Response::json(200, ['ok' => true, 'handled' => $closed]);
    }

    /** The request body as an array; a body-less call is an empty array. */
    private function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
}
