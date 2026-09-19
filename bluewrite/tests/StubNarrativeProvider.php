<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\AiNarrativeProvider;
use App\Ai\AiNarrativeResult;

/**
 * Phase 6 Stage 3 — a TEST-ONLY stub provider.
 *
 * The project shipped without any way to drive a generation deterministically:
 * every existing AI test exercises pure static helpers and never the provider
 * call. Stage 3 introduces new output fields (gloss, sourceGloss, ambiguities)
 * that must pass through unmasking and the leaked-token safety gate, and the
 * only honest way to test that is to make the provider return a canned,
 * MASKED payload and assert what the service does with it.
 *
 * It lives in tests/ and is never autoloaded by production code (the filename
 * does not match PHPUnit's *Test.php scan, so the runner ignores it; a test
 * requires it explicitly).
 *
 * It returns exactly the raw array shape a provider's `toArray()` produces,
 * which is what NarrativeService::finalize() consumes as `$payload`.
 */
final class StubNarrativeProvider implements AiNarrativeProvider
{
    /** @var array<string,mixed>|null the canned payload's narrative */
    private ?string $narrative;

    /** @var array<string,mixed> extra fields to fold into the result */
    private array $extra;

    public int $calls = 0;

    /** @var array<int,array{masked:array,options:array}> every call it received */
    public array $received = [];

    /**
     * @param string $narrative the MASKED narrative the provider should return
     * @param array<string,mixed> $extra extra keys (masked) — e.g. gloss/ambiguities
     */
    public function __construct(string $narrative = '[VICTIM_1] reported the incident.', array $extra = [])
    {
        $this->narrative = $narrative;
        $this->extra = $extra;
    }

    public function generate(array $maskedPayload, array $options): AiNarrativeResult
    {
        $this->calls++;
        $this->received[] = ['masked' => $maskedPayload, 'options' => $options];

        $n = $this->extra['narrative'] ?? $this->narrative;

        return new AiNarrativeResult(
            (string) $n,
            $this->extra['suggestions'] ?? [],
            $this->extra['possibleGaps'] ?? [],
            ['latency_ms' => 1, 'prompt_tokens' => 1, 'candidate_tokens' => 1, 'total_tokens' => 1],
            $this->extra['notableFindings'] ?? [],
            (string) ($this->extra['actionTaken'] ?? ''),
            $this->extra['addedContentWarnings'] ?? [],
        );
    }
}
