<?php
declare(strict_types=1);

namespace App\Core;

final class Csrf
{
    public static function token(): string
    {
        self::start();
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    public static function start(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            \App\Core\Session::start();
        }
    }

    /** Validate the X-CSRF-Token header against the session token. */
    public static function validateHeader(): bool
    {
        $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        return is_string($header)
            && $header !== ''
            && hash_equals(self::token(), $header);
    }
}
