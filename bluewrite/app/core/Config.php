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
        }
        return self::$config[$key] ?? $default;
    }
}
