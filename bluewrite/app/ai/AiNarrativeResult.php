<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * Result of one narrative generation call. Suggestions and possibleGaps are
 * advisory only — the caller merges possibleGaps with the deterministic rule
 * engine's warnings and never lets them block finalize (v2 §5.3 principle).
 */
final class AiNarrativeResult
{
    /**
     * @param array<int, array{type:string,text:string,suggestion:string}> $suggestions
     * @param array<int, array{description:string,severity:string}> $possibleGaps
     * @param array{latency_ms:int,prompt_tokens:int,candidate_tokens:int,total_tokens:int} $usage
     */
    public function __construct(
        public readonly string $narrative,
        public readonly array $suggestions = [],
        public readonly array $possibleGaps = [],
        public readonly array $usage = [],
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'narrative' => $this->narrative,
            'suggestions' => $this->suggestions,
            'possibleGaps' => $this->possibleGaps,
            'usage' => $this->usage,
        ];
    }
}
