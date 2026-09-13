<?php
/**
 * BlueWrite configuration — copy to config/config.php and fill in real values.
 * config/config.php is git-ignored and must never be committed.
 * This file lives SERVER-SIDE ONLY. Never reference secrets from frontend code.
 */

return [
    'db' => [
        'host' => '127.0.0.1',
        'port' => '3306',
        'name' => 'bluewrite',
        'user' => 'bluewrite',
        'pass' => 'CHANGE_ME',
    ],

    'app' => [
        // LAN deployment: the server's static IP, e.g. 'http://192.168.1.10'
        // Dev with Laragon vhost: 'http://bluewrite.test'
        'base_url' => 'http://192.168.1.10',
        // Session idle timeout in minutes (server-side enforcement).
        'session_idle_minutes' => 30,
        // Account lockout: N failed attempts locks the account for M minutes.
        'lockout_attempts' => 5,
        'lockout_minutes' => 15,
    ],
];
