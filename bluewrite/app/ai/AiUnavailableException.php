<?php
declare(strict_types=1);

namespace App\Ai;

use RuntimeException;

/**
 * Thrown when the AI service is unavailable past the retry budget (or asked
 * to retry later). The controller translates this into a 503 with a
 * `retry_in` hint; the client then shows the persistent manual-mode banner.
 */
final class AiUnavailableException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly ?int $retryIn = null,
    ) {
        parent::__construct($message);
    }
}
