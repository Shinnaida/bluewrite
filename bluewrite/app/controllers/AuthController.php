<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Response;
use PDO;
use PDOException;

final class AuthController
{
    private const LOCK_KEY = 'login';

    public function login(): void
    {
        $body = $this->jsonBody();
        $identifier = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');

        if ($identifier === '' || $password === '') {
            Response::json(422, ['error' => 'Enter your username (or badge number) and password.']);
        }

        $pdo = Database::pdo();

        // Accept either username or badge number.
        $stmt = $pdo->prepare(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.password_hash, u.status,
                    u.failed_attempts, u.locked_until, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.username = :ident_username OR u.badge_number = :ident_badge
             LIMIT 1'
        );
        $stmt->execute([':ident_username' => $identifier, ':ident_badge' => $identifier]);
        $user = $stmt->fetch();

        $maxAttempts = (int) Config::get('app.lockout_attempts', 5);
        $lockMinutes = (int) Config::get('app.lockout_minutes', 15);

        if ($user === false) {
            Audit::log(null, 'login.failed', 'user', null, "unknown identifier: {$identifier}");
            Response::json(401, ['error' => 'Incorrect username or password. Try again or contact your administrator.']);
        }

        if ($user['status'] !== 'active') {
            Audit::log((int) $user['id'], 'login.blocked_inactive', 'user', (string) $user['id']);
            Response::json(403, ['error' => 'This account is deactivated. Contact your administrator to have it reactivated.']);
        }

        $lockedUntil = $user['locked_until'] !== null ? strtotime((string) $user['locked_until']) : false;
        if ($lockedUntil !== false && $lockedUntil > time()) {
            $mins = (int) ceil(($lockedUntil - time()) / 60);
            Response::json(423, [
                'error' => "Account locked after {$maxAttempts} failed attempts. Try again in about {$mins} minute(s) or contact your administrator.",
            ]);
        }

        if (!password_verify($password, $user['password_hash'])) {
            $attempts = ((int) $user['failed_attempts']) + 1;
            if ($attempts >= $maxAttempts) {
                $upd = $pdo->prepare(
                    'UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL :mins MINUTE) WHERE id = :id'
                );
                $upd->execute([':mins' => $lockMinutes, ':id' => $user['id']]);
                Audit::log((int) $user['id'], 'login.locked', 'user', (string) $user['id'], "{$attempts} failed attempts");
                Response::json(423, [
                    'error' => "Account locked after {$maxAttempts} failed attempts. Try again in {$lockMinutes} minutes or contact your administrator.",
                ]);
            }
            $upd = $pdo->prepare('UPDATE users SET failed_attempts = :a WHERE id = :id');
            $upd->execute([':a' => $attempts, ':id' => $user['id']]);
            Audit::log((int) $user['id'], 'login.failed', 'user', (string) $user['id'], "attempt {$attempts} of {$maxAttempts}");
            Response::json(401, ['error' => 'Incorrect username or password. Try again or contact your administrator.']);
        }

        // Success: reset counters, stamp last login, start session.
        $upd = $pdo->prepare(
            'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = :id'
        );
        $upd->execute([':id' => $user['id']]);

        Auth::login($user);
        Audit::log((int) $user['id'], 'login.success', 'user', (string) $user['id']);

        Response::json(200, [
            'user' => [
                'id' => (int) $user['id'],
                'full_name' => $user['full_name'],
                'badge_number' => $user['badge_number'],
                'username' => $user['username'],
                'role' => $user['role'],
            ],
            'csrf_token' => \App\Core\Csrf::token(),
            // Item 5: idle-timeout deadline for the client countdown.
            'expires_at' => time() + (int) Config::get('app.session_idle_minutes', 30) * 60,
        ]);
    }

    public function logout(): void
    {
        Auth::requireCsrf();
        $uid = \App\Core\Session::userId();
        if ($uid !== null) {
            Audit::log($uid, 'logout', 'user', (string) $uid);
        }
        Auth::logout();
        Response::json(200, ['ok' => true]);
    }

    public function me(): void
    {
        $user = Auth::requireUser();
        Response::json(200, [
            'id' => (int) $user['id'],
            'full_name' => $user['full_name'],
            'badge_number' => $user['badge_number'],
            'username' => $user['username'],
            'role' => $user['role'],
            'csrf_token' => \App\Core\Csrf::token(),
            // Item 5: real idle-timeout deadline (server clock) so the client
            // countdown reflects actual remaining time across reloads.
            'expires_at' => time() + (int) Config::get('app.session_idle_minutes', 30) * 60,
        ]);
    }

    /** @return array<string, mixed> */
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
