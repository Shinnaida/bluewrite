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
            Response::json(401, ['error' => 'Your session has expired. Sign in again to continue.']);
        }
        $user = self::fetchUser($id);
        if ($user === null || $user['status'] !== 'active') {
            self::logout();
            Response::json(401, ['error' => 'Your session is no longer valid. Sign in again to continue.']);
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
            'SELECT u.id, u.role_id, u.full_name, u.badge_number, u.username, u.status, u.last_login_at, r.name AS role
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
