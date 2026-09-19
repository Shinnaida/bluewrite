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
 *
 * Phase 6 Stage 3 adds three fields for a non-English source. `gloss` is a
 * plain-English restatement of what the model understood the officer to have
 * said; `sourceGloss` is the same reading in the officer's own language (empty
 * for `mixed`/`other`); `ambiguities` names each passage the model found
 * unclear and each legal-weight term it rendered in the least-committal way.
 * All three are self-reports shown to the officer for checking — never a proof,
 * and never written into the report on their own.
 */
final class AiNarrativeResult
{
    /**
     * @param array<int, array{type:string,text:string,suggestion:string}> $suggestions
     * @param array<int, array{description:string,severity:string}> $possibleGaps
     * @param array{latency_ms:int,prompt_tokens:int,candidate_tokens:int,total_tokens:int} $usage
     * @param array<int, string> $notableFindings
     * @param array<int, string> $addedContentWarnings
     * @param array<int, string> $ambiguities
     */
    public function __construct(
        public readonly string $narrative,
        public readonly array $suggestions = [],
        public readonly array $possibleGaps = [],
        public readonly array $usage = [],
        public readonly array $notableFindings = [],
        public readonly string $actionTaken = '',
        public readonly array $addedContentWarnings = [],
        public readonly string $gloss = '',
        public readonly string $sourceGloss = '',
        public readonly array $ambiguities = [],
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
            'gloss' => $this->gloss,
            'sourceGloss' => $this->sourceGloss,
            'ambiguities' => $this->ambiguities,
            'usage' => $this->usage,
        ];
    }
}
