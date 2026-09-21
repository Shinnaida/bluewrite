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
        Session::start();
        $id = Session::userId();
        if ($id === null) {
            // A session that is mid-second-factor lands here, which is exactly
            // right: it holds no user_id, so every endpoint behind this gate is
            // out of reach until a factor is proved. The one thing it needs is
            // GET /mfa/status, which is registered before this gate for that
            // reason.
            Response::json(401, ['error' => 'Your session has expired. Sign in again to continue.']);
        }
        $user = self::fetchUser($id);
        if ($user === null || $user['status'] !== 'active') {
            self::logout();
            Response::json(401, ['error' => 'Your session is no longer valid. Sign in again to continue.']);
        }

        // THE SECOND FACTOR IS ENFORCED ON EVERY REQUEST, not only at sign-in.
        //
        // What the factor now rests on is the account's EMAIL ADDRESS, so that
        // is what is checked here: an Admin or an Officer whose address is
        // missing cannot complete a sign-in, and a session that was already open
        // when the address was removed must not keep working under a requirement
        // it no longer meets. The session is destroyed rather than parked, and
        // the response carries a code the client turns into a sentence — the
        // officer is told an administrator has to record an address.
        if (EmailOtp::isRequired((string) $user['role']) && trim((string) ($user['email'] ?? '')) === '') {
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
            Response::json(403, ['error' => 'Your account does not have permission to perform this action.']);
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
            'SELECT u.id, u.role_id, u.full_name, u.badge_number, u.username, u.email, u.status, u.last_login_at,
                    u.created_at, u.languages_read, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public static function login(array $user): void
    {
        Session::start();
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['role'] = $user['role'];
        $_SESSION['last_activity'] = time();
    }

    public static function logout(): void
    {
        Session::destroy();
    }

    /** Require a valid CSRF token header for state-changing requests. */
    public static function requireCsrf(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) && !Csrf::validateHeader()) {
            Response::json(419, ['error' => 'Security token missing or expired. Reload the page and try again.']);
        }
    }
}
