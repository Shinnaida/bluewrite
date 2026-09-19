<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\AiNarrativeProvider;
use App\Ai\AiNarrativeResult;
use PHPUnit\Framework\TestCase;

/**
 * Phase 6 Stage 3 — the stub provider is usable for deterministic tests, so
 * future generation/leak-gate tests can run without a live model call.
 */
final class StubNarrativeProviderTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeResult.php';
        require_once __DIR__ . '/StubNarrativeProvider.php';
    }

    public function testStubSatisfiesTheProviderInterface(): void
    {
        $this->assertInstanceOf(AiNarrativeProvider::class, new StubNarrativeProvider());
    }

    public function testStubReturnsTheCannedMaskedPayloadAndRecordsTheCall(): void
    {
        $stub = new StubNarrativeProvider('[VICTIM_1] saw [RESPONDENT_1].', [
            'notableFindings' => ['[VICTIM_1] identified [RESPONDENT_1].'],
            'actionTaken' => 'The case remains under investigation.',
        ]);

        $result = $stub->generate(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            ['incidentType' => 'Theft'],
        );

        $this->assertInstanceOf(AiNarrativeResult::class, $result);
        $this->assertSame('[VICTIM_1] saw [RESPONDENT_1].', $result->narrative);
        $this->assertSame(['[VICTIM_1] identified [RESPONDENT_1].'], $result->notableFindings);
        $this->assertSame('The case remains under investigation.', $result->actionTaken);
        $this->assertSame(1, $stub->calls);
        $this->assertSame('Theft', $stub->received[0]['options']['incidentType']);
    }
}
