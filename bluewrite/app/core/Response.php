<?php
declare(strict_types=1);

namespace App\Core;

final class Response
{
    public static function json(int $status, array $data): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }
}
