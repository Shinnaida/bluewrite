<?php
/**
 * Item 4 — test runner helper.
 *
 * The suite talks to the REAL API over HTTP against a scratch DB
 * (bluewrite_test, wiped and reseeded per test — dev/station DBs untouched).
 *
 * On Windows the PHP built-in server must be started from a shell that can
 * keep it alive, so this script verifies the server and then runs phpunit:
 *
 *   # 1) one-time: let the app DB user reset the scratch DB
 *   mysql -u root -e "GRANT ALL PRIVILEGES ON bluewrite_test.* TO 'bluewrite'@'localhost'; FLUSH PRIVILEGES;"
 *
 *   # 2) start the test API server (scratch DB via env var)
 *   export BLUEWRITE_DB_NAME=bluewrite_test
 *   php -S 127.0.0.1:8098 -t public public/api.php &
 *
 *   # 3) run this script (or phpunit directly)
 *   php tests/run-tests.php
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("CLI only.\n");
}

$root = dirname(__DIR__);
$phar = $root . '/phpunit.phar';

if (!is_file($phar)) {
    exit("phpunit.phar not found at: {$phar}\nDownload it with:\n  curl -sL -o phpunit.phar https://phar.phpunit.de/phpunit-11.phar\n");
}

// Verify the dedicated test server is reachable.
$ch = curl_init('http://127.0.0.1:8098/api/v1/me');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_HEADER => true, CURLOPT_NOBODY => true]);
curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($code === 0) {
    exit(
        "Test API server is not running on http://127.0.0.1:8098.\n\n" .
        "Start it first (bash):\n" .
        "  export BLUEWRITE_DB_NAME=bluewrite_test\n" .
        "  php -S 127.0.0.1:8098 -t public public/api.php &\n\n" .
        "IMPORTANT: the server MUST be started with BLUEWRITE_DB_NAME=bluewrite_test\n" .
        "so the API runs against the scratch DB, never the dev/station one.\n"
    );
}

if (getenv('BLUEWRITE_DB_NAME') !== 'bluewrite_test') {
    // The server process carries the env var; this check protects against
    // pointing phpunit-side helpers at the wrong DB by accident.
    fwrite(STDERR, "Note: BLUEWRITE_DB_NAME is not set in THIS shell; the server must have been started with it.\n");
}

passthru(sprintf(
    '%s %s --bootstrap %s %s',
    escapeshellarg(PHP_BINARY),
    escapeshellarg($phar),
    escapeshellarg($root . '/tests/bootstrap.php'),
    escapeshellarg($root . '/tests')
));
