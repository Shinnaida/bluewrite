<?php
declare(strict_types=1);

namespace App\Core;

final class Config
{
    private static ?array $config = null;

    public static function get(string $key, mixed $default = null): mixed
    {
        if (self::$config === null) {
            $file = dirname(__DIR__, 2) . '/config/config.php';
            if (!is_file($file)) {
                http_response_code(500);
                header('Content-Type: application/json');
                echo json_encode(['error' => 'Configuration missing. Copy config/config.sample.php to config/config.php.']);
                exit;
            }
            self::$config = require $file;

            // Item 4 (test support): the PHPUnit suite sets BLUEWRITE_DB_NAME
            // so the API runs against a scratch DB, never the dev/station one.
            // Nothing else sets this variable.
            $testDb = getenv('BLUEWRITE_DB_NAME');
            if ($testDb !== false && $testDb !== '' && is_array(self::$config) && isset(self::$config['db']['name'])) {
                self::$config['db']['name'] = $testDb;
            }

            // The same idea for the mailer, and it exists because the two
            // settings genuinely conflict. A machine whose config/config.php
            // sends real mail (`mail.transport => 'smtp'`) has no READABLE copy
            // of a sign-in code anywhere: the server keeps only a bcrypt hash and
            // there is deliberately no endpoint that returns one. The PHPUnit
            // suite has no inbox either, so it reads the six digits out of the
            // mail log the 'log' transport writes
            // (BaseApiTestCase::lastEmailedCode) — which means that without this
            // override, a machine set up for real delivery could not run the
            // suite at all. Starting the test server with
            // BLUEWRITE_MAIL_TRANSPORT=log forces codes back into the log for that
            // process only, so 'smtp' can stay configured for real sign-ins.
            // Nothing else sets this variable. See tests/run-tests.php.
            $testMail = getenv('BLUEWRITE_MAIL_TRANSPORT');
            if ($testMail !== false && $testMail !== '' && is_array(self::$config) && isset(self::$config['mail']['transport'])) {
                self::$config['mail']['transport'] = $testMail;
            }
        }
        return self::$config[$key] ?? $default;
    }

    /**
     * A whole top-level section of the config file, e.g. 'mail'.
     *
     * WHY THIS EXISTS BESIDE get(). `get()` reads a TOP-LEVEL key — it is handed
     * strings like 'app.lockout_minutes', but config.php is a nested array, so
     * those calls land on the caller's default rather than on the file. That is
     * long-standing behaviour this method does not change; what it adds is a way
     * to read a nested section (the mailer's settings) honestly, without
     * quietly altering what every existing `get('app.…')` call returns.
     */
    public static function section(string $name, array $default = []): array
    {
        // Loads the file on first use, exactly as get() does.
        self::get($name);
        $section = self::$config[$name] ?? null;
        return is_array($section) ? $section : $default;
    }
}
