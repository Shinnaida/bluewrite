<?php
declare(strict_types=1);

namespace App\Ai;

use RuntimeException;

/**
 * Addendum §2 — thrown when the post-generation safety gate finds leftover
 * placeholder tokens in the narrative even after a retry. Distinct from
 * AiUnavailableException so logs/reports can tell "unmask failure" apart
 * from an actual provider outage. The controller translates this into the
 * standard manual-mode UI, with an internal reason for the log trail.
 */
final class AiSafetyGateException extends RuntimeException
{
    /**
     * @param string[] $tokens leftover placeholder tokens found in the text
     */
    public function __construct(
        string $message,
        public readonly array $tokens = [],
    ) {
        parent::__construct($message);
    }
}
