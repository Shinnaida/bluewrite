<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\MaskingGateway;
use PHPUnit\Framework\TestCase;

/**
 * Phase 6 Stage 3 (Invariant 6) — the leak gate across EVERY text field of the
 * response, not just the narrative. The Stage 3 response adds the English gloss,
 * the native-language gloss and the ambiguity list; a mangled placeholder in any
 * of them is the same defect.
 *
 * Pure tests: no provider, no database, no API key.
 */
final class LeakGateFieldsTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/MaskingGateway.php';
    }

    public function testCleanFieldsProduceNoLeaks(): void
    {
        $this->assertSame([], MaskingGateway::leakedTokensAny([
            'narrative' => 'The suspect was apprehended near the market.',
            'gloss' => 'I understood the suspect to have been caught.',
            'sourceGloss' => 'Nasabtan nako nga nasakpan ang suspetsado.',
        ]));
    }

    public function testAMangledPlaceholderInAGlossIsReportedAgainstThatField(): void
    {
        $leaks = MaskingGateway::leakedTokensAny([
            'narrative' => 'The complainant Maria Santos reported the loss.',
            'gloss' => 'I understood [victim_1] to be the complainant.',
            'sourceGloss' => '',
        ]);
        $this->assertArrayHasKey('gloss', $leaks);
        $this->assertStringContainsStringIgnoringCase('victim_1', implode(',', $leaks['gloss']));
        $this->assertArrayNotHasKey('narrative', $leaks);
    }

    public function testAnUnbracketedTokenInAnAmbiguityLineIsReported(): void
    {
        $leaks = MaskingGateway::leakedTokensAny([
            'narrative' => 'A vehicle was involved.',
            'ambiguities' => ['The source mentions VEHICLE_1 and nothing more about it.'],
        ]);
        $this->assertArrayHasKey('ambiguities', $leaks);
    }

    public function testAnUnregisteredTokenInALineIsDropped(): void
    {
        // unmaskLines is the shared line rule: a line that cannot be restored is
        // dropped, never shown to the officer.
        $this->assertSame(
            ['A clean line that restores.'],
            MaskingGateway::unmaskLines(
                ['A clean line that restores.', 'A line with [victim_1] inside.'],
                ['[VICTIM_1]' => 'Maria Santos']
            )
        );
    }
}
