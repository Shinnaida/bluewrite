<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Session bootstrap with secure cookie flags and server-side idle timeout.
 */
final class Session
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $minutes = (int) Config::get('app.session_idle_minutes', 30);

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Strict',
            // 'secure' => true would require HTTPS; on a LAN without TLS this
            // stays false. Document in SECURITY_NOTES.md.
            'secure' => false,
        ]);
        session_name('BLUEWRITE_SESS');
        session_start();

        // Server-side idle timeout.
        $now = time();
        if (isset($_SESSION['last_activity']) && ($now - $_SESSION['last_activity']) > $minutes * 60) {
            self::destroy();
            return;
        }
        $_SESSION['last_activity'] = $now;
    }

    public static function destroy(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    public static function userId(): ?int
    {
        return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
    }

    public static function role(): ?string
    {
        return $_SESSION['role'] ?? null;
    }
}
