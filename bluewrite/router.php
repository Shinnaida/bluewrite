<?php
/**
 * Router for PHP's built-in development server (php -S).
 *
 * The built-in server ignores .htaccess, so Apache-style API routing needs
 * this script:  php -S 127.0.0.1:8099 -t public router.php
 *
 * - /api/*  → public/api.php (the JSON front controller)
 * - existing files under public/ → served normally (return false)
 * - anything else → the SPA shell (public/index.html)
 */

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// API calls go to the PHP front controller.
if (preg_match('#^/api(/|$)#', $path)) {
    require __DIR__ . '/public/api.php';
    return true;
}

// Real files (assets, index.html) are served by the built-in server itself.
// rawurldecode: parse_url leaves %20 (spaces in hashed asset names, e.g. the
// login photo band) encoded, and is_file needs the real name — without this,
// spaced assets fall through to the SPA shell and render as plain gradient.
// The realpath guard keeps decoded /..%2f sequences inside public/.
$decoded = rawurldecode($path);
$file = __DIR__ . '/public' . $decoded;
if ($decoded !== '/' && is_file($file)) {
    $real = realpath($file);
    $root = realpath(__DIR__ . '/public');
    if ($real !== false && $root !== false && strncmp($real, $root, strlen($root)) === 0) {
        return false;
    }
}

// SPA fallback.
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/public/index.html');
return true;
