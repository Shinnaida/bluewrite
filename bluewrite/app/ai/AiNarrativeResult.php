<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * Result of one narrative generation call. Suggestions and possibleGaps are
 * advisory only — the caller merges possibleGaps with the deterministic rule
 * engine's warnings and never lets them block finalize (v2 §5.3 principle).
 *
 * notableFindings holds formalised NOTABLE FINDINGS lines and actionTaken the
 * formalised ACTION TAKEN / STATUS line for the report sheet. Both are
 * written into their own form fields by the editor (those fields are what
 * save, snapshot and print) as part of the one generation action; empty
 * values leave the officer's own text untouched.
 *
 * addedContentWarnings lists details the model withheld because the officer's
 * input does not state them. Unlike the fields above it is NEVER written into
 * the report: it exists so the officer can see what the draft may be missing.
 */
final class AiNarrativeResult
{
    /**
     * @param array<int, array{type:string,text:string,suggestion:string}> $suggestions
     * @param array<int, array{description:string,severity:string}> $possibleGaps
     * @param array{latency_ms:int,prompt_tokens:int,candidate_tokens:int,total_tokens:int} $usage
     * @param array<int, string> $notableFindings
     * @param array<int, string> $addedContentWarnings
     */
    public function __construct(
        public readonly string $narrative,
        public readonly array $suggestions = [],
        public readonly array $possibleGaps = [],
        public readonly array $usage = [],
        public readonly array $notableFindings = [],
        public readonly string $actionTaken = '',
        public readonly array $addedContentWarnings = [],
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'narrative' => $this->narrative,
            'suggestions' => $this->suggestions,
            'possibleGaps' => $this->possibleGaps,
            'notableFindings' => $this->notableFindings,
            'actionTaken' => $this->actionTaken,
            'addedContentWarnings' => $this->addedContentWarnings,
            'usage' => $this->usage,
        ];
    }
}
