<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\AiNarrativeProvider;
use App\Ai\AiNarrativeResult;
use App\Ai\AiProviderException;

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
 *
 * Phase 7 adds `classify()`, the free-form account read, to the interface — so
 * the stub carries that too: a canned classification, in the same field names
 * a real provider's normaliseClassification() returns, so a service test can
 * assert what NarrativeService::classifyAccount() does with the answer.
 */
final class StubNarrativeProvider implements AiNarrativeProvider
{
    /** @var array<string,mixed>|null the canned payload's narrative */
    private ?string $narrative;

    /** @var array<string,mixed>|null the canned classification */
    private ?array $classification;

    /** @var array<string,mixed>|null the canned type-details answer */
    private ?array $typeDetails;

    /** @var array<string,mixed> extra fields to fold into the result */
    private array $extra;

    public int $calls = 0;

    /** @var array<int,array{masked:array,options:array}> every call it received */
    public array $received = [];

    /**
     * @param string $narrative the MASKED narrative the provider should return
     * @param array<string,mixed> $extra extra keys (masked) — e.g. gloss/ambiguities
     */
    public function __construct(
        string $narrative = '[VICTIM_1] reported the incident.',
        array $extra = [],
        ?array $classification = null,
        ?array $typeDetails = null,
    ) {
        $this->narrative = $narrative;
        $this->extra = $extra;
        $this->classification = $classification;
        $this->typeDetails = $typeDetails;
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

    /**
     * Phase 7 — the canned read of a free-form account. The default is the
     * empty read: nothing stated, which is a valid answer and the one that must
     * never invent anything.
     */
    public function classify(string $account, array $options = []): array
    {
        $this->calls++;
        $this->received[] = ['masked' => ['account' => $account], 'options' => $options];

        return $this->classification ?? [
            'incident_type' => '',
            'incident_datetime' => '',
            'incident_time_approximate' => false,
            'location' => '',
            'reporter_name' => '',
            'reporter_contact' => '',
            'reporter_address' => '',
            'action_taken' => '',
            'parties' => [],
            'unstated' => [],
        ];
    }

    /**
     * Phase 7 — the canned type-scoped read. The default is the SAME refusal a
     * real provider makes when it is handed nothing to read against (no scalars
     * and no groups for the type): throwing here rather than returning an empty
     * answer is deliberate, because that is the real behaviour a caller test
     * needs to see, and an empty answer would look like a successful read.
     */
    public function classifyDetails(
        string $account,
        string $incidentType,
        array $fields,
        array $options = [],
    ): array {
        $this->calls++;
        $this->received[] = [
            'masked' => ['account' => $account, 'incident_type' => $incidentType],
            'fields' => $fields,
            'options' => $options,
        ];

        if (($fields['scalars'] ?? []) === [] && ($fields['groups'] ?? []) === []) {
            throw new AiProviderException('This incident type has no fields a reading could fill.', retryable: false);
        }

        return $this->typeDetails ?? ['fields' => [], 'groups' => [], 'unstated' => []];
    }
}
