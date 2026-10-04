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
 *
 * `suspectPhrases` holds the model's own descriptive phrases for unidentified
 * suspects, keyed by their placeholder. The service restores the phrase in
 * place of the bare role phrase, so the suspect's description in the draft is
 * the model's prose — never the raw form values, and never a prompt-dependent
 * inline rewrite (see NarrativeService::applySuspectPhrases). Each entry may
 * also carry a `line`: the same description as the sheet's own Suspect
 * sentence, drawn by the draft's sheet preview in place of the raw recorded
 * values (see NarrativeService::suspectLines).
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
     * @param array<int, array{ref:string,phrase:string,line?:string}> $suspectPhrases
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
        public readonly array $suspectPhrases = [],
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
            'suspectPhrases' => $this->suspectPhrases,
            'usage' => $this->usage,
        ];
    }
}
