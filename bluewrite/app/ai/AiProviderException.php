<?php
declare(strict_types=1);

namespace App\Ai;

use RuntimeException;

/**
 * Raised when the AI provider is unreachable, times out, or returns an
 * unusable body. The service layer catches this to trigger retry/backoff and
 * ultimately the manual-narrative fallback (Phase 3 §7).
 */
final class AiProviderException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly bool $retryable = true,
        public readonly ?int $httpStatus = null,
    ) {
        parent::__construct($message);
    }
}
